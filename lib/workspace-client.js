import {
  ANALYTICS_SUMMARY_PATHS,
  getTradeGraphAnalyticsUsageSummary,
  trackTradeGraphEvent,
} from "../apps/tradegraph/lib/analytics.js";

const LOCAL_FALLBACK_PREFIX = "tradegraph.local.";
const OPTIONAL_ENDPOINT_STATUS_CODES = new Set([404, 405, 501]);

let sessionCache = null;
let sessionPromise = null;
let sourceCache = null;
let sourcePromise = null;
let runtimeCache = null;
let runtimePromise = null;
let alertCache = null;
let alertPromise = null;
let billingCache = null;
let billingPromise = null;
let analyticsCache = null;
let analyticsPromise = null;
const insightCache = new Map();
const insightPromises = new Map();
const listeners = new Set();

function emitBrowserEvent(name, detail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function localKey(namespace) {
  return `${LOCAL_FALLBACK_PREFIX}${namespace}`;
}

function safeLocalRead(namespace, fallback) {
  try {
    const raw = window.localStorage.getItem(localKey(namespace));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalWrite(namespace, value) {
  try {
    window.localStorage.setItem(localKey(namespace), JSON.stringify(value));
  } catch {
    return;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return response.json();
}

async function requestOptional(paths, options = {}) {
  const candidates = Array.isArray(paths) ? paths : [paths];
  let lastError = null;

  for (const path of candidates) {
    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
        ...options,
      });

      if (OPTIONAL_ENDPOINT_STATUS_CODES.has(response.status)) {
        continue;
      }

      const payload = await response.json().catch(() => ({ error: "Request failed." }));

      if (!response.ok) {
        const error = new Error(payload.error || `Request failed with ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }

      return {
        ok: true,
        path,
        payload,
      };
    } catch (error) {
      if (OPTIONAL_ENDPOINT_STATUS_CODES.has(error.statusCode)) {
        continue;
      }

      lastError = error;
      break;
    }
  }

  return {
    ok: false,
    unsupported: !lastError,
    error: lastError,
  };
}

function notify() {
  listeners.forEach((listener) => listener(sessionCache));
  emitBrowserEvent("tradegraph:session-changed", sessionCache);
}

function notifySources() {
  emitBrowserEvent("tradegraph:sources-updated", sourceCache);
}

function notifyAlerts() {
  emitBrowserEvent("tradegraph:alerts-updated", alertCache);
}

function notifyBilling() {
  emitBrowserEvent("tradegraph:billing-updated", billingCache);
}

function notifyRuntime() {
  emitBrowserEvent("tradegraph:runtime-updated", runtimeCache);
}

function notifyAnalytics() {
  emitBrowserEvent("tradegraph:analytics-summary-updated", analyticsCache);
}

function invalidateAnalyticsSummary() {
  analyticsCache = null;
  analyticsPromise = null;
}

function clearWorkspaceCaches() {
  alertCache = null;
  billingCache = null;
  invalidateAnalyticsSummary();
  insightCache.clear();
}

function recordWorkspaceEvent(name, payload = {}) {
  trackTradeGraphEvent(name, payload);
  invalidateAnalyticsSummary();
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildGroupedTopEventsFromCounts(eventCounts) {
  if (!eventCounts || typeof eventCounts !== "object" || Array.isArray(eventCounts)) {
    return [];
  }

  const totalEvents = Object.values(eventCounts).reduce(
    (sum, value) => sum + Math.max(toFiniteNumber(value, 0), 0),
    0,
  );

  return getTradeGraphAnalyticsUsageSummary({
    total: totalEvents,
    events: eventCounts,
  }).topEvents;
}

function normalizeAnalyticsTopEvents(input, fallback = []) {
  if (Array.isArray(input)) {
    return input
      .map((item) => ({
        name: item.name || item.key || item.event || item.label || "",
        label: item.label || item.title || item.name || item.key || item.event || "Unknown event",
        count: Math.max(toFiniteNumber(item.count ?? item.total ?? item.value, 0), 0),
        rawNames: Array.isArray(item.rawNames) ? item.rawNames : [],
      }))
      .filter((item) => item.name || item.label)
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
  }

  const grouped = buildGroupedTopEventsFromCounts(input);
  return grouped.length ? grouped : fallback;
}

function normalizeAnalyticsLastEvent(input, fallback = null) {
  if (!input || typeof input !== "object") {
    return fallback;
  }

  const name = input.name || input.key || input.event || fallback?.name || "";

  if (!name) {
    return fallback;
  }

  return {
    ...fallback,
    ...input,
    name,
    label: input.label || fallback?.label || name,
    timestamp: input.timestamp || input.at || input.createdAt || fallback?.timestamp || null,
  };
}

function buildLocalAnalyticsSummaryResponse(localSummary, error = "") {
  return {
    source: "local",
    endpoint: "",
    error,
    summary: {
      ...localSummary,
      backendStatus: error ? "degraded" : localSummary.backendStatus,
      lastError: error || localSummary.lastError,
      transport: localSummary.transport || "local-storage",
    },
  };
}

function normalizeRemoteAnalyticsSummary(payload, localSummary, endpoint) {
  const raw = payload?.summary || payload?.analytics || payload?.usage || payload || {};
  const eventCounts = raw.eventCounts || raw.events;
  const groupedTopEvents = buildGroupedTopEventsFromCounts(eventCounts);
  const topEvents = normalizeAnalyticsTopEvents(raw.topEvents, groupedTopEvents.length ? groupedTopEvents : localSummary.topEvents);
  const distinctFromCounts = groupedTopEvents.length || localSummary.distinctEvents;

  return {
    source: "remote",
    endpoint,
    error: "",
    summary: {
      ...localSummary,
      totalEvents: Math.max(
        toFiniteNumber(raw.totalEvents ?? raw.total ?? raw.eventTotal, localSummary.totalEvents),
        localSummary.totalEvents,
      ),
      distinctEvents: Math.max(
        toFiniteNumber(raw.distinctEvents ?? raw.uniqueEvents, distinctFromCounts),
        localSummary.distinctEvents,
      ),
      pendingEvents: localSummary.pendingEvents,
      syncedEvents: Math.max(
        toFiniteNumber(raw.syncedEvents ?? raw.acceptedEvents ?? raw.persistedEvents, localSummary.syncedEvents),
        localSummary.syncedEvents,
      ),
      topEvents: topEvents.length ? topEvents : localSummary.topEvents,
      lastEvent: normalizeAnalyticsLastEvent(raw.lastEvent ?? raw.latestEvent, localSummary.lastEvent),
      recentEvents:
        Array.isArray(raw.recentEvents) && raw.recentEvents.length
          ? raw.recentEvents
          : localSummary.recentEvents,
      lastSyncedAt: raw.lastSyncedAt || raw.syncedAt || payload.lastSyncedAt || localSummary.lastSyncedAt,
      lastAttemptAt: raw.lastAttemptAt || payload.lastAttemptAt || localSummary.lastAttemptAt,
      backendStatus: raw.backendStatus || payload.status || "available",
      transport: raw.transport || raw.mode || payload.mode || "api",
      endpoint,
      updatedAt: raw.updatedAt || payload.updatedAt || localSummary.updatedAt,
      lastError: raw.lastError || payload.error || "",
    },
    raw: payload,
  };
}

export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadSession(force = false) {
  if (!force && sessionCache) {
    return sessionCache;
  }

  if (!force && sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = request("/api/session")
    .then((payload) => {
      sessionCache = payload;
      notify();
      return payload;
    })
    .finally(() => {
      sessionPromise = null;
    });

  return sessionPromise;
}

export function getSessionSnapshot() {
  return sessionCache;
}

export async function loginWithDemo() {
  await request("/api/demo-login", { method: "POST" });
  clearWorkspaceCaches();
  const session = await loadSession(true);
  recordWorkspaceEvent("workspace_signed_in", {
    mode: "demo",
    workspaceId: session?.workspace?.id || "demo",
  });
  return session;
}

export async function loginWithPassword(email, password, workspaceId = "") {
  await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password, workspaceId }),
  });
  clearWorkspaceCaches();
  const session = await loadSession(true);
  recordWorkspaceEvent("workspace_signed_in", {
    mode: "password",
    workspaceId: session?.workspace?.id || workspaceId || "",
  });
  return session;
}

export async function registerAccount(name, email, password) {
  await request("/api/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  clearWorkspaceCaches();
  const session = await loadSession(true);
  recordWorkspaceEvent("workspace_signed_in", {
    mode: "register",
    workspaceId: session?.workspace?.id || "",
  });
  return session;
}

export async function logout() {
  await request("/api/logout", { method: "POST" });
  sessionCache = null;
  clearWorkspaceCaches();
  notify();
}

export async function createWorkspace(name) {
  await request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  clearWorkspaceCaches();
  const session = await loadSession(true);
  recordWorkspaceEvent("workspace_created", {
    workspaceId: session?.workspace?.id || "",
    name: String(name || "").trim(),
  });
  return session;
}

export async function createWorkspaceInvite() {
  const payload = await request("/api/workspace-invite", {
    method: "POST",
  });
  const session = await loadSession(true);
  recordWorkspaceEvent("workspace_invite_created", {
    workspaceId: session?.workspace?.id || "",
    inviteId: payload?.id || "",
  });
  return payload;
}

export async function joinWorkspace(code) {
  const payload = await request("/api/workspace-join", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  clearWorkspaceCaches();
  const session = await loadSession(true);
  recordWorkspaceEvent("workspace_invite_joined", {
    workspaceId: session?.workspace?.id || payload?.id || "",
    codeLength: String(code || "").trim().length,
  });
  return payload;
}

export async function selectWorkspace(workspaceId) {
  await request("/api/workspace-select", {
    method: "POST",
    body: JSON.stringify({ workspaceId }),
  });
  clearWorkspaceCaches();
  const session = await loadSession(true);
  recordWorkspaceEvent("workspace_switched", {
    workspaceId: session?.workspace?.id || workspaceId,
  });
  return session;
}

export async function loadRuntime(force = false) {
  if (!force && runtimeCache) {
    return runtimeCache;
  }

  if (!force && runtimePromise) {
    return runtimePromise;
  }

  runtimePromise = request("/api/config")
    .then((payload) => {
      runtimeCache = payload;
      notifyRuntime();
      return payload;
    })
    .finally(() => {
      runtimePromise = null;
    });

  return runtimePromise;
}

export function getAnalyticsSummarySnapshot() {
  return analyticsCache;
}

export async function loadAnalyticsSummary(force = false) {
  if (!force && analyticsCache) {
    return analyticsCache;
  }

  if (!force && analyticsPromise) {
    return analyticsPromise;
  }

  analyticsPromise = (async () => {
    const localSummary = getTradeGraphAnalyticsUsageSummary();
    const session = await loadSession().catch(() => null);

    if (!session?.signedIn) {
      analyticsCache = buildLocalAnalyticsSummaryResponse(localSummary);
      notifyAnalytics();
      return analyticsCache;
    }

    const result = await requestOptional(ANALYTICS_SUMMARY_PATHS);

    analyticsCache = result.ok
      ? normalizeRemoteAnalyticsSummary(result.payload, localSummary, result.path)
      : buildLocalAnalyticsSummaryResponse(
          localSummary,
          result.unsupported ? "" : result.error?.message || "Unable to load analytics summary.",
        );

    notifyAnalytics();
    return analyticsCache;
  })().finally(() => {
    analyticsPromise = null;
  });

  return analyticsPromise;
}

export async function readPersistentState(namespace, fallback) {
  const session = await loadSession();

  if (!session?.signedIn) {
    return safeLocalRead(namespace, fallback);
  }

  try {
    const payload = await request(`/api/state?namespace=${encodeURIComponent(namespace)}`);
    return payload.value ?? fallback;
  } catch {
    return safeLocalRead(namespace, fallback);
  }
}

export async function writePersistentState(namespace, value) {
  const session = await loadSession();
  safeLocalWrite(namespace, value);

  if (!session?.signedIn) {
    return;
  }

  try {
    await request(`/api/state?namespace=${encodeURIComponent(namespace)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  } catch {
    return;
  }
}

export async function loadSources(force = false) {
  if (!force && sourceCache) {
    return sourceCache;
  }

  if (!force && sourcePromise) {
    return sourcePromise;
  }

  sourcePromise = request("/api/sources")
    .then((payload) => {
      sourceCache = payload;
      notifySources();
      return payload;
    })
    .finally(() => {
      sourcePromise = null;
    });

  return sourcePromise;
}

export async function syncSources() {
  const payload = await request("/api/source-sync", { method: "POST" });
  sourceCache = payload;
  insightCache.clear();
  notifySources();
  recordWorkspaceEvent("source_sync_triggered", {
    workspaceId: sessionCache?.workspace?.id || "local",
    sourceCount: payload?.summary?.length || 0,
    liveSourceCount: payload?.summary?.filter((source) => source.status === "live").length || 0,
  });
  return payload;
}

function buildInsightCacheKey(product, filters) {
  return JSON.stringify({ product, filters: filters || {} });
}

function buildInsightQuery(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    params.set(key, String(value));
  });

  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function loadInsights(product, filters = {}, force = false) {
  const cacheKey = buildInsightCacheKey(product, filters);

  if (!force && insightCache.has(cacheKey)) {
    return insightCache.get(cacheKey);
  }

  if (!force && insightPromises.has(cacheKey)) {
    return insightPromises.get(cacheKey);
  }

  const promise = request(`/api/insights/${encodeURIComponent(product)}${buildInsightQuery(filters)}`)
    .then((payload) => {
      insightCache.set(cacheKey, payload);
      return payload;
    })
    .finally(() => {
      insightPromises.delete(cacheKey);
    });

  insightPromises.set(cacheKey, promise);
  return promise;
}

export async function createUdyamChallenge() {
  return request("/api/udyam-challenge");
}

export async function verifyUdyamRegistration(payload) {
  return request("/api/udyam-verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function parseUdyamImportedRecord(payload) {
  return request("/api/udyam-certificate-parse", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function parseMcaMasterData(payload) {
  return request("/api/mca-parse", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function parseMcaFindCinResults(payload) {
  return request("/api/mca-find-cin-parse", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loadAlerts(force = false) {
  if (!force && alertCache) {
    return alertCache;
  }

  if (!force && alertPromise) {
    return alertPromise;
  }

  alertPromise = request("/api/alerts")
    .then((payload) => {
      alertCache = payload;
      notifyAlerts();
      return payload;
    })
    .finally(() => {
      alertPromise = null;
    });

  return alertPromise;
}

export async function createAlert(payload) {
  await request("/api/alerts", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const alerts = await loadAlerts(true);
  recordWorkspaceEvent("alert_created", {
    product: payload?.product || "",
    recipientCount: Array.isArray(payload?.recipients) ? payload.recipients.length : 0,
    sourceCount: Array.isArray(payload?.filters?.sourceKeys) ? payload.filters.sourceKeys.length : 0,
  });
  return alerts;
}

export async function updateAlert(id, payload) {
  await request(`/api/alert-rule?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  const alerts = await loadAlerts(true);

  if (Object.prototype.hasOwnProperty.call(payload || {}, "enabled")) {
    recordWorkspaceEvent("alert_toggled", {
      alertId: id,
      enabled: Boolean(payload.enabled),
    });
  }

  return alerts;
}

export async function deleteAlert(id) {
  await request(`/api/alert-rule?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  const alerts = await loadAlerts(true);
  recordWorkspaceEvent("alert_deleted", { alertId: id });
  return alerts;
}

export async function testAlert(id) {
  const payload = await request(`/api/alert-test?id=${encodeURIComponent(id)}`, {
    method: "POST",
  });
  recordWorkspaceEvent("alert_tested", {
    alertId: id,
    delivered: Boolean(payload?.delivered),
    deliveryMode: payload?.deliveryMode || "local",
  });
  return payload;
}

export async function loadBilling(force = false) {
  if (!force && billingCache) {
    return billingCache;
  }

  if (!force && billingPromise) {
    return billingPromise;
  }

  billingPromise = request("/api/billing")
    .then((payload) => {
      billingCache = payload;
      notifyBilling();
      return payload;
    })
    .finally(() => {
      billingPromise = null;
    });

  return billingPromise;
}

export async function refreshBilling() {
  const payload = await request("/api/billing-refresh", { method: "POST" });
  billingCache = payload;
  notifyBilling();
  recordWorkspaceEvent("billing_plan_refreshed", {
    planKey: payload?.subscription?.planKey || payload?.subscription?.plan?.key || "",
  });
  return payload;
}

export async function startCheckout(planKey, billingEmail, successUrl, cancelUrl) {
  const payload = await request("/api/billing-checkout", {
    method: "POST",
    body: JSON.stringify({ planKey, billingEmail, successUrl, cancelUrl }),
  });
  billingCache = payload;
  notifyBilling();
  recordWorkspaceEvent("billing_plan_selected", {
    planKey,
    mode: payload?.mode || "checkout",
  });
  return payload;
}

export async function switchToFreePlan() {
  const payload = await request("/api/billing-free", { method: "POST" });
  billingCache = payload;
  notifyBilling();
  recordWorkspaceEvent("billing_plan_reset", {
    planKey: "free",
    mode: payload?.mode || "local",
  });
  return payload;
}

function authMarkup(session, syncLabel = "Refresh sources") {
  if (session?.signedIn) {
    return `
      <div class="auth-widget auth-widget--signed-in">
        <button type="button" class="auth-chip" data-auth-open>
          <span>${session.workspace?.name || "Workspace"}</span>
          <strong>${session.user?.name || "Account"}</strong>
        </button>
        <button type="button" class="auth-sync" data-auth-sync>${syncLabel}</button>
      </div>
    `;
  }

  return `
    <div class="auth-widget">
      <button type="button" class="auth-chip" data-auth-open>
        <span>Workspace</span>
        <strong>Sign in</strong>
      </button>
    </div>
  `;
}

function formatInviteStatus(invite) {
  if (invite.status === "active") {
    return "Active for 7 days";
  }

  if (invite.status === "used") {
    return "Used";
  }

  if (invite.status === "expired") {
    return "Expired";
  }

  return invite.status;
}

function modalMarkup(session, sources, errorMessage = "") {
  const sourceCards = (sources?.summary || [])
    .map(
      (item) => `
        <article class="auth-source-card">
          <span>${item.label}</span>
          <strong>${item.status === "live" ? `${item.itemCount} live records` : item.status}</strong>
          <p>${item.note}</p>
        </article>
      `,
    )
    .join("");

  if (session?.signedIn) {
    const inviteCards =
      session.workspace?.invites
        ?.map(
          (invite) => `
            <article class="auth-invite-card">
              <span>${formatInviteStatus(invite)}</span>
              <strong>${invite.code}</strong>
              <p>${invite.acceptedAt ? `Accepted ${new Date(invite.acceptedAt).toLocaleString()}` : `Created ${new Date(invite.createdAt).toLocaleString()}`}</p>
              ${invite.status === "active" ? `<button type="button" class="verify-inline-button" data-auth-copy-invite="${invite.code}">Copy invite</button>` : ""}
            </article>
          `,
        )
        .join("") || "<p class=\"verify-note\">No invite generated yet.</p>";
    const memberRows =
      session.workspace?.members
        ?.map(
          (member) => `
            <li>
              <strong>${member.name}</strong>
              <span>${member.role} · ${member.email}</span>
            </li>
          `,
        )
        .join("") || "<li><strong>No members yet</strong><span>Generate an invite to share this workspace.</span></li>";

    return `
      <div class="auth-modal-backdrop" data-auth-close>
        <div class="auth-modal" role="dialog" aria-modal="true">
          <div class="auth-modal-head">
            <div>
              <p class="eyebrow">Workspace</p>
              <h3>${session.workspace?.name || "Workspace"}</h3>
            </div>
            <button type="button" class="verify-inline-button" data-auth-close>Close</button>
          </div>
          <div class="auth-modal-grid">
            <div class="auth-panel">
              <p class="verify-block-label">Account</p>
              <p>${session.user.name} · ${session.user.email}</p>
              <p class="verify-note">Active role: ${session.workspace?.role || "member"} · ${session.workspace?.memberCount || 1} members</p>
              <p class="verify-block-label verify-block-label--push">Workspaces</p>
              <div class="auth-workspace-list">
                ${session.workspaces
                  .map(
                    (item) => `
                      <button
                        type="button"
                        class="verify-inline-button ${item.id === session.workspace.id ? "verify-inline-button--saved" : ""}"
                        data-auth-select-workspace="${item.id}"
                      >
                        ${item.name}
                      </button>
                    `,
                  )
                  .join("")}
              </div>
              <form class="auth-form" data-auth-create-workspace>
                <label class="verify-field">
                  <span>New workspace</span>
                  <input type="text" name="name" placeholder="Northstar Textiles" required />
                </label>
                <button type="submit" class="button button-secondary button-small">Create workspace</button>
              </form>
              <p class="verify-block-label verify-block-label--push">Join with invite</p>
              <form class="auth-form" data-auth-join-workspace>
                <label class="verify-field">
                  <span>Invite code</span>
                  <input type="text" name="code" placeholder="TG-ABC123-DEF456" required />
                </label>
                <button type="submit" class="button button-secondary button-small">Join workspace</button>
              </form>
              ${errorMessage ? `<p class="auth-error">${errorMessage}</p>` : ""}
              <button type="button" class="button button-primary button-small" data-auth-logout>Sign out</button>
            </div>
            <div class="auth-panel">
              <p class="verify-block-label">Members</p>
              <ul class="auth-member-list">${memberRows}</ul>
              <div class="auth-panel-actions">
                <button type="button" class="button button-secondary button-small" data-auth-create-invite>Create invite</button>
              </div>
              <div class="auth-invite-grid">${inviteCards}</div>
            </div>
            <div class="auth-panel">
              <p class="verify-block-label">Live source status</p>
              <div class="auth-source-grid">${sourceCards || "<p>No source snapshots yet.</p>"}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="auth-modal-backdrop" data-auth-close>
      <div class="auth-modal" role="dialog" aria-modal="true">
        <div class="auth-modal-head">
          <div>
            <p class="eyebrow">Workspace access</p>
            <h3>Sign in to persist state and sync live sources</h3>
          </div>
          <button type="button" class="verify-inline-button" data-auth-close>Close</button>
        </div>
        <div class="auth-modal-grid">
          <div class="auth-panel">
            <p class="verify-block-label">Quick start</p>
            <p>Use the seeded demo workspace, or create your own account and workspace.</p>
            <button type="button" class="button button-primary button-small" data-auth-demo>Use demo workspace</button>
            <p class="verify-block-label verify-block-label--push">Sign in</p>
            <form class="auth-form" data-auth-login>
              <label class="verify-field">
                <span>Email</span>
                <input type="email" name="email" placeholder="you@company.com" required />
              </label>
              <label class="verify-field">
                <span>Password</span>
                <input type="password" name="password" placeholder="Minimum 8 characters" required />
              </label>
              <button type="submit" class="button button-secondary button-small">Sign in</button>
            </form>
            <p class="verify-block-label verify-block-label--push">Create account</p>
            <form class="auth-form" data-auth-register>
              <label class="verify-field">
                <span>Name</span>
                <input type="text" name="name" placeholder="Northstar Ops" required />
              </label>
              <label class="verify-field">
                <span>Email</span>
                <input type="email" name="email" placeholder="ops@northstar.com" required />
              </label>
              <label class="verify-field">
                <span>Password</span>
                <input type="password" name="password" placeholder="Minimum 8 characters" required />
              </label>
              <button type="submit" class="button button-secondary button-small">Create account</button>
            </form>
            ${errorMessage ? `<p class="auth-error">${errorMessage}</p>` : ""}
          </div>
          <div class="auth-panel">
            <p class="verify-block-label">Live source status</p>
            <div class="auth-source-grid">${sourceCards || "<p>Loading source status…</p>"}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function mountAuthControls(topbar) {
  if (!topbar) {
    return;
  }

  await loadSession().catch(() => ({
    signedIn: false,
    demoAvailable: false,
  }));
  const sources = await loadSources().catch(() => null);

  let errorMessage = "";

  async function render(open = false, syncLabel = "Refresh sources") {
    const session = await loadSession().catch(() => ({
      signedIn: false,
      demoAvailable: false,
    }));
    const currentSources = await loadSources().catch(() => null);
    let slot = topbar.querySelector("[data-auth-slot]");

    if (!slot) {
      slot = document.createElement("div");
      slot.dataset.authSlot = "true";
      topbar.appendChild(slot);
    }

    slot.innerHTML = authMarkup(session, syncLabel);
    document.querySelectorAll(".auth-modal-backdrop").forEach((node) => node.remove());

    if (open) {
      document.body.insertAdjacentHTML("beforeend", modalMarkup(session, currentSources || sources, errorMessage));
      bindModal();
    }

    bindShell(slot);
  }

  window.addEventListener("tradegraph:session-changed", () => {
    render(false);
  });

  function bindShell(slot) {
    slot.querySelector("[data-auth-open]")?.addEventListener("click", () => {
      render(true);
    });

    slot.querySelector("[data-auth-sync]")?.addEventListener("click", async () => {
      await render(false, "Refreshing…");
      await syncSources().catch(() => null);
      await render(false);
    });
  }

  function bindModal() {
    document.querySelectorAll("[data-auth-close]").forEach((node) => {
      node.addEventListener("click", (event) => {
        if (event.target === node || node.dataset.authClose !== undefined) {
          document.querySelectorAll(".auth-modal-backdrop").forEach((modal) => modal.remove());
        }
      });
    });

    document.querySelector("[data-auth-demo]")?.addEventListener("click", async () => {
      errorMessage = "";
      await loginWithDemo();
      await render(false);
      window.location.reload();
    });

    document.querySelector("[data-auth-login]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      try {
        errorMessage = "";
        await loginWithPassword(form.get("email"), form.get("password"));
        await render(false);
        window.location.reload();
      } catch (error) {
        errorMessage = error.message;
        await render(true);
      }
    });

    document.querySelector("[data-auth-register]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      try {
        errorMessage = "";
        await registerAccount(form.get("name"), form.get("email"), form.get("password"));
        await render(false);
        window.location.reload();
      } catch (error) {
        errorMessage = error.message;
        await render(true);
      }
    });

    document.querySelector("[data-auth-create-workspace]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      try {
        errorMessage = "";
        await createWorkspace(form.get("name"));
        await render(true);
        window.location.reload();
      } catch (error) {
        errorMessage = error.message;
        await render(true);
      }
    });

    document.querySelector("[data-auth-join-workspace]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      try {
        errorMessage = "";
        await joinWorkspace(form.get("code"));
        await render(true);
        window.location.reload();
      } catch (error) {
        errorMessage = error.message;
        await render(true);
      }
    });

    document.querySelectorAll("[data-auth-select-workspace]").forEach((node) => {
      node.addEventListener("click", async () => {
        await selectWorkspace(node.dataset.authSelectWorkspace);
        await render(false);
        window.location.reload();
      });
    });

    document.querySelector("[data-auth-create-invite]")?.addEventListener("click", async () => {
      try {
        errorMessage = "";
        await createWorkspaceInvite();
        await render(true);
      } catch (error) {
        errorMessage = error.message;
        await render(true);
      }
    });

    document.querySelectorAll("[data-auth-copy-invite]").forEach((node) => {
      node.addEventListener("click", async () => {
        const code = node.dataset.authCopyInvite;

        if (!code) {
          return;
        }

        await navigator.clipboard.writeText(code).catch(() => null);
        node.textContent = "Copied";
      });
    });

    document.querySelector("[data-auth-logout]")?.addEventListener("click", async () => {
      await logout();
      await render(false);
      window.location.reload();
    });
  }

  await render(false);
}
