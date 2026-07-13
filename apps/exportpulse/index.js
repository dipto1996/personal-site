import { supplierProfiles } from "../verifysme/index.js";
import { exportOpportunities, exportProfiles } from "./data/catalog.js";
import {
  buildBlockerMix,
  buildExportOpportunityView,
  buildMarketMix,
  getTopEntries,
  marketsMatch,
  summarizeExportWorkspace,
} from "../../lib/exportpulse.js";
import {
  getSessionSnapshot,
  loadInsights,
  loadSession,
  loadSources,
  onSessionChange,
  readPersistentState,
  syncSources,
  writePersistentState,
} from "../../lib/workspace-client.js";
import { suiteProfiles } from "../../lib/companygraph.js";
import { trackTradeGraphEvent } from "../tradegraph/lib/analytics.js";
import { buildExportPulseUrl, buildTenderRadarUrl, buildVerifySMEUrl } from "../tradegraph/lib/routing.js";
import { renderExportInsights } from "../tradegraph/ui/insights.js";

const STORAGE_KEYS = {
  profile: "exportpulse.profile",
  shortlist: "exportpulse.shortlist",
  workflow: "exportpulse.workflow",
  cases: "exportpulse.cases",
};
const STATE_NAMESPACE = "exportpulse.workspace";

const EXPORT_WORKFLOW_STAGES = ["Route review", "Docs fix", "Buyer outreach", "Pilot order"];
const ROUTE_OWNERS = ["Founder", "Export lead", "Commercial lead", "Channel manager"];
const ROUTE_DECISIONS = ["Needs review", "Launch now", "Fix docs first", "Deprioritize"];

export function getExportViewFromPathname(pathname = "") {
  if (pathname.includes("/route-detail")) {
    return "detail";
  }

  if (pathname.includes("/docs-readiness")) {
    return "docsReadiness";
  }

  if (pathname.includes("/markets")) {
    return "markets";
  }

  return "pipeline";
}

export function createDefaultRouteCase(routeId, overrides = {}) {
  return {
    routeId,
    stage: overrides.stage || EXPORT_WORKFLOW_STAGES[0],
    owner: overrides.owner || ROUTE_OWNERS[1],
    targetDate: overrides.targetDate || "",
    decision: overrides.decision || ROUTE_DECISIONS[0],
    topBlocker: overrides.topBlocker || "Documentation or compliance gaps still need review.",
    nextAction: overrides.nextAction || "Validate the route blockers and document pack before outreach.",
    buyerStatus: overrides.buyerStatus || "No outreach started",
    note: overrides.note || "",
    auditLog: Array.isArray(overrides.auditLog) ? overrides.auditLog : [],
    lastUpdated: overrides.lastUpdated || new Date().toISOString(),
  };
}

function getRouteCase(cases, routeId, stage) {
  return {
    ...createDefaultRouteCase(routeId, { stage }),
    ...(cases?.[routeId] || {}),
  };
}

function appendRouteAudit(caseRecord, message) {
  const entry = `${new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} · ${message}`;

  return [...(caseRecord.auditLog || []), entry].slice(-8);
}

function safeRead(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function fitClassName(value) {
  if (value === "Ready now") {
    return "high-fit";
  }

  if (value === "Needs 1-2 fixes") {
    return "medium-fit";
  }

  return "low-fit";
}

function formatCheckedAt(value) {
  if (!value) {
    return "Not synced yet";
  }

  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getSourceRecord(payload, key, label) {
  return payload?.sources?.find((item) => item.key === key) || {
    key,
    label,
    status: "unavailable",
    itemCount: 0,
    items: [],
    note: "No source snapshot available yet.",
    checkedAt: null,
  };
}

function renderTradeNoticeCards(payload) {
  const dgft = getSourceRecord(payload, "dgft", "DGFT Trade Notices");
  const recordItems = dgft.items?.slice(0, 3) || [];

  return `
    <article class="auth-source-card tender-source-card">
      <span>${dgft.label}</span>
      <strong>${dgft.status === "live" ? `${dgft.itemCount} live notices` : dgft.status}</strong>
      <p>${dgft.note}</p>
      <p class="verify-note">Checked ${formatCheckedAt(dgft.checkedAt)}</p>
    </article>
    ${recordItems
      .map(
        (item) => `
          <article class="auth-source-card tender-source-card tender-source-card--notice">
            <span>${item.noticeDate || "Trade notice"}</span>
            <strong>${item.title}</strong>
            <p>${item.pdfUrl ? `<a class="inline-link" href="${item.pdfUrl}" target="_blank" rel="noreferrer">Open notice PDF</a>` : "PDF not parsed yet."}</p>
          </article>
        `,
      )
      .join("")}
  `;
}

function renderSignalRows(entries, modifier) {
  if (!entries.length) {
    return '<p class="tender-empty-copy">No visible distribution in the current slice.</p>';
  }

  const max = Math.max(...entries.map(([, count]) => count));

  return entries
    .map(
      ([label, count]) => `
        <div class="tender-signal-row">
          <div class="tender-signal-head">
            <span>${label}</span>
            <strong>${count}</strong>
          </div>
          <div class="tender-signal-track">
            <span class="tender-signal-fill tender-signal-fill--${modifier}" style="width:${Math.max((count / max) * 100, count ? 18 : 0)}%"></span>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderRouteCaseBoard(shortlist, cases, workflow, profileId = "") {
  if (!shortlist.length) {
    return `
      <div class="verify-empty-panel verify-empty-panel--compact">
        <p class="eyebrow">Route queue</p>
        <h3>No active route queue yet</h3>
        <p>Save routes from the market stream to create a route execution queue with owners, target dates, and blocker tracking.</p>
      </div>
    `;
  }

  return `
    <div class="tg-case-grid">
      ${shortlist
        .map((item) => {
          const caseRecord = getRouteCase(cases, item.id, getExportWorkflowStage(item.id, workflow));
          return `
            <article class="tg-case-card ${item.analysis.readinessBand === "Ready now" ? "tg-case-card--good" : item.analysis.readinessBand === "Needs deeper work" ? "tg-case-card--alert" : ""}">
              <div class="tg-case-card-head">
                <div>
                  <span>${item.region} · ${item.channelModel}</span>
                  <strong>${item.market}</strong>
                </div>
                <span class="verify-stage-pill">${caseRecord.stage}</span>
              </div>
              <p>${caseRecord.nextAction}</p>
              <ul class="tg-meta-list">
                <li><strong>Owner</strong><span>${caseRecord.owner}</span></li>
                <li><strong>Decision</strong><span>${caseRecord.decision}</span></li>
                <li><strong>Target</strong><span>${caseRecord.targetDate || "Not set"}</span></li>
                <li><strong>Readiness</strong><span>${item.analysis.readinessBand}</span></li>
              </ul>
              <div class="verify-card-actions">
                <a class="verify-inline-button" href="${buildExportPulseUrl("detail", { profileId, routeId: item.id })}">Open route</a>
                <button class="verify-inline-button" data-export-select-id="${item.id}">Focus</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderRouteCaseDesk(opportunity, caseRecord) {
  if (!opportunity) {
    return "";
  }

  return `
    <article class="tg-case-card tg-case-card--detail">
      <div class="tg-case-card-head">
        <div>
          <span>Route case</span>
          <strong>${opportunity.market}</strong>
        </div>
        <span class="verify-stage-pill">${caseRecord.stage}</span>
      </div>
      <div class="tg-case-form">
        <label class="verify-field">
          <span>Owner</span>
          <select name="routeCaseOwner">
            ${ROUTE_OWNERS.map((owner) => `<option value="${owner}" ${owner === caseRecord.owner ? "selected" : ""}>${owner}</option>`).join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>Target date</span>
          <input type="date" name="routeCaseTargetDate" value="${caseRecord.targetDate}" />
        </label>
        <label class="verify-field">
          <span>Decision</span>
          <select name="routeCaseDecision">
            ${ROUTE_DECISIONS.map((decision) => `<option value="${decision}" ${decision === caseRecord.decision ? "selected" : ""}>${decision}</option>`).join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>Buyer status</span>
          <input type="text" name="routeCaseBuyerStatus" value="${caseRecord.buyerStatus}" placeholder="No outreach, shortlist built, pilot discussion..." />
        </label>
        <label class="verify-field verify-field--full">
          <span>Top blocker</span>
          <input type="text" name="routeCaseTopBlocker" value="${caseRecord.topBlocker}" placeholder="What still blocks route launch?" />
        </label>
        <label class="verify-field verify-field--full">
          <span>Next action</span>
          <input type="text" name="routeCaseNextAction" value="${caseRecord.nextAction}" placeholder="What should the export desk do next?" />
        </label>
        <label class="verify-field verify-field--full">
          <span>Operator note</span>
          <textarea name="routeCaseNote" rows="4" placeholder="Capture market nuance, partner caveats, or account context.">${caseRecord.note}</textarea>
        </label>
      </div>
      <ul class="tg-meta-list">
        <li><strong>Last updated</strong><span>${new Date(caseRecord.lastUpdated).toLocaleString()}</span></li>
        <li><strong>Margin band</strong><span>${opportunity.marginBand}</span></li>
      </ul>
      <div class="verify-proof-grid">
        ${(caseRecord.auditLog || []).length
          ? caseRecord.auditLog
              .slice()
              .reverse()
              .map(
                (entry) => `
                  <article class="verify-proof-card">
                    <span>Route audit</span>
                    <strong>${entry}</strong>
                    <p>Persisted inside the workspace route case.</p>
                  </article>
                `,
              )
              .join("")
          : `
            <article class="verify-proof-card">
              <span>Route audit</span>
              <strong>No route-case events yet</strong>
              <p>Owner changes and blocker updates will appear here.</p>
            </article>
          `}
      </div>
    </article>
  `;
}

function getRouteStance(opportunity) {
  if (opportunity.analysis.readinessBand === "Ready now") {
    return {
      label: "Pursue now",
      summary: "The supplier profile and documentation posture are strong enough to start market outreach immediately.",
    };
  }

  if (opportunity.analysis.readinessBand === "Needs 1-2 fixes") {
    return {
      label: "Fix docs, then pursue",
      summary: "This route is commercially plausible, but the next move should be documentation cleanup rather than outbound outreach.",
    };
  }

  return {
    label: "Do not force this route",
    summary: "The current supplier-market combination is too weak to justify immediate export effort.",
  };
}

function buildLaunchChecklist(opportunity) {
  return [
    `Confirm ${opportunity.channelModel.toLowerCase()} as the first commercial motion.`,
    ...opportunity.recommendedDocuments.slice(0, 2),
    ...opportunity.nextActions.slice(0, 2),
  ];
}

function getExportWorkflowStage(opportunityId, workflowMap) {
  return workflowMap[opportunityId] || EXPORT_WORKFLOW_STAGES[0];
}

function buildExportWorkflowSummary(workflowMap) {
  return EXPORT_WORKFLOW_STAGES.reduce(
    (accumulator, stage) => ({
      ...accumulator,
      [stage]: Object.values(workflowMap).filter((value) => value === stage).length,
    }),
    {},
  );
}

function buildRouteEvidence(active) {
  if (Array.isArray(active.sourceNotices) && active.sourceNotices.length) {
    return active.sourceNotices.map((notice) => ({
      source: "DGFT",
      artifact: notice.title,
      checked: notice.noticeDate || "Recent notice",
      confidence: active.provenance?.confidence || "Live notice",
      url: notice.pdfUrl || "",
    }));
  }

  return [
    {
      source: "Trade Connect",
      artifact: `${active.market} importer / distributor route scan`,
      checked: "Recent",
      confidence: "Market access note",
      url: "https://www.trade.gov.in/",
    },
    {
      source: "Compliance brief",
      artifact: active.complianceFocus[0],
      checked: "Recent",
      confidence: `${active.requiredCredentials.length} required credentials`,
      url: "",
    },
  ];
}

export function mountExportPulse(root) {
  if (!root) {
    return;
  }

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();

  const state = {
    profileId: params.get("profileId") || safeRead(STORAGE_KEYS.profile, exportProfiles[0].id),
    shortlistIds: safeRead(STORAGE_KEYS.shortlist, []),
    workflow: safeRead(STORAGE_KEYS.workflow, {}),
    cases: safeRead(STORAGE_KEYS.cases, {}),
    searchTerm: params.get("query") || "",
    readinessFilter: params.get("readinessBand") || "All",
    selectedOpportunityId: params.get("routeId") || "",
    session: getSessionSnapshot(),
    sourcePayload: null,
    syncingSources: false,
    insightsPayload: null,
    insightsLoading: false,
    hydrated: false,
  };

  function persistState() {
    if (!state.hydrated) {
      return;
    }

    const payload = {
      profileId: state.profileId,
      shortlistIds: state.shortlistIds,
      workflow: state.workflow,
      cases: state.cases,
      searchTerm: state.searchTerm,
      readinessFilter: state.readinessFilter,
      selectedOpportunityId: state.selectedOpportunityId,
    };

    writePersistentState(STATE_NAMESPACE, payload).catch(() => null);
  }

  function getActiveProfile() {
    return exportProfiles.find((profile) => profile.id === state.profileId) || exportProfiles[0];
  }

  function getActiveSupplier(profile = getActiveProfile()) {
    return supplierProfiles.find((supplier) => supplier.id === profile.supplierId) || supplierProfiles[0];
  }

  function updateRouteCase(routeId, updater) {
    const currentStage = state.workflow[routeId] || EXPORT_WORKFLOW_STAGES[0];
    const currentCase = getRouteCase(state.cases, routeId, currentStage);
    const nextCase = updater(currentCase);

    state.cases = {
      ...state.cases,
      [routeId]: {
        ...nextCase,
        stage: nextCase.stage || currentStage,
        lastUpdated: new Date().toISOString(),
      },
    };
    state.workflow = {
      ...state.workflow,
      [routeId]: nextCase.stage || currentStage,
    };
    safeWrite(STORAGE_KEYS.cases, state.cases);
    safeWrite(STORAGE_KEYS.workflow, state.workflow);
  }

  function updateUrlState() {
    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("profileId", state.profileId);
    nextUrl.searchParams.set("routeId", state.selectedOpportunityId);

    if (state.readinessFilter !== "All") {
      nextUrl.searchParams.set("readinessBand", state.readinessFilter);
    } else {
      nextUrl.searchParams.delete("readinessBand");
    }

    if (state.searchTerm) {
      nextUrl.searchParams.set("query", state.searchTerm);
    } else {
      nextUrl.searchParams.delete("query");
    }

    window.history.replaceState({}, "", `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`.replace(/\?$/, ""));
  }

  function getSuiteLinkage() {
    return suiteProfiles.find((item) => item.exportProfileId === state.profileId) || null;
  }

  function refreshInsights(force = false) {
    state.insightsLoading = true;

    return loadInsights(
      "exportpulse",
      {
        profileId: state.profileId,
        readinessBand: state.readinessFilter !== "All" ? state.readinessFilter : "",
      },
      force,
    )
      .then((payload) => {
        state.insightsPayload = payload;
      })
      .catch(() => {
        state.insightsPayload = null;
      })
      .finally(() => {
        state.insightsLoading = false;
        render();
      });
  }

  function getVisibleOpportunities() {
    const profile = getActiveProfile();
    const supplier = getActiveSupplier(profile);
    const scored = Array.isArray(state.insightsPayload?.entities?.visible) && state.insightsPayload.entities.visible.length
      ? state.insightsPayload.entities.visible
      : buildExportOpportunityView(
          exportOpportunities.filter(
            (opportunity) =>
              !profile.targetMarkets.length ||
              profile.targetMarkets.some((market) => marketsMatch(market, opportunity.market)) ||
              opportunity.matchSupplierIds.includes(supplier.id),
          ),
          supplier,
        );
    const term = state.searchTerm.trim().toLowerCase();

    return scored.filter((item) => {
      const matchesSearch =
        !term ||
        [item.market, item.region, item.sector, item.demandSignal, ...item.complianceFocus]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesReadiness =
        state.readinessFilter === "All" || item.analysis.readinessBand === state.readinessFilter;
      return matchesSearch && matchesReadiness;
    });
  }

  function toggleShortlist(opportunityId) {
    const wasSaved = state.shortlistIds.includes(opportunityId);
    state.shortlistIds = wasSaved
      ? state.shortlistIds.filter((id) => id !== opportunityId)
      : [...state.shortlistIds, opportunityId];
    safeWrite(STORAGE_KEYS.shortlist, state.shortlistIds);
    if (!wasSaved) {
      updateRouteCase(opportunityId, (currentCase) => ({
        ...currentCase,
        auditLog: appendRouteAudit(currentCase, "Route added to active export queue."),
      }));
    }
    persistState();
    trackTradeGraphEvent("exportpulse_shortlist_toggled", {
      opportunityId,
      count: state.shortlistIds.length,
    });
    render();
  }

  function render() {
    const profile = getActiveProfile();
    const supplier = getActiveSupplier(profile);
    const visible = getVisibleOpportunities();
    const summary = summarizeExportWorkspace(visible);
    const active =
      visible.find((item) => item.id === state.selectedOpportunityId) || visible[0] || null;

    if (active) {
      state.selectedOpportunityId = active.id;
    }

    updateUrlState();

    const marketMix = getTopEntries(buildMarketMix(visible), 4);
    const blockerMix = getTopEntries(buildBlockerMix(visible), 4);
    const routeStance = active ? getRouteStance(active) : null;
    const launchChecklist = active ? buildLaunchChecklist(active) : [];
    const workflowSummary = buildExportWorkflowSummary(state.workflow);
    const activeWorkflowStage = active ? getExportWorkflowStage(active.id, state.workflow) : "Route review";
    const routeEvidence = active ? buildRouteEvidence(active) : [];
    const workspaceName = state.session?.workspace?.name || "Local workspace";
    const dgftCards = renderTradeNoticeCards(state.sourcePayload);
    const suiteLinkage = getSuiteLinkage();
    const supplierHref = suiteLinkage
      ? buildVerifySMEUrl("detail", { supplierId: suiteLinkage.supplierId })
      : buildVerifySMEUrl("suppliers", { query: supplier.sector });
    const tenderHref = suiteLinkage
      ? buildTenderRadarUrl("opportunities", { profileId: suiteLinkage.tenderProfileId })
      : buildTenderRadarUrl("opportunities", { query: active?.sector || supplier.sector });
    const activeView = getExportViewFromPathname(typeof window !== "undefined" ? window.location.pathname : "");
    const shortlistRoutes = visible.filter((item) => state.shortlistIds.includes(item.id));
    const activeCase = active ? getRouteCase(state.cases, active.id, activeWorkflowStage) : null;
    const insightMarkup = state.insightsLoading
      ? '<div class="tradegraph-insight-loading">Loading live ExportPulse insights…</div>'
      : renderExportInsights(state.insightsPayload || {});
    const routeListMarkup = `
      <article class="tender-list-panel">
        <div class="tender-panel-head">
          <div>
            <p class="tender-block-label">Ranked export routes</p>
            <h3>${profile.label}</h3>
          </div>
          <span>${state.insightsPayload?.entities?.mode === "source-derived" ? "Live DGFT-derived route briefs" : profile.focus}</span>
        </div>

        <div class="tender-opportunity-list">
          ${
            visible.length
              ? visible
                  .map(
                    (item) => `
                      <article class="tender-opportunity ${item.id === state.selectedOpportunityId ? "tender-opportunity--active" : ""}">
                        <div class="tender-opportunity-head">
                          <div>
                            <p class="tender-opportunity-kicker">${item.region} · ${item.marginBand} margin</p>
                            <h4>${item.routeTitle || item.market}</h4>
                          </div>
                          <div class="tender-opportunity-pill-stack">
                            <span class="tender-stage-pill">${getExportWorkflowStage(item.id, state.workflow)}</span>
                            <span class="tender-fit-pill tender-fit-pill--${fitClassName(item.analysis.readinessBand)}">${item.analysis.readinessBand}</span>
                          </div>
                        </div>
                        <p class="tender-opportunity-summary">${item.demandSignal}</p>
                        <div class="tender-opportunity-meta">
                          <span>${item.channelModel}</span>
                          <span>Threshold ${item.readinessThreshold}</span>
                          <span>Score ${item.analysis.totalScore}</span>
                        </div>
                        <div class="verify-card-actions">
                          <button type="button" class="verify-inline-button" data-export-select-id="${item.id}">Open route</button>
                          <button type="button" class="verify-inline-button ${state.shortlistIds.includes(item.id) ? "verify-inline-button--saved" : ""}" data-export-watch-id="${item.id}">
                            ${state.shortlistIds.includes(item.id) ? "Saved" : "Save"}
                          </button>
                        </div>
                      </article>
                    `,
                  )
                  .join("")
              : `
                <div class="verify-empty-panel">
                  <p class="eyebrow">No routes visible</p>
                  <h3>Try a different market search or readiness slice</h3>
                  <p>The current combination is too narrow for the active route brief. Widen the market scope or change the exporter profile.</p>
                </div>
              `
          }
        </div>
      </article>
    `;
    const detailMarkup = active
      ? `
          <div class="tender-panel-head">
            <div>
              <p class="tender-block-label">Route detail</p>
              <h3>${active.market}</h3>
            </div>
            <span>${activeWorkflowStage} · Score ${active.analysis.totalScore}</span>
          </div>
          <div class="verify-decision-banner verify-decision-banner--${active.analysis.readinessBand === "Ready now" ? "strong" : active.analysis.readinessBand === "Needs 1-2 fixes" ? "caution" : "watch"}">
            <div>
              <p class="verify-block-label">Route stance</p>
              <strong>${routeStance.label}</strong>
              <p>${routeStance.summary}</p>
            </div>
            <div class="verify-decision-meta">
              <div>
                <span>Market motion</span>
                <strong>${active.channelModel}</strong>
              </div>
              <div>
                <span>Primary threshold</span>
                <strong>${active.readinessThreshold} readiness</strong>
              </div>
            </div>
          </div>
          <div class="verify-dossier-grid">
            <div class="verify-dossier-block">
              <p class="verify-block-label">Why this route fits</p>
              <ul>
                ${active.analysis.reasons.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>
            <div class="verify-dossier-block">
              <p class="verify-block-label">Blockers to clear</p>
              <ul>
                ${active.analysis.blockers.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>
          </div>
          <div class="verify-dossier-columns">
            <div>
              <p class="verify-block-label">Documents and compliance</p>
              <div class="verify-pill-row">
                ${active.requiredCredentials.map((item) => `<span class="verify-pill">${item}</span>`).join("")}
              </div>
              <p class="verify-block-label verify-block-label--push">Recommended pack</p>
              <ul class="verify-source-list">
                ${active.recommendedDocuments.map((item) => `<li>${item}</li>`).join("")}
              </ul>
              <p class="verify-block-label verify-block-label--push">Launch checklist</p>
              <ul class="verify-source-list">
                ${launchChecklist.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>
            <div>
              <p class="verify-block-label">Go-to-market path</p>
              <ul class="verify-source-list">
                <li>Channel: ${active.channelModel}</li>
                <li>Compliance focus: ${active.complianceFocus.join(", ")}</li>
                <li>Source cues: ${active.sourceSignals.join(", ")}</li>
                ${active.provenance?.theme ? `<li>Live route theme: ${active.provenance.theme}</li>` : ""}
                ${active.provenance?.checkedAt ? `<li>Last sync: ${formatCheckedAt(active.provenance.checkedAt)}</li>` : ""}
              </ul>
              <p class="verify-block-label verify-block-label--push">Route evidence</p>
              <div class="verify-proof-grid">
                ${routeEvidence
                  .map(
                    (item) => `
                      <article class="verify-proof-card">
                        <span>${item.source}</span>
                        <strong>${item.artifact}</strong>
                        <p>${item.checked} · ${item.confidence}</p>
                        ${
                          item.url
                            ? `<a class="inline-link" href="${item.url}" target="_blank" rel="noreferrer">View source</a>`
                            : `<span class="verify-proof-note">Analyst note on file</span>`
                        }
                      </article>
                    `,
                  )
                  .join("")}
              </div>
              <p class="verify-block-label verify-block-label--push">Next actions</p>
              <ul class="verify-source-list">
                ${active.nextActions.map((item) => `<li>${item}</li>`).join("")}
              </ul>
              <p class="verify-block-label verify-block-label--push">Risk notes</p>
              <p class="verify-note">${active.riskNotes.join(" · ")}</p>
              <p class="verify-block-label verify-block-label--push">Move route stage</p>
              <div class="verify-workflow-actions">
                ${EXPORT_WORKFLOW_STAGES.map(
                  (stage) => `
                    <button
                      type="button"
                      class="verify-inline-button ${stage === activeWorkflowStage ? "verify-inline-button--saved" : ""}"
                      data-set-export-stage="${stage}"
                      data-opportunity-id="${active.id}"
                    >
                      ${stage}
                    </button>
                  `,
                ).join("")}
              </div>
              <div class="tender-detail-actions">
                <a class="button button-secondary button-small" href="${supplierHref}">Open supplier diligence</a>
                <a class="button button-secondary button-small" href="${tenderHref}">Open bid qualification</a>
                <a class="button button-secondary button-small" href="${buildExportPulseUrl("detail", { profileId: state.profileId, routeId: active.id })}">Copy deep link</a>
              </div>
            </div>
          </div>
        `
      : `
          <div class="verify-empty-panel">
            <p class="eyebrow">No route selected</p>
            <h3>There is nothing to inspect in the current filter state</h3>
            <p>Broaden the search or choose another exporter profile.</p>
          </div>
        `;
    const sharedTopMarkup = `
      <div class="tender-stat-grid">
        <article class="tender-stat-card">
          <span class="tender-stat-label">Visible routes</span>
          <strong>${summary.total}</strong>
          <span>in the current profile slice</span>
        </article>
        <article class="tender-stat-card">
          <span class="tender-stat-label">Ready now</span>
          <strong>${summary.readyNow}</strong>
          <span>strongest near-term routes</span>
        </article>
        <article class="tender-stat-card">
          <span class="tender-stat-label">Needs 1-2 fixes</span>
          <strong>${summary.needsFixes}</strong>
          <span>close enough for focused execution</span>
        </article>
        <article class="tender-stat-card">
          <span class="tender-stat-label">High-margin routes</span>
          <strong>${summary.highMargin}</strong>
          <span>higher-value paths in this view</span>
        </article>
      </div>
      ${insightMarkup}
      <div class="tender-viz-grid">
        <article class="tender-viz-card">
          <div class="tender-viz-head">
            <p class="tender-block-label">Regional mix</p>
            <h3>Where the current exporter profile is strongest</h3>
          </div>
          ${renderSignalRows(marketMix, "buyer")}
        </article>
        <article class="tender-viz-card">
          <div class="tender-viz-head">
            <p class="tender-block-label">Readiness mix</p>
            <h3>How much work these routes still need</h3>
          </div>
          ${renderSignalRows(blockerMix, "sector")}
        </article>
        <article class="tender-viz-card">
          <div class="tender-viz-head">
            <p class="tender-block-label">Route queue</p>
            <h3>${state.shortlistIds.length} routes in active review</h3>
          </div>
          <p class="tender-telemetry-copy">
            ${workflowSummary["Route review"]} under route review · ${workflowSummary["Buyer outreach"]} already moved into buyer outreach.
          </p>
          <p class="tender-telemetry-copy">Next operator focus: clear documentation blockers before pushing buyer outreach.</p>
        </article>
      </div>
    `;
    const docsReadinessMarkup = `
      <section class="tender-stage">
        ${sharedTopMarkup}
        <section class="verify-ops-panel">
          <div class="verify-panel-head">
            <div>
              <p class="verify-block-label">Docs readiness desk</p>
              <h3>Document gaps, route blockers, and owner state in one view</h3>
            </div>
            <div class="verify-card-actions">
              <a class="verify-inline-button" href="${buildExportPulseUrl("markets", { profileId: state.profileId })}">Open route stream</a>
              <a class="verify-inline-button" href="${active ? buildExportPulseUrl("detail", { profileId: state.profileId, routeId: active.id }) : buildExportPulseUrl("route-pipeline", { profileId: state.profileId })}">Open active route</a>
            </div>
          </div>
          ${renderRouteCaseBoard(shortlistRoutes, state.cases, state.workflow, state.profileId)}
        </section>
        <section class="verify-workspace">
          <div class="verify-detail-panel">${detailMarkup}</div>
          <div class="verify-detail-panel">${renderRouteCaseDesk(active, activeCase)}</div>
        </section>
      </section>
    `;
    const stageMarkup =
      activeView === "pipeline"
        ? `
            <section class="tender-stage">
              ${sharedTopMarkup}
              <section class="verify-ops-panel">
                <div class="verify-panel-head">
                  <div>
                    <p class="verify-block-label">Route queue</p>
                    <h3>Saved routes with owner, decision, and target date</h3>
                  </div>
                  <div class="verify-card-actions">
                    <a class="verify-inline-button" href="${buildExportPulseUrl("markets", { profileId: state.profileId })}">Open market stream</a>
                    <a class="verify-inline-button" href="${buildExportPulseUrl("detail", { profileId: state.profileId, routeId: state.selectedOpportunityId })}">Open detail</a>
                  </div>
                </div>
                ${renderRouteCaseBoard(shortlistRoutes, state.cases, state.workflow, state.profileId)}
              </section>
              <section class="verify-workspace">
                <div class="verify-detail-panel">${detailMarkup}</div>
                <div class="verify-detail-panel">${renderRouteCaseDesk(active, activeCase)}</div>
              </section>
            </section>
          `
        : activeView === "docsReadiness"
          ? docsReadinessMarkup
        : activeView === "detail"
          ? `
              <section class="tender-stage">
                ${sharedTopMarkup}
                <section class="verify-workspace">
                  <div class="verify-detail-panel">
                    ${detailMarkup}
                    ${renderRouteCaseDesk(active, activeCase)}
                  </div>
                  <div class="verify-detail-panel">
                    ${renderRouteCaseBoard(shortlistRoutes, state.cases, state.workflow, state.profileId)}
                    <div class="tender-detail-actions">
                      <a class="button button-secondary button-small" href="${supplierHref}">Open supplier diligence</a>
                      <a class="button button-secondary button-small" href="${tenderHref}">Open bid qualification</a>
                    </div>
                  </div>
                </section>
              </section>
            `
          : `
              <section class="tender-stage">
                ${sharedTopMarkup}
                <div class="tender-workspace">
                  ${routeListMarkup}
                  <article class="tender-detail-panel">${detailMarkup}</article>
                </div>
              </section>
            `;

    root.innerHTML = `
      <div class="tender-app-shell exportpulse-shell tender-app-shell--${activeView}">
        <div class="tender-command">
          <div class="tender-command-copy">
            <p class="eyebrow">Active account</p>
            <h3>${workspaceName} export desk for route-by-route expansion.</h3>
            <p>
              This workspace turns market selection, documentation gaps, and buyer outreach
              into a route plan the team can actually execute over the next 30 days.
            </p>
          </div>
          <div class="tender-command-meta">
            <div class="tender-command-item">
              <span>Supplier basis</span>
              <strong>${supplier.name} · ${supplier.iecStatus}</strong>
            </div>
            <div class="tender-command-item">
              <span>Decision scope</span>
              <strong>${profile.targetMarkets.join(" / ")} · ${profile.channelModel}</strong>
            </div>
            <div class="tender-command-item">
              <span>Current desk load</span>
              <strong>${summary.readyNow} launchable routes · ${workflowSummary["Docs fix"]} fixing documentation</strong>
            </div>
          </div>
        </div>

        <div class="suite-action-band tender-source-band">
          <div>
            <p class="tender-block-label">Live trade intelligence</p>
            <h3>DGFT public notices are wired into this route-planning desk.</h3>
            <p class="verify-note">
              Manual refresh ${state.session?.signedIn ? "is enabled for signed-in workspace members." : "requires a signed-in workspace."} Current inventory mode: ${state.insightsPayload?.provenance?.dataMode || "loading"}.
            </p>
          </div>
          <div class="auth-source-grid">${dgftCards}</div>
          <div class="suite-action-band-actions">
            <button
              type="button"
              class="button button-secondary button-small"
              data-sync-export-sources
              ${state.session?.signedIn ? "" : "disabled"}
            >
              ${state.syncingSources ? "Refreshing trade notices…" : "Refresh trade notices"}
            </button>
          </div>
        </div>

        <div class="tender-layout">
          <aside class="tender-rail">
            <div class="tender-rail-card">
              <p class="tender-block-label">Exporter profiles</p>
              <div class="tender-profile-list">
                ${exportProfiles
                  .map(
                    (item) => `
                      <button type="button" class="tender-profile ${item.id === state.profileId ? "tender-profile--active" : ""}" data-export-profile-id="${item.id}">
                        <strong>${item.label}</strong>
                        <span>${item.channelModel}</span>
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </div>

            <div class="tender-rail-card">
              <p class="tender-block-label">Current supplier shape</p>
              <ul class="tender-note-list">
                <li>Company: ${supplier.name}</li>
                <li>Export readiness: ${supplier.exportReadiness}</li>
                <li>Known markets: ${supplier.exportMarkets.length ? supplier.exportMarkets.join(", ") : "No public markets yet"}</li>
                <li>IEC status: ${supplier.iecStatus}</li>
              </ul>
              <div class="verify-pill-row">
                ${supplier.certifications.map((item) => `<span class="verify-pill">${item}</span>`).join("")}
              </div>
            </div>

            <div class="tender-rail-card">
              <label class="tender-field">
                <span>Search market stream</span>
                <input type="search" name="searchTerm" value="${state.searchTerm}" placeholder="Try UAE, Singapore, industrial, apparel" />
              </label>
              <div class="tender-fit-row">
                ${["All", "Ready now", "Needs 1-2 fixes", "Needs deeper work"]
                  .map(
                    (item) => `
                      <button type="button" class="tender-fit-chip ${item === state.readinessFilter ? "tender-fit-chip--active" : ""}" data-readiness-filter="${item}">
                        ${item}
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </div>

            <div class="tender-rail-card">
              <p class="tender-block-label">Why this matters</p>
              <ul class="tender-note-list">
                <li>Exporters need a route-specific readiness view, not a giant export knowledge base.</li>
                <li>Readiness depends on market, product, and documentation fit together.</li>
                <li>The first sale often fails on paperwork and response speed, not just capability.</li>
              </ul>
            </div>
          </aside>

          ${stageMarkup}
        </div>
      </div>
    `;

    root.querySelectorAll("[data-export-profile-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.profileId = button.dataset.exportProfileId || exportProfiles[0].id;
        state.selectedOpportunityId = "";
        safeWrite(STORAGE_KEYS.profile, state.profileId);
        persistState();
        trackTradeGraphEvent("exportpulse_profile_switched", { profileId: state.profileId });
        refreshInsights(true);
        render();
      });
    });

    root.querySelector('input[name="searchTerm"]')?.addEventListener("input", (event) => {
      state.searchTerm = event.target.value;
      persistState();
      render();
    });

    root
      .querySelectorAll('select[name="routeCaseOwner"], input[name="routeCaseTargetDate"], select[name="routeCaseDecision"], input[name="routeCaseBuyerStatus"], input[name="routeCaseTopBlocker"], input[name="routeCaseNextAction"], textarea[name="routeCaseNote"]')
      .forEach((field) => {
        const handleRouteField = (event) => {
          if (!active) {
            return;
          }

          updateRouteCase(active.id, (currentCase) => ({
            ...currentCase,
            owner: event.currentTarget.name === "routeCaseOwner" ? event.currentTarget.value : currentCase.owner,
            targetDate:
              event.currentTarget.name === "routeCaseTargetDate" ? event.currentTarget.value : currentCase.targetDate,
            decision: event.currentTarget.name === "routeCaseDecision" ? event.currentTarget.value : currentCase.decision,
            buyerStatus:
              event.currentTarget.name === "routeCaseBuyerStatus" ? event.currentTarget.value : currentCase.buyerStatus,
            topBlocker:
              event.currentTarget.name === "routeCaseTopBlocker" ? event.currentTarget.value : currentCase.topBlocker,
            nextAction:
              event.currentTarget.name === "routeCaseNextAction" ? event.currentTarget.value : currentCase.nextAction,
            note: event.currentTarget.name === "routeCaseNote" ? event.currentTarget.value : currentCase.note,
          }));
          persistState();
        };

        field.addEventListener("input", handleRouteField);
        field.addEventListener("change", handleRouteField);
      });

    root.querySelectorAll("[data-readiness-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.readinessFilter = button.dataset.readinessFilter || "All";
        persistState();
        refreshInsights(true);
        render();
      });
    });

    root.querySelectorAll("[data-export-select-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedOpportunityId = button.dataset.exportSelectId || "";
        persistState();
        render();
      });
    });

    root.querySelectorAll("[data-export-watch-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const opportunityId = button.dataset.exportWatchId;
        if (opportunityId) {
          toggleShortlist(opportunityId);
        }
      });
    });

    root.querySelectorAll("[data-set-export-stage]").forEach((button) => {
      button.addEventListener("click", () => {
        const opportunityId = button.dataset.opportunityId;
        const nextStage = button.dataset.setExportStage;

        if (!opportunityId || !nextStage) {
          return;
        }

        updateRouteCase(opportunityId, (currentCase) => ({
          ...currentCase,
          stage: nextStage,
          auditLog: appendRouteAudit(currentCase, `Stage moved to ${nextStage}.`),
        }));
        persistState();
        trackTradeGraphEvent("exportpulse_stage_changed", { opportunityId, nextStage });
        render();
      });
    });

    root.querySelector("[data-sync-export-sources]")?.addEventListener("click", async () => {
      if (!state.session?.signedIn) {
        return;
      }

      state.syncingSources = true;
      render();
      await syncSources().catch(() => null);
      await refreshInsights(true);
      state.syncingSources = false;
      render();
    });
  }

  onSessionChange((session) => {
    state.session = session;
    refreshInsights(true);
    render();
  });

  window.addEventListener("tradegraph:sources-updated", (event) => {
    state.sourcePayload = event.detail;
    state.syncingSources = false;
    refreshInsights(true);
    render();
  });

  readPersistentState(STATE_NAMESPACE, {
    profileId: state.profileId,
    shortlistIds: state.shortlistIds,
    workflow: state.workflow,
    cases: state.cases,
    searchTerm: state.searchTerm,
    readinessFilter: state.readinessFilter,
    selectedOpportunityId: state.selectedOpportunityId,
  })
    .then((persisted) => {
      if (persisted && typeof persisted === "object") {
        state.profileId = persisted.profileId || state.profileId;
        state.shortlistIds = Array.isArray(persisted.shortlistIds) ? persisted.shortlistIds : state.shortlistIds;
        state.workflow = persisted.workflow && typeof persisted.workflow === "object" ? persisted.workflow : state.workflow;
        state.cases = persisted.cases && typeof persisted.cases === "object" ? persisted.cases : state.cases;
        state.searchTerm = persisted.searchTerm || state.searchTerm;
        state.readinessFilter = persisted.readinessFilter || state.readinessFilter;
        state.selectedOpportunityId = persisted.selectedOpportunityId || state.selectedOpportunityId;
      }

      return loadSession().catch(() => state.session);
    })
    .then((session) => {
      state.session = session || state.session;
      return loadSources().catch(() => null);
    })
    .then((payload) => {
      state.sourcePayload = payload;
      state.hydrated = true;
      return refreshInsights();
    })
    .catch(() => {
      state.hydrated = true;
      render();
    });

  trackTradeGraphEvent("exportpulse_viewed");
  render();
}
