import crypto from "node:crypto";

import { nowIso, readDb, updateDb } from "./persistence.js";

const MAX_EVENTS_PER_BATCH = 24;
const MAX_STORED_EVENTS = 5000;

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeString(value, fallback = "") {
  return String(value || "").trim() || fallback;
}

function normalizePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeTimestamp(value) {
  if (!value) {
    return nowIso();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

function deriveProduct(name, payload = {}) {
  const explicit = normalizeString(payload.product).toLowerCase();

  if (explicit) {
    return explicit;
  }

  const lower = normalizeString(name).toLowerCase();

  if (lower.startsWith("verifysme_")) {
    return "verifysme";
  }

  if (lower.startsWith("tenderradar_")) {
    return "tenderradar";
  }

  if (lower.startsWith("exportpulse_")) {
    return "exportpulse";
  }

  if (lower.startsWith("ops_")) {
    return "ops";
  }

  return "tradegraph";
}

function normalizeEventName(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeWorkspaceId(sessionContext, requestedWorkspaceId = "") {
  if (!sessionContext) {
    return "";
  }

  const allowedIds = new Set((sessionContext.workspaces || []).map((workspace) => workspace.id));

  if (requestedWorkspaceId && allowedIds.has(requestedWorkspaceId)) {
    return requestedWorkspaceId;
  }

  return sessionContext.workspace?.id || "";
}

function normalizeIncomingEvent(raw, { sessionContext = null } = {}) {
  const payload = normalizePayload(raw?.payload);
  const name = normalizeEventName(raw?.name);

  if (!name) {
    return null;
  }

  const workspaceId = normalizeWorkspaceId(
    sessionContext,
    normalizeString(raw?.workspaceId || payload.workspaceId),
  );

  return {
    id: normalizeString(raw?.id) || createId("event"),
    name,
    product: deriveProduct(name, { ...payload, product: raw?.product || payload.product }),
    page: normalizeString(raw?.path || raw?.page || raw?.context?.path || payload.path || payload.page),
    workspaceId: workspaceId || null,
    userId: sessionContext?.user?.id || null,
    sessionId: sessionContext?.session?.id || null,
    anonymousId: normalizeString(raw?.anonymousId || payload.anonymousId) || null,
    payload,
    createdAt: normalizeTimestamp(raw?.createdAt || raw?.timestamp || payload.createdAt),
  };
}

function mergeEvents(existing, incoming) {
  const byId = new Map((existing || []).map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-MAX_STORED_EVENTS);
}

function countBy(items, selector) {
  return items.reduce((accumulator, item) => {
    const key = selector(item);

    if (!key) {
      return accumulator;
    }

    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function mapTopEntries(mapObject, limit = 6) {
  return Object.entries(mapObject)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function normalizeDays(value) {
  const days = Number(value);

  if (!Number.isFinite(days) || days <= 0) {
    return 14;
  }

  return Math.min(Math.max(Math.round(days), 1), 90);
}

function buildDailyVolume(events, days) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);

  const byDay = new Map();

  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + offset);
    byDay.set(day.toISOString().slice(0, 10), 0);
  }

  events.forEach((event) => {
    const day = String(event.createdAt || "").slice(0, 10);

    if (byDay.has(day)) {
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
  });

  return [...byDay.entries()].map(([day, value]) => ({ day, value }));
}

function buildEventTimeline(events) {
  return Object.entries(countBy(events, (event) => String(event.createdAt || "").slice(0, 10)))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([day, count]) => ({ day, count }));
}

function summarizeActivity(events) {
  const pageViews = events.filter((event) => event.name.endsWith("_viewed") || event.name === "tradegraph_page_viewed");
  const workflowActions = events.filter((event) => /(shortlist|stage|opened|exported|verified|parsed|added)/.test(event.name));
  const opsActions = events.filter((event) => event.product === "ops" || event.name.startsWith("ops_"));
  const activeActors = new Set(
    events
      .map((event) => event.userId || event.sessionId || event.anonymousId || event.id)
      .filter(Boolean),
  );
  const latestEvent = events
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

  return {
    pageViews: pageViews.length,
    workflowActions: workflowActions.length,
    opsActions: opsActions.length,
    activeActors: activeActors.size,
    latestEventAt: latestEvent?.createdAt || null,
    latestEvent,
  };
}

export async function recordAnalyticsEvents(body, { sessionContext = null } = {}) {
  const rawEvents = Array.isArray(body?.events) ? body.events : [body];
  const events = rawEvents
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map((event) => normalizeIncomingEvent(event, { sessionContext }))
    .filter(Boolean);

  if (!events.length) {
    const error = new Error("At least one analytics event is required.");
    error.statusCode = 400;
    throw error;
  }

  await updateDb((draft) => {
    draft.analyticsEvents = mergeEvents(draft.analyticsEvents, events);
    return draft;
  });

  return {
    ok: true,
    received: events.length,
    acceptedIds: events.map((event) => event.id),
    syncedAt: nowIso(),
    mode: "api",
  };
}

export async function recordAnalyticsEvent(body, sessionContext = null) {
  const event = normalizeIncomingEvent(body, { sessionContext });

  if (!event) {
    const error = new Error("Event name is required.");
    error.statusCode = 400;
    throw error;
  }

  await updateDb((draft) => {
    draft.analyticsEvents = mergeEvents(draft.analyticsEvents, [event]);
    return draft;
  });

  return {
    ...event,
    path: event.page || "",
  };
}

function filterEventsByRange(events, { since = "", until = "" } = {}) {
  const sinceDate = since ? new Date(since) : null;
  const untilDate = until ? new Date(until) : null;

  if (since && Number.isNaN(sinceDate?.getTime())) {
    const error = new Error("since must be a valid ISO timestamp.");
    error.statusCode = 400;
    throw error;
  }

  if (until && Number.isNaN(untilDate?.getTime())) {
    const error = new Error("until must be a valid ISO timestamp.");
    error.statusCode = 400;
    throw error;
  }

  if (sinceDate && untilDate && sinceDate.getTime() > untilDate.getTime()) {
    const error = new Error("since must be before until.");
    error.statusCode = 400;
    throw error;
  }

  return events.filter((event) => {
    const time = new Date(event.createdAt).getTime();

    if (sinceDate && time < sinceDate.getTime()) {
      return false;
    }

    if (untilDate && time > untilDate.getTime()) {
      return false;
    }

    return true;
  });
}

export async function getAnalyticsSummary({ product = "", since = "", until = "" } = {}) {
  const db = await readDb();
  const normalizedProduct = normalizeString(product).toLowerCase();
  const filtered = filterEventsByRange(db.analyticsEvents || [], { since, until })
    .filter((event) => (normalizedProduct ? event.product === normalizedProduct : true))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const latestEvent = filtered.at(-1) || null;
  const byProductCounts = countBy(filtered, (event) => event.product);
  const byEventCounts = filtered.reduce((accumulator, event) => {
    const key = `${event.product}:${event.name}`;
    const existing = accumulator.get(key);

    if (!existing) {
      accumulator.set(key, {
        product: event.product,
        name: event.name,
        count: 1,
        lastEventAt: event.createdAt,
      });
      return accumulator;
    }

    existing.count += 1;
    existing.lastEventAt = event.createdAt;
    return accumulator;
  }, new Map());
  const sortedByEvent = [...byEventCounts.values()].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return left.name.localeCompare(right.name);
  });

  return {
    filters: {
      product: normalizedProduct || "",
      since: since || "",
      until: until || "",
    },
    summary: {
      totalEvents: filtered.length,
      distinctEvents: Object.keys(countBy(filtered, (event) => event.name)).length,
      authenticatedEvents: filtered.filter((event) => Boolean(event.workspaceId || event.userId || event.sessionId)).length,
      anonymousEvents: filtered.filter((event) => !event.workspaceId && !event.userId && !event.sessionId).length,
      uniqueProducts: Object.keys(byProductCounts).length,
      syncedEvents: filtered.length,
      latestEvent: latestEvent
        ? {
            id: latestEvent.id,
            product: latestEvent.product,
            name: latestEvent.name,
            path: latestEvent.page || "",
            createdAt: latestEvent.createdAt,
          }
        : null,
      timeline: buildEventTimeline(filtered),
      events: countBy(filtered, (event) => event.name),
      topEvents: sortedByEvent.slice(0, 5).map((item) => ({
        name: item.name,
        label: item.name,
        count: item.count,
        rawNames: [item.name],
      })),
      recentEvents: filtered
        .slice()
        .reverse()
        .slice(0, 5)
        .map((event) => ({
          id: event.id,
          name: event.name,
          label: event.name,
          timestamp: event.createdAt,
          context: {
            path: event.page || "",
          },
        })),
      byProduct: mapTopEntries(byProductCounts, 50).map((item) => ({
        product: item.label,
        count: item.value,
        lastEventAt: filtered.filter((event) => event.product === item.label).at(-1)?.createdAt || null,
      })),
      byEvent: sortedByEvent,
    },
  };
}

export async function resetAnalyticsStore() {
  await updateDb((draft) => {
    draft.analyticsEvents = [];
    return draft;
  });
}

export async function buildControlCenterInsightResponse({ sessionContext = null, searchParams = new URLSearchParams() } = {}) {
  const db = await readDb();
  const days = normalizeDays(searchParams.get("days"));
  const requestedWorkspaceId = normalizeString(searchParams.get("workspaceId"));
  const workspaceId = normalizeWorkspaceId(sessionContext, requestedWorkspaceId);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const events = (db.analyticsEvents || [])
    .filter((event) => new Date(event.createdAt).getTime() >= cutoff)
    .filter((event) => (workspaceId ? event.workspaceId === workspaceId : true))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  const eventMix = mapTopEntries(countBy(events, (event) => event.name), 6);
  const productMix = mapTopEntries(countBy(events, (event) => event.product), 5);
  const pageMix = mapTopEntries(countBy(events, (event) => event.page), 6);
  const activity = summarizeActivity(events);
  const dailyActivity = buildDailyVolume(events, days);
  const recentActivity = events
    .slice()
    .reverse()
    .slice(0, 8)
    .map((event) => ({
      id: event.id,
      label: event.name,
      valueText: event.product || "tradegraph",
      detail: event.page || (event.workspaceId ? "Workspace-scoped activity" : "Guest activity"),
      createdAt: event.createdAt,
    }));

  return {
    product: "control-center",
    generatedAt: nowIso(),
    filters: {
      workspaceId: workspaceId || "",
      days,
      scope: workspaceId ? "workspace" : "global",
    },
    highlights: [
      {
        label: "Tracked events",
        value: events.length,
        detail: `${activity.activeActors} active browser or workspace actors`,
      },
      {
        label: "Page views",
        value: activity.pageViews,
        detail: pageMix[0] ? `${pageMix[0].label} is the busiest page` : "No page activity yet",
      },
      {
        label: "Workflow actions",
        value: activity.workflowActions,
        detail: "Shortlist, stage, export, verification, and parsing actions",
      },
      {
        label: "Ops actions",
        value: activity.opsActions,
        detail: activity.latestEventAt ? `Latest event ${activity.latestEventAt}` : "No recent ops activity",
      },
    ],
    charts: {
      dailyActivity: {
        type: "timeline",
        data: dailyActivity,
      },
      eventMix: {
        type: "bar",
        data: eventMix.length ? eventMix : [{ label: "No tracked activity yet", value: 0 }],
      },
      productMix: {
        type: "bar",
        data: productMix.length ? productMix : [{ label: "No product activity yet", value: 0 }],
      },
      pageMix: {
        type: "bar",
        data: pageMix.length ? pageMix : [{ label: "No active pages yet", value: 0 }],
      },
    },
    tables: {
      recentActivity,
    },
    provenance: {
      eventCount: events.length,
      latestEventAt: activity.latestEventAt,
      scopeLabel: workspaceId ? "Workspace-scoped activity" : "Global activity",
      workspaceId: workspaceId || null,
    },
  };
}
