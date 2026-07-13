const STORAGE_KEY = "tradegraph-analytics";
const CLIENT_ID_KEY = "tradegraph-analytics-client-id";
const MAX_PENDING_EVENTS = 60;
const MAX_RECENT_EVENTS = 20;
const UNSUPPORTED_RETRY_MS = 1000 * 60 * 5;
const UNSUPPORTED_STATUS_CODES = new Set([404, 405, 501]);

export const ANALYTICS_EVENT_PATHS = ["/api/analytics/events", "/api/analytics"];
export const ANALYTICS_SUMMARY_PATHS = ["/api/analytics/summary", "/api/analytics"];

const EVENT_METADATA = {
  ops_sync_sources: {
    group: "source_sync_triggered",
    label: "Source Sync Triggered",
  },
  source_sync_triggered: {
    group: "source_sync_triggered",
    label: "Source Sync Triggered",
  },
  ops_create_alert: {
    group: "alert_created",
    label: "Alert Created",
  },
  alert_created: {
    group: "alert_created",
    label: "Alert Created",
  },
  alert_toggled: {
    group: "alert_toggled",
    label: "Alert Toggled",
  },
  ops_test_alert: {
    group: "alert_tested",
    label: "Alert Tested",
  },
  alert_tested: {
    group: "alert_tested",
    label: "Alert Tested",
  },
  ops_delete_alert: {
    group: "alert_deleted",
    label: "Alert Deleted",
  },
  alert_deleted: {
    group: "alert_deleted",
    label: "Alert Deleted",
  },
  ops_plan_select: {
    group: "billing_plan_selected",
    label: "Billing Plan Selected",
  },
  billing_plan_selected: {
    group: "billing_plan_selected",
    label: "Billing Plan Selected",
  },
  billing_plan_refreshed: {
    group: "billing_plan_refreshed",
    label: "Billing Plan Refreshed",
  },
  billing_plan_reset: {
    group: "billing_plan_reset",
    label: "Billing Plan Reset",
  },
  workspace_signed_in: {
    group: "workspace_signed_in",
    label: "Workspace Signed In",
  },
  workspace_created: {
    group: "workspace_created",
    label: "Workspace Created",
  },
  workspace_invite_created: {
    group: "workspace_invite_created",
    label: "Workspace Invite Created",
  },
  workspace_invite_joined: {
    group: "workspace_invite_joined",
    label: "Workspace Invite Joined",
  },
  workspace_switched: {
    group: "workspace_switched",
    label: "Workspace Switched",
  },
  verifysme_viewed: {
    group: "verifysme_viewed",
    label: "VerifySME Viewed",
  },
  tenderradar_viewed: {
    group: "tenderradar_viewed",
    label: "TenderRadar Viewed",
  },
  exportpulse_viewed: {
    group: "exportpulse_viewed",
    label: "ExportPulse Viewed",
  },
};

let deliveryPromise = null;
let runtimeHooksBound = false;

function createEmptySnapshot() {
  return {
    total: 0,
    events: {},
    lastEvent: null,
    recentEvents: [],
    pendingEvents: [],
    backend: {
      supported: null,
      status: "local",
      syncedCount: 0,
      pendingCount: 0,
      lastAttemptAt: null,
      lastSyncedAt: null,
      lastError: "",
      endpoint: "",
      mode: "local-storage",
    },
  };
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildEventGroup(name) {
  return EVENT_METADATA[name]?.group || name;
}

function humanizeEventName(name) {
  return String(name || "")
    .split(/[_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getEventLabel(name) {
  return EVENT_METADATA[name]?.label || humanizeEventName(name);
}

export function formatTradeGraphAnalyticsEventLabel(name) {
  const group = buildEventGroup(name);
  return getEventLabel(group);
}

function buildContext() {
  if (typeof window === "undefined") {
    return {};
  }

  return {
    path: window.location.pathname || "",
    hash: window.location.hash || "",
    title: typeof document !== "undefined" ? document.title || "" : "",
  };
}

function createEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getAnonymousId() {
  if (typeof window === "undefined" || !window.localStorage) {
    return "";
  }

  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);

    if (existing) {
      return existing;
    }

    const next = `anon_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    window.localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return "";
  }
}

function normalizeEventPayload(payload) {
  if (isRecord(payload)) {
    return payload;
  }

  if (payload === undefined) {
    return {};
  }

  return { value: payload };
}

function normalizeEvent(input) {
  if (!isRecord(input) || !input.name) {
    return null;
  }

  return {
    id: String(input.id || createEventId()),
    name: String(input.name),
    anonymousId: String(input.anonymousId || getAnonymousId()),
    payload: normalizeEventPayload(input.payload),
    timestamp: input.timestamp || new Date().toISOString(),
    context: isRecord(input.context) ? input.context : {},
  };
}

function normalizeBackend(input, pendingCount = 0) {
  const backend = isRecord(input) ? input : {};

  return {
    supported:
      backend.supported === true
        ? true
        : backend.supported === false
          ? false
          : null,
    status: backend.status || (pendingCount ? "pending" : "local"),
    syncedCount: toFiniteNumber(backend.syncedCount, 0),
    pendingCount: toFiniteNumber(backend.pendingCount, pendingCount),
    lastAttemptAt: backend.lastAttemptAt || null,
    lastSyncedAt: backend.lastSyncedAt || null,
    lastError: backend.lastError || "",
    endpoint: backend.endpoint || "",
    mode: backend.mode || "local-storage",
  };
}

function normalizeSnapshot(input) {
  const base = createEmptySnapshot();
  const snapshot = isRecord(input) ? input : base;
  const events = isRecord(snapshot.events) ? snapshot.events : {};
  const recentEvents = Array.isArray(snapshot.recentEvents)
    ? snapshot.recentEvents.map(normalizeEvent).filter(Boolean).slice(-MAX_RECENT_EVENTS)
    : [];
  const pendingEvents = Array.isArray(snapshot.pendingEvents)
    ? snapshot.pendingEvents.map(normalizeEvent).filter(Boolean).slice(-MAX_PENDING_EVENTS)
    : [];
  const lastEvent =
    normalizeEvent(snapshot.lastEvent)
    || recentEvents[recentEvents.length - 1]
    || pendingEvents[pendingEvents.length - 1]
    || null;

  return {
    total: Math.max(toFiniteNumber(snapshot.total, 0), 0),
    events: Object.fromEntries(
      Object.entries(events)
        .filter(([name]) => Boolean(name))
        .map(([name, count]) => [name, Math.max(toFiniteNumber(count, 0), 0)]),
    ),
    lastEvent,
    recentEvents,
    pendingEvents,
    backend: normalizeBackend(snapshot.backend, pendingEvents.length),
  };
}

function safeRead() {
  if (typeof window === "undefined" || !window.localStorage) {
    return createEmptySnapshot();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeSnapshot(JSON.parse(raw)) : createEmptySnapshot();
  } catch {
    return createEmptySnapshot();
  }
}

function safeWrite(snapshot) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSnapshot(snapshot)));
  } catch {
    // Ignore local-storage write failures for the public pilot.
  }
}

function emitAnalyticsUpdate(snapshot) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("tradegraph:analytics-updated", {
      detail: {
        snapshot,
        summary: getTradeGraphAnalyticsUsageSummary(snapshot),
      },
    }),
  );
}

function shouldRetryUnsupported(snapshot, force = false) {
  if (force || snapshot.backend.supported !== false) {
    return true;
  }

  if (!snapshot.backend.lastAttemptAt) {
    return true;
  }

  return Date.now() - new Date(snapshot.backend.lastAttemptAt).getTime() >= UNSUPPORTED_RETRY_MS;
}

function bindRuntimeHooks() {
  if (runtimeHooksBound || typeof window === "undefined") {
    return;
  }

  runtimeHooksBound = true;

  window.addEventListener("online", () => {
    void flushTradeGraphAnalytics({ force: true });
  });

  window.addEventListener("tradegraph:session-changed", (event) => {
    if (event.detail?.signedIn) {
      void flushTradeGraphAnalytics({ force: true });
    }
  });
}

async function postAnalyticsBatch(path, payload) {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    const data = await response.json().catch(() => ({}));

    if (UNSUPPORTED_STATUS_CODES.has(response.status)) {
      return {
        ok: false,
        unsupported: true,
        path,
      };
    }

    if (!response.ok) {
      const error = new Error(data.error || `Request failed with ${response.status}`);
      error.statusCode = response.status;
      return {
        ok: false,
        unsupported: false,
        path,
        error,
      };
    }

    return {
      ok: true,
      path,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      unsupported: false,
      path,
      error,
    };
  }
}

function buildBatchPayload(snapshot) {
  return {
    events: snapshot.pendingEvents,
    summary: {
      totalEvents: snapshot.total,
      distinctEvents: Object.keys(snapshot.events).length,
      pendingEvents: snapshot.pendingEvents.length,
    },
    client: buildContext(),
  };
}

function updateFailedDeliveryState(path, error, unsupported) {
  const snapshot = safeRead();

  snapshot.backend = {
    ...snapshot.backend,
    supported: unsupported ? false : snapshot.backend.supported,
    status: unsupported ? "local-only" : "degraded",
    pendingCount: snapshot.pendingEvents.length,
    lastAttemptAt: new Date().toISOString(),
    lastError: error?.message || (unsupported ? "Analytics API not available." : "Analytics delivery failed."),
    endpoint: path || snapshot.backend.endpoint || "",
  };

  safeWrite(snapshot);
  emitAnalyticsUpdate(snapshot);
  return snapshot;
}

function updateSuccessfulDeliveryState(batch, path, responseData) {
  const snapshot = safeRead();
  const acceptedIds = new Set(
    Array.isArray(responseData?.acceptedIds) && responseData.acceptedIds.length
      ? responseData.acceptedIds.map((id) => String(id))
      : batch.map((event) => event.id),
  );

  snapshot.pendingEvents = snapshot.pendingEvents.filter((event) => !acceptedIds.has(event.id));
  snapshot.backend = {
    ...snapshot.backend,
    supported: true,
    status: snapshot.pendingEvents.length ? "pending" : "synced",
    pendingCount: snapshot.pendingEvents.length,
    syncedCount: snapshot.backend.syncedCount + acceptedIds.size,
    lastAttemptAt: new Date().toISOString(),
    lastSyncedAt: responseData?.lastSyncedAt || responseData?.syncedAt || new Date().toISOString(),
    lastError: "",
    endpoint: path || snapshot.backend.endpoint || "",
    mode: responseData?.mode || "api",
  };

  safeWrite(snapshot);
  emitAnalyticsUpdate(snapshot);
  return snapshot;
}

export async function flushTradeGraphAnalytics(options = {}) {
  bindRuntimeHooks();

  if (deliveryPromise) {
    return deliveryPromise;
  }

  deliveryPromise = (async () => {
    const snapshot = safeRead();

    if (!snapshot.pendingEvents.length) {
      return snapshot;
    }

    if (!shouldRetryUnsupported(snapshot, options.force === true)) {
      return snapshot;
    }

    const batch = snapshot.pendingEvents.slice();
    const payload = buildBatchPayload(snapshot);

    let lastFailure = null;

    for (const path of ANALYTICS_EVENT_PATHS) {
      const result = await postAnalyticsBatch(path, payload);

      if (result.ok) {
        return updateSuccessfulDeliveryState(batch, path, result.data);
      }

      if (result.unsupported) {
        lastFailure = {
          path,
          unsupported: true,
        };
        continue;
      }

      return updateFailedDeliveryState(path, result.error, false);
    }

    return updateFailedDeliveryState(
      lastFailure?.path || ANALYTICS_EVENT_PATHS[0],
      lastFailure?.unsupported ? new Error("Analytics API not available.") : null,
      true,
    );
  })().finally(() => {
    deliveryPromise = null;
  });

  return deliveryPromise;
}

function buildEventSummaryEntry(name, count) {
  const group = buildEventGroup(name);
  return {
    name: group,
    label: getEventLabel(group),
    count: Math.max(toFiniteNumber(count, 0), 0),
    rawNames: [name],
  };
}

function groupEventCounts(events) {
  const grouped = new Map();

  Object.entries(events || {}).forEach(([name, count]) => {
    const group = buildEventGroup(name);
    const current = grouped.get(group) || buildEventSummaryEntry(name, 0);

    current.count += Math.max(toFiniteNumber(count, 0), 0);

    if (!current.rawNames.includes(name)) {
      current.rawNames.push(name);
    }

    grouped.set(group, current);
  });

  return [...grouped.values()].sort((left, right) => right.count - left.count);
}

function decorateEvent(event) {
  if (!event) {
    return null;
  }

  const group = buildEventGroup(event.name);

  return {
    ...event,
    group,
    label: getEventLabel(group),
  };
}

export function trackTradeGraphEvent(name, payload = {}) {
  bindRuntimeHooks();

  if (!name) {
    return safeRead();
  }

  const snapshot = safeRead();
  const event = normalizeEvent({
    id: createEventId(),
    name,
    anonymousId: getAnonymousId(),
    payload,
    timestamp: new Date().toISOString(),
    context: buildContext(),
  });

  snapshot.total += 1;
  snapshot.events[event.name] = (snapshot.events[event.name] || 0) + 1;
  snapshot.lastEvent = event;
  snapshot.recentEvents = [...snapshot.recentEvents, event].slice(-MAX_RECENT_EVENTS);
  snapshot.pendingEvents = [...snapshot.pendingEvents, event].slice(-MAX_PENDING_EVENTS);
  snapshot.backend = {
    ...snapshot.backend,
    pendingCount: snapshot.pendingEvents.length,
    status:
      snapshot.backend.supported === false
        ? "local-only"
        : snapshot.pendingEvents.length
          ? "pending"
          : snapshot.backend.status,
  };

  safeWrite(snapshot);
  emitAnalyticsUpdate(snapshot);
  void flushTradeGraphAnalytics();
  return snapshot;
}

export function getTradeGraphAnalyticsSnapshot() {
  bindRuntimeHooks();
  return safeRead();
}

export function getTradeGraphAnalyticsUsageSummary(input = safeRead()) {
  const snapshot = normalizeSnapshot(input);
  const groupedEvents = groupEventCounts(snapshot.events);
  const lastEvent = decorateEvent(snapshot.lastEvent);
  const recentEvents = snapshot.recentEvents
    .map(decorateEvent)
    .filter(Boolean)
    .slice()
    .reverse();

  return {
    source: snapshot.backend.supported ? "hybrid" : "local",
    totalEvents: snapshot.total,
    distinctEvents: groupedEvents.length,
    rawDistinctEvents: Object.keys(snapshot.events).length,
    pendingEvents: snapshot.pendingEvents.length,
    syncedEvents: snapshot.backend.syncedCount,
    topEvents: groupedEvents.slice(0, 5),
    lastEvent,
    recentEvents,
    lastAttemptAt: snapshot.backend.lastAttemptAt,
    lastSyncedAt: snapshot.backend.lastSyncedAt,
    backendStatus: snapshot.backend.status,
    transport: snapshot.backend.mode,
    endpoint: snapshot.backend.endpoint,
    lastError: snapshot.backend.lastError,
    updatedAt: lastEvent?.timestamp || null,
  };
}
