import {
  getTradeGraphAnalyticsUsageSummary,
  trackTradeGraphEvent,
} from "../lib/analytics.js";
import {
  createAlert,
  deleteAlert,
  loginWithDemo,
  loadAnalyticsSummary,
  loadAlerts,
  loadBilling,
  loadRuntime,
  loadSession,
  loadSources,
  refreshBilling,
  startCheckout,
  switchToFreePlan,
  syncSources,
  testAlert,
  updateAlert,
} from "../../../lib/workspace-client.js";

const PRODUCT_LABELS = {
  tenderradar: "TenderRadar",
  exportpulse: "ExportPulse",
  verifysme: "VerifySME",
};

const OPS_FOCUS = {
  sources: {
    label: "Source operations",
    heading: "Keep public-source coverage live and explain every gap.",
    intro:
      "Use this surface to inspect connector health, refresh live feeds, and verify whether source drift is a data issue or an access constraint.",
  },
  alerts: {
    label: "Alert operations",
    heading: "Turn source changes into saved alert workflows.",
    intro:
      "Create, test, and tune keyword rules so the suite can push only the tenders, notices, and supplier signals worth acting on.",
  },
  billing: {
    label: "Billing operations",
    heading: "See what is live, simulated, and customer-ready before charging anyone.",
    intro:
      "Check workspace packaging, provider readiness, and plan-state transitions so commercial controls stay honest instead of looking mocked.",
  },
  workspace: {
    label: "Workspace operations",
    heading: "Make collaboration and persistence visible to the user.",
    intro:
      "This view is where a guest becomes a real operator: shared workspaces, invite state, persistence, and cross-module ownership all stay explicit.",
  },
};

const DEFAULT_CARD_ORDER = ["workspace", "sources", "alerts", "billing", "runtime", "analytics"];

let detachControlCenterListeners = null;

function formatProviderStatus(provider) {
  if (provider.status === "configured" || provider.status === "active") {
    return "Live";
  }

  if (provider.status === "fallback" || provider.status === "simulated") {
    return "Fallback";
  }

  if (provider.status === "not_configured") {
    return "Missing";
  }

  return provider.status;
}

function renderStat(label, value, note) {
  return `
    <article class="ops-stat-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <p>${note}</p>
    </article>
  `;
}

function getFocusMeta(focusSection) {
  return OPS_FOCUS[focusSection] || {
    label: "Workspace Control Center",
    heading: "Operate the full TradeGraph workspace from one shared surface.",
    intro:
      "Configure live-source refresh, saved alerts, plan state, workspace access, and usage telemetry without leaving the product shell.",
  };
}

function getCardClassName(section, focusSection) {
  return `ops-card${focusSection === section ? " ops-card--focus" : ""}`;
}

function buildCardOrder(focusSection) {
  const preferred = [];

  if (focusSection && DEFAULT_CARD_ORDER.includes(focusSection)) {
    preferred.push(focusSection);
  }

  if (!preferred.includes("workspace")) {
    preferred.push("workspace");
  }

  DEFAULT_CARD_ORDER.forEach((section) => {
    if (!preferred.includes(section)) {
      preferred.push(section);
    }
  });

  return preferred;
}

function getWorkspaceModeLabel(session) {
  if (!session?.signedIn) {
    return "Guest";
  }

  if (String(session.workspace?.id || "").startsWith("demo")) {
    return "Demo";
  }

  return "Signed in";
}

function openWorkspaceAccess() {
  const trigger = document.querySelector("[data-auth-open]");

  if (!trigger) {
    return false;
  }

  trigger.click();
  return true;
}

function renderSourceRows(sources) {
  const summary = sources?.summary || [];

  if (!summary.length) {
    return `<p class="verify-note">No source snapshots have been synced yet.</p>`;
  }

  return `
    <div class="ops-source-list">
      ${summary
        .map(
          (source) => `
            <article class="ops-source-card">
              <div>
                <strong>${source.label}</strong>
                <p>${source.note || "No note available."}</p>
              </div>
              <div class="ops-source-meta">
                <span class="ops-badge ops-badge--${source.status}">${source.status}</span>
                <strong>${source.itemCount || 0}</strong>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRuleCards(payload) {
  const rules = payload?.rules || [];

  if (!rules.length) {
    return `
      <div class="ops-empty">
        <strong>No alert rules yet</strong>
        <p>Create a keyword-based alert for live tenders, DGFT notices, or registry signals.</p>
      </div>
    `;
  }

  return `
    <div class="ops-rule-list">
      ${rules
        .map(
          (rule) => `
            <article class="ops-rule-card">
              <div class="ops-rule-head">
                <div>
                  <span>${PRODUCT_LABELS[rule.product] || rule.product}</span>
                  <strong>${rule.label}</strong>
                </div>
                <button type="button" class="verify-inline-button" data-alert-toggle="${rule.id}">
                  ${rule.enabled ? "Pause" : "Enable"}
                </button>
              </div>
              <p>${(rule.filters?.keywords || []).join(", ")}</p>
              <div class="ops-rule-foot">
                <span>${(rule.filters?.sourceKeys || []).join(" · ")}</span>
                <span>${rule.lastTestedAt ? `Last tested ${new Date(rule.lastTestedAt).toLocaleString()}` : "Not tested yet"}</span>
                <span>${rule.recipients?.length ? `${rule.recipients.length} recipient${rule.recipients.length === 1 ? "" : "s"}` : "No recipients"}</span>
              </div>
              <div class="ops-rule-actions">
                <button type="button" class="button button-secondary button-small" data-alert-test="${rule.id}">Test send</button>
                <button type="button" class="button button-secondary button-small" data-alert-delete="${rule.id}">Delete</button>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPlanCards(billing) {
  const plans = billing?.plans || [];
  const activePlan = billing?.subscription?.planKey || "free";

  return plans
    .map(
      (plan) => `
        <article class="ops-plan-card ${plan.key === activePlan ? "ops-plan-card--active" : ""}">
          <span>${plan.label}</span>
          <strong>${plan.monthlyUsd ? `$${plan.monthlyUsd}/mo` : "Free"}</strong>
          <p>${plan.features.join(" · ")}</p>
          <button
            type="button"
            class="button ${plan.key === activePlan ? "button-secondary" : "button-primary"} button-small"
            data-plan-select="${plan.key}"
          >
            ${plan.key === activePlan ? "Current plan" : plan.key === "enterprise" ? "Request enterprise" : `Switch to ${plan.label}`}
          </button>
        </article>
      `,
    )
    .join("");
}

function renderPreview(preview) {
  if (!preview) {
    return `
      <div class="ops-empty">
        <strong>No recent delivery preview</strong>
        <p>Test an alert to inspect the exact payload and source matches before sending it to a buyer or bid team.</p>
      </div>
    `;
  }

  return `
    <div class="ops-preview">
      <p class="verify-block-label">Last alert preview</p>
      <strong>${preview.subject}</strong>
      <p>${preview.delivered ? "Delivered through Resend." : `Preview mode via ${preview.deliveryMode}.`}</p>
      <ul class="ops-preview-list">
        ${preview.matches
          .map(
            (match) => `
              <li>
                <strong>${match.title}</strong>
                <span>${match.sourceLabel}${match.meta ? ` · ${match.meta}` : ""}</span>
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function getSelectedSourceKeys(form) {
  return [...form.querySelectorAll('input[name="sourceKeys"]:checked')].map((node) => node.value);
}

function formatAnalyticsTimestamp(value) {
  if (!value) {
    return "Not yet";
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "Not yet" : timestamp.toLocaleString();
}

function pickMostRecentEvent(primary, fallback) {
  if (!primary) {
    return fallback;
  }

  if (!fallback) {
    return primary;
  }

  return new Date(primary.timestamp || 0).getTime() >= new Date(fallback.timestamp || 0).getTime()
    ? primary
    : fallback;
}

function resolveAnalyticsBundle(bundle) {
  const localSummary = getTradeGraphAnalyticsUsageSummary();

  if (!bundle?.summary) {
    return {
      source: "local",
      endpoint: "",
      error: bundle?.error || "",
      summary: localSummary,
    };
  }

  return {
    ...bundle,
    summary: {
      ...localSummary,
      ...bundle.summary,
      totalEvents: Math.max(bundle.summary.totalEvents || 0, localSummary.totalEvents || 0),
      distinctEvents: Math.max(bundle.summary.distinctEvents || 0, localSummary.distinctEvents || 0),
      pendingEvents: localSummary.pendingEvents,
      syncedEvents: Math.max(bundle.summary.syncedEvents || 0, localSummary.syncedEvents || 0),
      topEvents: bundle.summary.topEvents?.length ? bundle.summary.topEvents : localSummary.topEvents,
      lastEvent: pickMostRecentEvent(localSummary.lastEvent, bundle.summary.lastEvent),
      recentEvents: localSummary.recentEvents?.length ? localSummary.recentEvents : bundle.summary.recentEvents,
      lastError: bundle.summary.lastError || localSummary.lastError,
      transport: bundle.summary.transport || localSummary.transport,
      endpoint: bundle.summary.endpoint || bundle.endpoint || localSummary.endpoint,
    },
  };
}

function renderAnalyticsEventRows(summary) {
  const events = summary?.topEvents || [];

  if (!events.length) {
    return `
      <div class="ops-empty">
        <strong>No usage activity yet</strong>
        <p>Open a TradeGraph surface, sync live sources, or create an alert to populate the analytics slice.</p>
      </div>
    `;
  }

  return `
    <div class="ops-source-list">
      ${events
        .map(
          (event) => `
            <article class="ops-source-card">
              <div>
                <strong>${event.label || event.name}</strong>
                <p>${event.rawNames?.length > 1 ? event.rawNames.join(" · ") : event.name}</p>
              </div>
              <div class="ops-source-meta">
                <span class="ops-badge">Usage</span>
                <strong>${event.count || 0}</strong>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRecentAnalytics(summary) {
  const recentEvents = summary?.recentEvents?.slice(0, 4) || [];
  const lastEvent = summary?.lastEvent;

  if (!lastEvent) {
    return `
      <div class="ops-empty">
        <strong>No recent activity</strong>
        <p>The latest tracked TradeGraph action will appear here once the analytics slice records one.</p>
      </div>
    `;
  }

  return `
    <div class="ops-preview">
      <p class="verify-block-label">Latest activity</p>
      <strong>${lastEvent.label || lastEvent.name}</strong>
      <p>${formatAnalyticsTimestamp(lastEvent.timestamp)}${lastEvent.context?.path ? ` · ${lastEvent.context.path}` : ""}</p>
      <ul class="ops-preview-list">
        ${recentEvents
          .map(
            (event) => `
              <li>
                <strong>${event.label || event.name}</strong>
                <span>${formatAnalyticsTimestamp(event.timestamp)}${event.context?.path ? ` · ${event.context.path}` : ""}</span>
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderAnalyticsSummary(bundle, session) {
  const summary = bundle?.summary || getTradeGraphAnalyticsUsageSummary();
  const isRemote = bundle?.source === "remote";
  const supportNote = isRemote
    ? `Backend summary active${summary.endpoint ? ` via ${summary.endpoint}` : ""}. Local pending events are still merged in live.`
    : session?.signedIn
      ? "Local fallback is active until an analytics summary API responds for this workspace."
      : "Local fallback is active until you sign in to a workspace.";

  return `
    <article class="ops-card">
      <div class="ops-card-head">
        <div>
          <p class="verify-block-label">Usage analytics</p>
          <h3>Persistent workspace activity summary</h3>
        </div>
      </div>
      <p class="verify-note">${supportNote}</p>
      <div class="ops-stat-grid">
        ${renderStat("Tracked events", summary.totalEvents || 0, "Browser-side TradeGraph actions recorded")}
        ${renderStat("Usage signals", summary.distinctEvents || 0, "Grouped event types in the current slice")}
        ${renderStat("Pending sync", summary.pendingEvents || 0, isRemote ? "Waiting for backend acknowledgement" : "Queued locally until the analytics API is available")}
        ${renderStat("Synced", summary.syncedEvents || 0, summary.lastSyncedAt ? `Last sync ${formatAnalyticsTimestamp(summary.lastSyncedAt)}` : "No backend sync recorded yet")}
      </div>
      ${bundle?.error || summary.lastError ? `<p class="verify-note">Last analytics issue: ${bundle?.error || summary.lastError}</p>` : ""}
      ${renderAnalyticsEventRows(summary)}
      ${renderRecentAnalytics(summary)}
    </article>
  `;
}

function renderWorkspaceCard({ session, runtime, analytics, activatingDemo, focusSection }) {
  const workspaceName = session?.workspace?.name || "Guest workspace";
  const workspaceRole = session?.workspace?.role || "guest";
  const memberCount = session?.workspace?.memberCount || 0;
  const workspaceCount = session?.workspaces?.length || (session?.signedIn ? 1 : 0);
  const persistenceMode = runtime?.persistenceMode || "local-json";
  const analyticsMode = analytics?.source === "remote" ? "Workspace summary" : "Local fallback";
  const isGuest = !session?.signedIn;
  const canUseDemo = Boolean(session?.demoAvailable);
  const modeLabel = getWorkspaceModeLabel(session);
  const note = isGuest
    ? "Guest mode is good for browsing. Use the demo workspace or sign in to save alerts, refresh protected sources, persist billing state, and share the workspace."
    : "This workspace now owns saved alerts, billing state, and shared product context across VerifySME, TenderRadar, and ExportPulse.";

  return `
    <article class="${getCardClassName("workspace", focusSection)}">
      <div class="ops-card-head">
        <div>
          <p class="verify-block-label">Workspace access</p>
          <h3>${workspaceName}</h3>
        </div>
        <span class="ops-badge ${isGuest ? "ops-badge--simulated" : "ops-badge--active"}">${modeLabel}</span>
      </div>
      <p class="verify-note">${note}</p>
      <div class="ops-mini-grid">
        ${renderStat("Mode", modeLabel, isGuest ? "Local browser only" : "Workspace-backed state")}
        ${renderStat("Role", workspaceRole, isGuest ? "Access not granted yet" : "Current workspace membership")}
        ${renderStat("Members", memberCount, isGuest ? "Invite flow disabled in guest mode" : "People sharing this workspace")}
        ${renderStat("Analytics", analyticsMode, analyticsMode === "Workspace summary" ? "Merged with local pending events" : "Waiting for workspace sync")}
      </div>
      <div class="ops-preview">
        <p class="verify-block-label">What this unlocks</p>
        <strong>${isGuest ? "Persistent operations are locked behind workspace access." : `${workspaceCount} workspace${workspaceCount === 1 ? "" : "s"} available`}</strong>
        <p>Persistence: ${persistenceMode} · Billing, alerts, and evidence state follow the active workspace instead of staying isolated to one tab.</p>
      </div>
      <div class="ops-card-actions">
        <button type="button" class="button button-secondary button-small" data-open-workspace-access>
          ${isGuest ? "Open workspace access" : "Manage workspace"}
        </button>
        ${isGuest && canUseDemo ? `
          <button
            type="button"
            class="button button-primary button-small"
            data-use-demo-workspace
            ${activatingDemo ? "disabled" : ""}
          >
            ${activatingDemo ? "Starting demo…" : "Use demo workspace"}
          </button>
        ` : ""}
      </div>
    </article>
  `;
}

export function mountControlCenter(root, options = {}) {
  if (!root) {
    return;
  }

  detachControlCenterListeners?.();

  const focusSection = options.focusSection || "";
  const state = {
    session: null,
    sources: null,
    alerts: null,
    billing: null,
    runtime: null,
    analytics: null,
    preview: null,
    loading: true,
    error: "",
    syncing: false,
    activatingDemo: false,
  };

  if (typeof window !== "undefined") {
    const handleAnalyticsUpdated = (event) => {
      state.analytics = {
        ...(state.analytics || {}),
        summary: event.detail?.summary || getTradeGraphAnalyticsUsageSummary(),
      };
      render();
    };

    const handleAnalyticsSummaryUpdated = (event) => {
      if (event.detail) {
        state.analytics = event.detail;
        render();
      }
    };

    window.addEventListener("tradegraph:analytics-updated", handleAnalyticsUpdated);
    window.addEventListener("tradegraph:analytics-summary-updated", handleAnalyticsSummaryUpdated);

    detachControlCenterListeners = () => {
      window.removeEventListener("tradegraph:analytics-updated", handleAnalyticsUpdated);
      window.removeEventListener("tradegraph:analytics-summary-updated", handleAnalyticsSummaryUpdated);
      detachControlCenterListeners = null;
    };
  }

  async function refresh(force = false) {
    state.loading = true;
    render();

    try {
      const [session, sources, alerts, billing, runtime, analytics] = await Promise.all([
        loadSession(force),
        loadSources(force).catch(() => null),
        loadAlerts(force).catch(() => null),
        loadBilling(force).catch(() => null),
        loadRuntime(force).catch(() => null),
        loadAnalyticsSummary(force).catch(() => null),
      ]);

      state.session = session;
      state.sources = sources;
      state.alerts = alerts;
      state.billing = billing;
      state.runtime = runtime;
      state.analytics = analytics;
      state.error = "";
    } catch (error) {
      state.error = error.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  function render() {
    const session = state.session;
    const runtime = state.runtime?.runtime;
    const sourceCount = state.sources?.summary?.length || 0;
    const liveSourceCount =
      state.sources?.summary?.filter((source) => source.status === "live").length || 0;
    const alertCount = state.alerts?.rules?.length || 0;
    const subscription = state.billing?.subscription || null;
    const planLabel = subscription?.plan?.label || "Free";
    const analytics = resolveAnalyticsBundle(state.analytics);
    const focusMeta = getFocusMeta(focusSection);

    const cards = {
      workspace: renderWorkspaceCard({
        session,
        runtime,
        analytics,
        activatingDemo: state.activatingDemo,
        focusSection,
      }),
      sources: `
        <article class="${getCardClassName("sources", focusSection)}">
          <div class="ops-card-head">
            <div>
              <p class="verify-block-label">Source status</p>
              <h3>Connector health and live coverage</h3>
            </div>
          </div>
          ${renderSourceRows(state.sources)}
        </article>
      `,
      alerts: `
        <article class="${getCardClassName("alerts", focusSection)}">
          <div class="ops-card-head">
            <div>
              <p class="verify-block-label">Saved alerts</p>
              <h3>Create rules for tenders, notices, or registry signals</h3>
            </div>
          </div>
          <form class="ops-form" data-alert-create>
            <label class="verify-field">
              <span>Alert label</span>
              <input type="text" name="label" placeholder="Cold-chain tender watch" required />
            </label>
            <label class="verify-field">
              <span>Product</span>
              <select name="product">
                <option value="tenderradar">TenderRadar</option>
                <option value="exportpulse">ExportPulse</option>
                <option value="verifysme">VerifySME</option>
              </select>
            </label>
            <label class="verify-field">
              <span>Keywords</span>
              <input type="text" name="query" placeholder="cold chain, pharma logistics, reefer" required />
            </label>
            <label class="verify-field">
              <span>Additional recipients</span>
              <input type="text" name="recipients" placeholder="optional, comma-separated emails" />
            </label>
            <fieldset class="ops-checkbox-grid">
              <legend>Sources</legend>
              ${(state.sources?.summary || [])
                .map(
                  (source) => `
                    <label class="verify-toggle">
                      <input type="checkbox" name="sourceKeys" value="${source.key}" checked />
                      <span>${source.label}</span>
                    </label>
                  `,
                )
                .join("")}
            </fieldset>
            <button type="submit" class="button button-primary button-small" ${session?.signedIn ? "" : "disabled"}>
              Save alert
            </button>
          </form>
          ${renderRuleCards(state.alerts)}
        </article>
      `,
      billing: `
        <article class="${getCardClassName("billing", focusSection)}">
          <div class="ops-card-head">
            <div>
              <p class="verify-block-label">Plan and billing</p>
              <h3>Workspace packaging</h3>
            </div>
          </div>
          <p class="verify-note">
            ${subscription ? `Status: ${subscription.status} · ${subscription.seats} seat${subscription.seats === 1 ? "" : "s"}` : "Sign in to attach plan state to a workspace."}
          </p>
          <div class="ops-plan-grid">${renderPlanCards(state.billing)}</div>
          <button type="button" class="verify-inline-button" data-plan-free ${session?.signedIn ? "" : "disabled"}>Move workspace to Free</button>
        </article>
      `,
      runtime: `
        <article class="${getCardClassName("runtime", focusSection)}">
          <div class="ops-card-head">
            <div>
              <p class="verify-block-label">Runtime status</p>
              <h3>Provider readiness and delivery mode</h3>
            </div>
          </div>
          <div class="ops-provider-list">
            ${(runtime?.providers || [])
              .map(
                (provider) => `
                  <article class="ops-provider-card">
                    <div>
                      <strong>${provider.label}</strong>
                      <p>${provider.note}</p>
                    </div>
                    <span class="ops-badge ops-badge--${provider.status}">${formatProviderStatus(provider)}</span>
                  </article>
                `,
              )
              .join("")}
          </div>
          ${renderPreview(state.preview)}
        </article>
      `,
      analytics: renderAnalyticsSummary(analytics, session).replace(
        '<article class="ops-card">',
        `<article class="${getCardClassName("analytics", focusSection)}">`,
      ),
    };

    root.innerHTML = `
      <div class="ops-shell" id="workspace-control-center">
        <div class="ops-head">
          <div>
            <p class="eyebrow">${focusMeta.label}</p>
            <h2>${focusMeta.heading}</h2>
            <p class="section-intro">
              ${focusMeta.intro}
            </p>
          </div>
          <div class="ops-head-actions">
            <button
              type="button"
              class="button button-secondary button-small"
              data-ops-sync
              ${session?.signedIn ? "" : "disabled"}
            >
              ${state.syncing ? "Refreshing…" : "Sync live sources"}
            </button>
            <button
              type="button"
              class="button button-secondary button-small"
              data-ops-refresh-billing
              ${session?.signedIn ? "" : "disabled"}
            >
              Refresh billing
            </button>
          </div>
        </div>

        <div class="ops-stat-grid">
          ${renderStat("Plan", planLabel, "Current workspace packaging")}
          ${renderStat("Saved alerts", alertCount, "Keyword rules stored in the active workspace")}
          ${renderStat("Live adapters", `${liveSourceCount}/${sourceCount}`, "Configured source connectors reporting live status")}
          ${renderStat("Persistence", runtime?.persistenceMode || "local-json", "Where workspace state is currently stored")}
        </div>

        ${state.error ? `<p class="auth-error">${state.error}</p>` : ""}
        ${!session?.signedIn ? `<p class="verify-note">Use the demo workspace or open workspace access to save alert rules, upgrade plans, or trigger protected source refreshes.</p>` : ""}

        <div class="ops-grid">
          ${buildCardOrder(focusSection).map((section) => cards[section]).join("")}
        </div>
      </div>
    `;

    bind();
  }

  function bind() {
    root.querySelectorAll("[data-open-workspace-access]").forEach((node) => {
      node.addEventListener("click", () => {
        if (!openWorkspaceAccess()) {
          state.error = "Workspace access controls are not available on this page.";
          render();
        }
      });
    });

    root.querySelectorAll("[data-use-demo-workspace]").forEach((node) => {
      node.addEventListener("click", async () => {
        state.activatingDemo = true;
        state.error = "";
        render();

        try {
          await loginWithDemo();
          window.location.reload();
        } catch (error) {
          state.activatingDemo = false;
          state.error = error.message;
          render();
        }
      });
    });

    root.querySelector("[data-ops-sync]")?.addEventListener("click", async () => {
      state.syncing = true;
      render();
      try {
        await syncSources();
        trackTradeGraphEvent("ops_sync_sources", {
          workspaceId: state.session?.workspace?.id || "local",
        });
        await refresh(true);
      } finally {
        state.syncing = false;
        render();
      }
    });

    root.querySelector("[data-ops-refresh-billing]")?.addEventListener("click", async () => {
      await refreshBilling().catch(() => null);
      await refresh(true);
    });

    root.querySelector("[data-alert-create]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);

      try {
        await createAlert({
          label: data.get("label"),
          product: data.get("product"),
          recipients: String(data.get("recipients") || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          filters: {
            query: data.get("query"),
            sourceKeys: getSelectedSourceKeys(form),
          },
        });
        trackTradeGraphEvent("ops_create_alert", {
          product: data.get("product"),
        });
        form.reset();
        await refresh(true);
      } catch (error) {
        state.error = error.message;
        render();
      }
    });

    root.querySelectorAll("[data-alert-toggle]").forEach((node) => {
      node.addEventListener("click", async () => {
        const id = node.dataset.alertToggle;
        const rule = state.alerts?.rules?.find((item) => item.id === id);

        if (!rule) {
          return;
        }

        await updateAlert(id, { enabled: !rule.enabled });
        await refresh(true);
      });
    });

    root.querySelectorAll("[data-alert-test]").forEach((node) => {
      node.addEventListener("click", async () => {
        const preview = await testAlert(node.dataset.alertTest).catch((error) => ({
          subject: "Alert test failed",
          matches: [],
          delivered: false,
          deliveryMode: "error",
          message: error.message,
        }));
        state.preview = preview;
        trackTradeGraphEvent("ops_test_alert", {
          alertId: node.dataset.alertTest,
        });
        render();
      });
    });

    root.querySelectorAll("[data-alert-delete]").forEach((node) => {
      node.addEventListener("click", async () => {
        await deleteAlert(node.dataset.alertDelete);
        trackTradeGraphEvent("ops_delete_alert", {
          alertId: node.dataset.alertDelete,
        });
        await refresh(true);
      });
    });

    root.querySelectorAll("[data-plan-select]").forEach((node) => {
      node.addEventListener("click", async () => {
        const planKey = node.dataset.planSelect;

        if (!planKey || planKey === state.billing?.subscription?.planKey) {
          return;
        }

        const result = await startCheckout(
          planKey,
          state.session?.user?.email || "",
          `${window.location.origin}/dashboards.html#workspace-control-center`,
          `${window.location.origin}/dashboards.html#workspace-control-center`,
        );

        trackTradeGraphEvent("ops_plan_select", { planKey, mode: result.mode });

        if (result.checkoutUrl) {
          window.location.href = result.checkoutUrl;
          return;
        }

        state.preview = {
          subject: `Plan updated to ${planKey}`,
          matches: [],
          delivered: false,
          deliveryMode: result.mode || "local",
        };
        await refresh(true);
      });
    });

    root.querySelector("[data-plan-free]")?.addEventListener("click", async () => {
      await switchToFreePlan();
      trackTradeGraphEvent("ops_plan_select", { planKey: "free", mode: "local" });
      await refresh(true);
    });
  }

  refresh();
}
