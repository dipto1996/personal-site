import { tenderOpportunities, tenderProfiles } from "./data/catalog.js";
import { buildRadarView, formatCrore, formatLakh, getTopEntries, summarizeRadar } from "../../lib/tenderradar.js";
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
import { buildExportPulseUrl, buildTenderRadarUrl, buildVerifySMEUrl } from "../tradegraph/lib/routing.js";
import { trackTradeGraphEvent } from "../tradegraph/lib/analytics.js";
import { renderTenderInsights } from "../tradegraph/ui/insights.js";

const STORAGE_KEYS = {
  profile: "tenderradar.profile",
  shortlist: "tenderradar.shortlist",
  workflow: "tenderradar.workflow",
  cases: "tenderradar.cases",
};
const STATE_NAMESPACE = "tenderradar.workspace";

const TENDER_WORKFLOW_STAGES = ["Watch", "Bid review", "Needs partner", "Bid pack"];
const BID_OWNERS = ["Founder", "Bid lead", "Commercial lead", "Category manager"];
const BID_DECISIONS = ["Needs review", "Bid", "Bid with partner", "No bid"];

export function getTenderViewFromPathname(pathname = "") {
  if (pathname.includes("/opportunity-detail")) {
    return "detail";
  }

  if (pathname.includes("/bid-desk")) {
    return "bidDesk";
  }

  if (pathname.includes("/opportunities")) {
    return "opportunities";
  }

  return "pipeline";
}

export function createDefaultTenderCase(tenderId, overrides = {}) {
  return {
    tenderId,
    stage: overrides.stage || TENDER_WORKFLOW_STAGES[0],
    owner: overrides.owner || BID_OWNERS[1],
    dueDate: overrides.dueDate || "",
    decision: overrides.decision || BID_DECISIONS[0],
    partnerPlan: overrides.partnerPlan || "No partner assigned",
    nextAction: overrides.nextAction || "Inspect qualification gaps before bid commitment.",
    note: overrides.note || "",
    approval: overrides.approval || "Internal review pending",
    auditLog: Array.isArray(overrides.auditLog) ? overrides.auditLog : [],
    lastUpdated: overrides.lastUpdated || new Date().toISOString(),
  };
}

function getTenderCase(cases, tenderId, stage) {
  return {
    ...createDefaultTenderCase(tenderId, { stage }),
    ...(cases?.[tenderId] || {}),
  };
}

function appendTenderAudit(caseRecord, message) {
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
  return value.toLowerCase().replace(/\s+/g, "-");
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

function renderSourceCards(payload) {
  const records = [
    getSourceRecord(payload, "gem", "GeM BidPlus"),
    getSourceRecord(payload, "cppp", "CPPP ePublishing"),
  ];

  return records
    .map((record) => {
      const latestItem = record.items?.[0];
      const latestTitle = latestItem?.title || latestItem?.bidNumber || latestItem?.department || "No live sample yet";
      const statusLabel = record.status === "live" ? `${record.itemCount} records` : record.status;

      return `
        <article class="auth-source-card tender-source-card">
          <span>${record.label}</span>
          <strong>${statusLabel}</strong>
          <p>${record.note}</p>
          <p class="verify-note">Latest: ${latestTitle}</p>
          <p class="verify-note">Checked ${formatCheckedAt(record.checkedAt)}</p>
        </article>
      `;
    })
    .join("");
}

function getBidStance(opportunity) {
  if (opportunity.analysis.fitBand === "High fit" && opportunity.analysis.soloBidEligible) {
    return {
      label: "Bid now",
      summary: "The current company profile clears the visible solo-bid thresholds and has strong commercial fit.",
    };
  }

  if (opportunity.analysis.fitBand !== "Low fit" && opportunity.analysis.gaps.length <= 3) {
    return {
      label: "Prepare before bidding",
      summary: "The bid is plausible, but paperwork or capacity gaps should be closed before committing team effort.",
    };
  }

  return {
    label: "Do not prioritize",
    summary: "The current company profile is too far from the visible threshold or category fit to justify immediate effort.",
  };
}

function getPaymentSignal(opportunity) {
  if (opportunity.buyerType === "PSU" || opportunity.buyerType === "Central government") {
    return "Payment discipline is usually stronger than municipal buyers, but approval cycles can still slow realization.";
  }

  if (opportunity.buyerType === "Urban local body" || opportunity.buyerType === "State government") {
    return "Watch working-capital exposure closely; local approval and site-readiness delays can affect cash realization.";
  }

  return "Commercial follow-through depends heavily on lot administration and departmental paperwork quality.";
}

function getMsmeOverlay(profile, opportunity) {
  const hasMsmeSignal = profile.credentials.includes("MSME/Udyam");

  if (!hasMsmeSignal) {
    return "No visible MSME signal is present in the profile, so MSE-specific procurement benefits cannot be assumed.";
  }

  return `MSME/Udyam signal is visible. Review EMD, turnover, and buyer terms carefully because MSE relief may apply differently by portal and category for ${opportunity.buyerType.toLowerCase()} bids.`;
}

function buildSubmissionChecklist(opportunity, analysis) {
  const checklist = [
    "Download the tender document, annexures, and corrigendum trail before internal review.",
    `Validate EMD / fee assumptions against ${formatLakh(opportunity.emdLakh)} and portal rules.`,
    `Confirm visible turnover threshold of ${formatCrore(opportunity.minTurnoverCrore)} and project references.`,
  ];

  if (!analysis.soloBidEligible) {
    checklist.push("Escalate whether consortium / partner support is required before further bid work.");
  }

  checklist.push(`Assemble credential pack: ${opportunity.requiredCredentials.join(", ")}.`);
  checklist.push("Set an internal document freeze at least 48 hours before portal submission.");

  return checklist;
}

function getTenderWorkflowStage(tenderId, workflowMap) {
  return workflowMap[tenderId] || TENDER_WORKFLOW_STAGES[0];
}

function buildTenderWorkflowSummary(workflowMap) {
  return TENDER_WORKFLOW_STAGES.reduce(
    (accumulator, stage) => ({
      ...accumulator,
      [stage]: Object.values(workflowMap).filter((value) => value === stage).length,
    }),
    {},
  );
}

function buildTenderReference(opportunity) {
  return {
    refNo: `${opportunity.id}-${opportunity.state.slice(0, 3).toUpperCase()}-${new Date(opportunity.closingDate).getFullYear()}`,
    corrigenda: (opportunity.requiredCredentials.length % 3) + 1,
    documents: opportunity.requiredCredentials.length + opportunity.riskNotes.length + 3,
    preBidWindow: opportunity.analysis.daysLeft <= 8 ? "Within 72 hours" : "Within 7 days",
  };
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

function renderTenderCaseBoard(shortlist, cases, workflow, profileId = "") {
  if (!shortlist.length) {
    return `
      <div class="verify-empty-panel verify-empty-panel--compact">
        <p class="eyebrow">Bid queue</p>
        <h3>No active bid queue yet</h3>
        <p>Shortlist tenders from the opportunities view to create a real bid desk with owners, due dates, and decisions.</p>
      </div>
    `;
  }

  return `
    <div class="tg-case-grid">
      ${shortlist
        .map((item) => {
          const caseRecord = getTenderCase(cases, item.id, getTenderWorkflowStage(item.id, workflow));
          return `
            <article class="tg-case-card ${item.analysis.fitBand === "High fit" ? "tg-case-card--good" : item.analysis.fitBand === "Low fit" ? "tg-case-card--alert" : ""}">
              <div class="tg-case-card-head">
                <div>
                  <span>${item.source} · ${item.state}</span>
                  <strong>${item.title}</strong>
                </div>
                <span class="verify-stage-pill">${caseRecord.stage}</span>
              </div>
              <p>${caseRecord.nextAction}</p>
              <ul class="tg-meta-list">
                <li><strong>Owner</strong><span>${caseRecord.owner}</span></li>
                <li><strong>Decision</strong><span>${caseRecord.decision}</span></li>
                <li><strong>Due</strong><span>${caseRecord.dueDate || "Not set"}</span></li>
                <li><strong>Fit</strong><span>${item.analysis.fitBand}</span></li>
              </ul>
              <div class="verify-card-actions">
                <a class="verify-inline-button" href="${buildTenderRadarUrl("detail", { profileId, tenderId: item.id })}">Open case</a>
                <button class="verify-inline-button" data-open-tender="${item.id}">Focus</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTenderCaseDesk(opportunity, caseRecord) {
  if (!opportunity) {
    return "";
  }

  return `
    <article class="tg-case-card tg-case-card--detail">
      <div class="tg-case-card-head">
        <div>
          <span>Bid case</span>
          <strong>${opportunity.title}</strong>
        </div>
        <span class="verify-stage-pill">${caseRecord.stage}</span>
      </div>
      <div class="tg-case-form">
        <label class="verify-field">
          <span>Owner</span>
          <select name="tenderCaseOwner">
            ${BID_OWNERS.map((owner) => `<option value="${owner}" ${owner === caseRecord.owner ? "selected" : ""}>${owner}</option>`).join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>Due date</span>
          <input type="date" name="tenderCaseDueDate" value="${caseRecord.dueDate}" />
        </label>
        <label class="verify-field">
          <span>Decision</span>
          <select name="tenderCaseDecision">
            ${BID_DECISIONS.map((decision) => `<option value="${decision}" ${decision === caseRecord.decision ? "selected" : ""}>${decision}</option>`).join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>Partner plan</span>
          <input type="text" name="tenderCasePartnerPlan" value="${caseRecord.partnerPlan}" placeholder="Partner, OEM, or JV coverage" />
        </label>
        <label class="verify-field verify-field--full">
          <span>Next action</span>
          <input type="text" name="tenderCaseNextAction" value="${caseRecord.nextAction}" placeholder="What should the bid desk do next?" />
        </label>
        <label class="verify-field verify-field--full">
          <span>Operator note</span>
          <textarea name="tenderCaseNote" rows="4" placeholder="Capture buyer quirks, capability concerns, or handoff notes.">${caseRecord.note}</textarea>
        </label>
      </div>
      <ul class="tg-meta-list">
        <li><strong>Approval</strong><span>${caseRecord.approval}</span></li>
        <li><strong>Last updated</strong><span>${new Date(caseRecord.lastUpdated).toLocaleString()}</span></li>
      </ul>
      <div class="verify-proof-grid">
        ${(caseRecord.auditLog || []).length
          ? caseRecord.auditLog
              .slice()
              .reverse()
              .map(
                (entry) => `
                  <article class="verify-proof-card">
                    <span>Bid audit</span>
                    <strong>${entry}</strong>
                    <p>Persisted inside the workspace bid case.</p>
                  </article>
                `,
              )
              .join("")
          : `
            <article class="verify-proof-card">
              <span>Bid audit</span>
              <strong>No bid-case events yet</strong>
              <p>Owner changes and stage moves will show up here.</p>
            </article>
          `}
      </div>
    </article>
  `;
}

export function mountTenderRadar(root) {
  if (!root) {
    return;
  }

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();

  const state = {
    profileId: params.get("profileId") || safeRead(STORAGE_KEYS.profile, tenderProfiles[0].id),
    shortlistIds: safeRead(STORAGE_KEYS.shortlist, []),
    workflow: safeRead(STORAGE_KEYS.workflow, {}),
    cases: safeRead(STORAGE_KEYS.cases, {}),
    searchTerm: params.get("query") || "",
    fitFilter: params.get("fitBand") || "All",
    selectedTenderId: params.get("tenderId") || "",
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
      fitFilter: state.fitFilter,
      selectedTenderId: state.selectedTenderId,
    };

    writePersistentState(STATE_NAMESPACE, payload).catch(() => null);
  }

  function getActiveProfile() {
    return tenderProfiles.find((profile) => profile.id === state.profileId) || tenderProfiles[0];
  }

  function updateTenderCase(tenderId, updater) {
    const currentStage = state.workflow[tenderId] || TENDER_WORKFLOW_STAGES[0];
    const currentCase = getTenderCase(state.cases, tenderId, currentStage);
    const nextCase = updater(currentCase);

    state.cases = {
      ...state.cases,
      [tenderId]: {
        ...nextCase,
        stage: nextCase.stage || currentStage,
        lastUpdated: new Date().toISOString(),
      },
    };
    state.workflow = {
      ...state.workflow,
      [tenderId]: nextCase.stage || currentStage,
    };
    safeWrite(STORAGE_KEYS.cases, state.cases);
    safeWrite(STORAGE_KEYS.workflow, state.workflow);
  }

  function updateUrlState() {
    if (typeof window === "undefined") {
      return;
    }

    const profile = getActiveProfile();
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("profileId", profile.id);
    nextUrl.searchParams.set("tenderId", state.selectedTenderId);

    if (state.fitFilter !== "All") {
      nextUrl.searchParams.set("fitBand", state.fitFilter);
    } else {
      nextUrl.searchParams.delete("fitBand");
    }

    if (state.searchTerm) {
      nextUrl.searchParams.set("query", state.searchTerm);
    } else {
      nextUrl.searchParams.delete("query");
    }

    window.history.replaceState({}, "", `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`.replace(/\?$/, ""));
  }

  function getSuiteLinkage() {
    return suiteProfiles.find((item) => item.tenderProfileId === state.profileId) || null;
  }

  function refreshInsights(force = false) {
    state.insightsLoading = true;

    return loadInsights(
      "tenderradar",
      {
        profileId: state.profileId,
        fitBand: state.fitFilter !== "All" ? state.fitFilter : "",
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

  function getVisibleTenders() {
    const scored = Array.isArray(state.insightsPayload?.entities?.visible) && state.insightsPayload.entities.visible.length
      ? state.insightsPayload.entities.visible
      : buildRadarView(tenderOpportunities, getActiveProfile());
    const term = state.searchTerm.trim().toLowerCase();

    return scored.filter((item) => {
      const matchesSearch =
        !term ||
        [item.title, item.buyer, item.buyerType, item.sector, item.scopeSummary, ...item.keywords]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesFit = state.fitFilter === "All" || item.analysis.fitBand === state.fitFilter;

      return matchesSearch && matchesFit;
    });
  }

  function toggleShortlist(tenderId) {
    const wasSaved = state.shortlistIds.includes(tenderId);
    state.shortlistIds = wasSaved
      ? state.shortlistIds.filter((id) => id !== tenderId)
      : [...state.shortlistIds, tenderId];
    safeWrite(STORAGE_KEYS.shortlist, state.shortlistIds);
    if (!wasSaved) {
      updateTenderCase(tenderId, (currentCase) => ({
        ...currentCase,
        auditLog: appendTenderAudit(currentCase, "Tender added to active bid shortlist."),
      }));
    }
    persistState();
    trackTradeGraphEvent("tenderradar_shortlist_toggled", {
      tenderId,
      count: state.shortlistIds.length,
    });
    render();
  }

  function render() {
    const profile = getActiveProfile();
    const visibleTenders = getVisibleTenders();
    const summary = summarizeRadar(visibleTenders);
    const activeTender =
      visibleTenders.find((item) => item.id === state.selectedTenderId) || visibleTenders[0] || null;

    if (activeTender) {
      state.selectedTenderId = activeTender.id;
    }

    updateUrlState();

    const buyerMix = getTopEntries(summary.buyerMix, 4);
    const sectorMix = getTopEntries(summary.sectorMix, 4);
    const shortlistReady = visibleTenders.filter(
      (item) =>
        item.analysis.soloBidEligible &&
        item.analysis.fitBand !== "Low fit" &&
        item.analysis.gaps.length <= 2,
    ).length;
    const bidStance = activeTender ? getBidStance(activeTender) : null;
    const paymentSignal = activeTender ? getPaymentSignal(activeTender) : "";
    const msmeOverlay = activeTender ? getMsmeOverlay(profile, activeTender) : "";
    const submissionChecklist = activeTender ? buildSubmissionChecklist(activeTender, activeTender.analysis) : [];
    const workflowSummary = buildTenderWorkflowSummary(state.workflow);
    const activeWorkflowStage = activeTender ? getTenderWorkflowStage(activeTender.id, state.workflow) : "Watch";
    const tenderReference = activeTender ? buildTenderReference(activeTender) : null;
    const workspaceName = state.session?.workspace?.name || "Local workspace";
    const procurementSourceCards = renderSourceCards(state.sourcePayload);
    const suiteLinkage = getSuiteLinkage();
    const supplierHref = suiteLinkage
      ? buildVerifySMEUrl("detail", { supplierId: suiteLinkage.supplierId })
      : buildVerifySMEUrl("suppliers", { query: activeTender?.sector || "" });
    const routeHref = suiteLinkage
      ? buildExportPulseUrl("markets", { profileId: suiteLinkage.exportProfileId })
      : buildExportPulseUrl("markets", { query: activeTender?.sector || "" });
    const activeView = getTenderViewFromPathname(typeof window !== "undefined" ? window.location.pathname : "");
    const shortlistTenders = visibleTenders.filter((item) => state.shortlistIds.includes(item.id));
    const activeCase = activeTender ? getTenderCase(state.cases, activeTender.id, activeWorkflowStage) : null;
    const insightMarkup = state.insightsLoading
      ? '<div class="tradegraph-insight-loading">Loading live TenderRadar insights…</div>'
      : renderTenderInsights(state.insightsPayload || {});
    const listPanelMarkup = `
      <article class="tender-list-panel">
        <div class="tender-panel-head">
          <div>
            <p class="tender-block-label">Ranked opportunity stream</p>
            <h3>${profile.label}</h3>
          </div>
          <span>${state.insightsPayload?.entities?.mode === "source-derived" ? "Live GeM + CPPP entities" : profile.categories.join(" · ")}</span>
        </div>

        <div class="tender-opportunity-list">
          ${
            visibleTenders.length
              ? visibleTenders
                  .map(
                    (item) => `
                      <article class="tender-opportunity ${item.id === state.selectedTenderId ? "tender-opportunity--active" : ""}">
                        <div class="tender-opportunity-head">
                          <div>
                            <p class="tender-opportunity-kicker">${item.source} · ${item.state}</p>
                            <h4>${item.title}</h4>
                          </div>
                          <div class="tender-opportunity-pill-stack">
                            <span class="tender-stage-pill">${getTenderWorkflowStage(item.id, state.workflow)}</span>
                            <span class="tender-fit-pill tender-fit-pill--${fitClassName(item.analysis.fitBand)}">${item.analysis.fitBand}</span>
                          </div>
                        </div>
                        <p class="tender-opportunity-summary">${item.scopeSummary}</p>
                        <div class="tender-opportunity-meta">
                          <span>${item.buyer}</span>
                          <span>${item.buyerType}</span>
                          <span>${formatCrore(item.estimatedValueCrore)}</span>
                          <span>${item.analysis.daysLeft} days left</span>
                        </div>
                        <div class="tender-opportunity-actions">
                          <button type="button" class="verify-inline-button" data-open-tender="${item.id}">Inspect fit</button>
                          <button type="button" class="verify-inline-button ${state.shortlistIds.includes(item.id) ? "verify-inline-button--saved" : ""}" data-shortlist-tender="${item.id}">
                            ${state.shortlistIds.includes(item.id) ? "Saved" : "Shortlist"}
                          </button>
                        </div>
                      </article>
                    `,
                  )
                  .join("")
              : `
                <div class="verify-empty-panel">
                  <h3>No bids match this slice yet.</h3>
                  <p>Clear the search or widen the fit filter to restore the queue.</p>
                </div>
              `
          }
        </div>
      </article>
    `;
    const detailMarkup = activeTender
      ? `
          <div class="tender-dossier-head">
            <div>
              <p class="tender-block-label">Tender brief</p>
              <h3>${activeTender.title}</h3>
            </div>
            <div class="tender-dossier-score">
              <span>${activeWorkflowStage}</span>
              <strong>${activeTender.analysis.totalScore}</strong>
            </div>
          </div>

          <div class="tender-dossier-grid">
            <div class="tender-dossier-block">
              <p class="tender-block-label">Bid stance</p>
              <ul class="verify-source-list">
                <li><strong>${bidStance.label}</strong></li>
                <li>${bidStance.summary}</li>
              </ul>
            </div>

            <div class="tender-dossier-block">
              <p class="tender-block-label">Visible facts</p>
              <ul class="verify-source-list">
                <li>Reference: ${tenderReference.refNo}</li>
                <li>Buyer: ${activeTender.buyer}</li>
                <li>Type: ${activeTender.buyerType}</li>
                <li>Sector: ${activeTender.sector}</li>
                <li>Estimated value: ${formatCrore(activeTender.estimatedValueCrore)}</li>
                <li>EMD: ${formatLakh(activeTender.emdLakh)}</li>
                <li>Minimum turnover: ${formatCrore(activeTender.minTurnoverCrore)}</li>
                <li>Past projects: ${activeTender.minPastProjects}</li>
              </ul>
            </div>

            <div class="tender-dossier-block">
              <p class="tender-block-label">Why it matches</p>
              <ul class="verify-source-list">
                <li>Solo-bid eligibility: ${activeTender.analysis.soloBidEligible ? "Visible thresholds cleared" : "Threshold blockers visible"}</li>
                ${activeTender.analysis.reasons.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>

            <div class="tender-dossier-block">
              <p class="tender-block-label">Qualification gaps</p>
              <ul class="verify-source-list">
                ${activeTender.analysis.gaps.length ? activeTender.analysis.gaps.map((item) => `<li>${item}</li>`).join("") : "<li>No visible blockers in the current profile.</li>"}
              </ul>
            </div>

            <div class="tender-dossier-block">
              <p class="tender-block-label">Required credentials</p>
              <div class="verify-pill-row">
                ${activeTender.requiredCredentials.map((item) => `<span class="verify-pill">${item}</span>`).join("")}
              </div>
            </div>

            <div class="tender-dossier-block">
              <p class="tender-block-label">Submission checklist</p>
              <ul class="verify-source-list">
                ${submissionChecklist.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>

            <div class="tender-dossier-block">
              <p class="tender-block-label">Commercial watch-outs</p>
              <ul class="verify-source-list">
                <li>${paymentSignal}</li>
                <li>${msmeOverlay}</li>
                ${activeTender.riskNotes.map((item) => `<li>${item}</li>`).join("")}
              </ul>
            </div>

            <div class="tender-dossier-block">
              <p class="tender-block-label">Source trace</p>
              <ul class="verify-source-list">
                <li>Portal: ${activeTender.source}</li>
                <li>Closing date: ${activeTender.closingDate}</li>
                <li>Visible document pack: ${tenderReference.documents} items</li>
                <li>Corrigendum count: ${tenderReference.corrigenda}</li>
                <li>Pre-bid window: ${tenderReference.preBidWindow}</li>
                ${activeTender.provenance?.confidence ? `<li>Source confidence: ${activeTender.provenance.confidence}</li>` : ""}
                ${activeTender.provenance?.checkedAt ? `<li>Last sync: ${formatCheckedAt(activeTender.provenance.checkedAt)}</li>` : ""}
                ${activeTender.provenance?.referenceNumber ? `<li>Reference: ${activeTender.provenance.referenceNumber}</li>` : ""}
                ${Array.isArray(activeTender.provenance?.inferredFields) && activeTender.provenance.inferredFields.length ? `<li>Inferred fields: ${activeTender.provenance.inferredFields.join(", ")}</li>` : ""}
              </ul>
            </div>

            <div class="tender-dossier-block">
              <p class="tender-block-label">Bid workflow</p>
              <ul class="verify-source-list">
                <li>Current stage: ${activeWorkflowStage}</li>
                <li>Urgency: ${activeTender.analysis.urgency}</li>
                <li>Next move: ${bidStance.label}</li>
              </ul>
              <div class="verify-workflow-actions">
                ${TENDER_WORKFLOW_STAGES.map(
                  (stage) => `
                    <button
                      type="button"
                      class="verify-inline-button ${stage === activeWorkflowStage ? "verify-inline-button--saved" : ""}"
                      data-set-tender-stage="${stage}"
                      data-tender-id="${activeTender.id}"
                    >
                      ${stage}
                    </button>
                  `,
                ).join("")}
              </div>
            </div>
          </div>

          <div class="tender-detail-actions">
            <button type="button" class="button button-primary button-small" data-shortlist-tender="${activeTender.id}">
              ${state.shortlistIds.includes(activeTender.id) ? "Remove from shortlist" : "Shortlist for bid review"}
            </button>
            <a class="button button-secondary button-small" href="${activeTender.sourceUrl}" target="_blank" rel="noreferrer">Open source portal</a>
            <a class="button button-secondary button-small" href="${supplierHref}">Open supplier diligence</a>
          </div>
        `
      : `
          <div class="verify-empty-panel">
            <h3>No tender selected.</h3>
            <p>Select a bid from the queue to inspect fit and qualification gaps.</p>
          </div>
        `;
    const sharedTopMarkup = `
      <div class="tender-stat-grid">
        <article class="tender-stat-card">
          <span class="tender-stat-label">Visible bids</span>
          <strong>${summary.counts.matched}</strong>
          <span>after profile + filters</span>
        </article>
        <article class="tender-stat-card">
          <span class="tender-stat-label">High fit</span>
          <strong>${summary.counts.highFit}</strong>
          <span>best near-term candidates</span>
        </article>
        <article class="tender-stat-card">
          <span class="tender-stat-label">Closing soon</span>
          <strong>${summary.counts.closingSoon}</strong>
          <span>need immediate review</span>
        </article>
        <article class="tender-stat-card">
          <span class="tender-stat-label">Shortlist-ready</span>
          <strong>${shortlistReady}</strong>
          <span>medium/high fit with visible solo-bid eligibility</span>
        </article>
      </div>
      ${insightMarkup}
      <div class="tender-viz-grid">
        <article class="tender-viz-card">
          <div class="tender-viz-head">
            <p class="tender-block-label">Buyer mix</p>
            <h3>Who is buying in this slice?</h3>
          </div>
          ${renderSignalRows(buyerMix, "buyer")}
        </article>
        <article class="tender-viz-card">
          <div class="tender-viz-head">
            <p class="tender-block-label">Sector hotspots</p>
            <h3>Where this profile is seeing volume</h3>
          </div>
          ${renderSignalRows(sectorMix, "sector")}
        </article>
        <article class="tender-viz-card">
          <div class="tender-viz-head">
            <p class="tender-block-label">Review queue</p>
            <h3>${state.shortlistIds.length} bids in the active desk</h3>
          </div>
          <p class="tender-telemetry-copy">
            ${workflowSummary["Bid review"]} in bid review · ${workflowSummary["Needs partner"]} need partner coverage · ${workflowSummary["Bid pack"]} already moved to bid-pack prep.
          </p>
          <p class="tender-telemetry-copy">Next internal focus: ${summary.counts.closingSoon ? "clear closing-soon bids first" : "promote medium-fit bids into structured review"}.</p>
        </article>
      </div>
    `;
    const bidDeskMarkup = `
      <section class="tender-stage">
        ${sharedTopMarkup}
        <section class="verify-ops-panel">
          <div class="verify-panel-head">
            <div>
              <p class="verify-block-label">Bid desk</p>
              <h3>Shortlisted pursuits with owner, stage, and decision state</h3>
            </div>
            <div class="verify-card-actions">
              <a class="verify-inline-button" href="${buildTenderRadarUrl("opportunities", { profileId: state.profileId })}">Open opportunity stream</a>
              <a class="verify-inline-button" href="${activeTender ? buildTenderRadarUrl("detail", { profileId: state.profileId, tenderId: activeTender.id }) : buildTenderRadarUrl("pipeline", { profileId: state.profileId })}">Open active detail</a>
            </div>
          </div>
          ${renderTenderCaseBoard(shortlistTenders, state.cases, state.workflow, state.profileId)}
        </section>
        <section class="verify-workspace">
          <div class="verify-detail-panel">${detailMarkup}</div>
          <div class="verify-detail-panel">${renderTenderCaseDesk(activeTender, activeCase)}</div>
        </section>
        <div class="tender-footer">
          <p>
            Use this desk when the team has already shortlisted bids and needs a tighter operating view across owner, stage, partner coverage, and next action.
          </p>
          <div class="tender-detail-actions">
            <a class="button button-secondary button-small" href="${supplierHref}">Review supplier diligence</a>
            <a class="button button-secondary button-small" href="${routeHref}">Open export route planning</a>
          </div>
        </div>
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
                    <p class="verify-block-label">Bid queue</p>
                    <h3>Shortlisted pursuits with owner, decision, and due date</h3>
                  </div>
                  <div class="verify-card-actions">
                    <a class="verify-inline-button" href="${buildTenderRadarUrl("opportunities", { profileId: state.profileId })}">Open opportunity stream</a>
                    <a class="verify-inline-button" href="${buildTenderRadarUrl("detail", { profileId: state.profileId, tenderId: state.selectedTenderId })}">Open detail</a>
                  </div>
                </div>
                ${renderTenderCaseBoard(shortlistTenders, state.cases, state.workflow, state.profileId)}
              </section>
              <section class="verify-workspace">
                <div class="verify-detail-panel">${detailMarkup}</div>
                <div class="verify-detail-panel">${renderTenderCaseDesk(activeTender, activeCase)}</div>
              </section>
            </section>
          `
        : activeView === "bidDesk"
          ? bidDeskMarkup
        : activeView === "detail"
          ? `
              <section class="tender-stage">
                ${sharedTopMarkup}
                <section class="verify-workspace">
                  <div class="verify-detail-panel">
                    ${detailMarkup}
                    ${renderTenderCaseDesk(activeTender, activeCase)}
                  </div>
                  <div class="verify-detail-panel">
                    ${renderTenderCaseBoard(shortlistTenders, state.cases, state.workflow, state.profileId)}
                    <div class="tender-detail-actions">
                      <a class="button button-secondary button-small" href="${supplierHref}">Review supplier</a>
                      <a class="button button-secondary button-small" href="${routeHref}">Open route planning</a>
                    </div>
                  </div>
                </section>
              </section>
            `
          : `
              <section class="tender-stage">
                ${sharedTopMarkup}
                <div class="tender-workspace">
                  ${listPanelMarkup}
                  <article class="tender-detail-panel">${detailMarkup}</article>
                </div>
                <div class="tender-footer">
                  <p>
                    Connected workflow: open VerifySME when the supplier itself needs more diligence,
                    or move into ExportPulse when the same account should be evaluated for route expansion.
                  </p>
                  <div class="tender-detail-actions">
                    <a class="button button-secondary button-small" href="${supplierHref}">Review supplier</a>
                    <a class="button button-secondary button-small" href="${routeHref}">Open route planning</a>
                  </div>
                </div>
              </section>
            `;

    root.innerHTML = `
      <div class="tender-app-shell tender-app-shell--${activeView}">
        <div class="tender-command">
          <div class="tender-command-copy">
            <p class="eyebrow">Active account</p>
            <h3>${workspaceName} bid desk for profile-aware tender qualification.</h3>
            <p>
              The team uses this workspace to decide whether to bid, partner, or walk away
              based on visible thresholds, submission burden, and execution pressure in the live queue.
            </p>
          </div>
          <div class="tender-command-meta">
            <div class="tender-command-item">
              <span>Active profile</span>
              <strong>${profile.label}</strong>
            </div>
            <div class="tender-command-item">
              <span>Coverage</span>
              <strong>${profile.states.length} states · ${profile.categories.length} core categories</strong>
            </div>
            <div class="tender-command-item">
              <span>Current desk load</span>
              <strong>${summary.counts.closingSoon} urgent bids · ${workflowSummary["Bid review"]} under active review</strong>
            </div>
          </div>
        </div>

        <div class="suite-action-band tender-source-band">
          <div>
            <p class="tender-block-label">Live procurement adapters</p>
            <h3>GeM and CPPP feeds are connected to this workspace.</h3>
            <p class="verify-note">
              Manual refresh ${state.session?.signedIn ? "is enabled for signed-in workspace members." : "requires a signed-in workspace."} Current inventory mode: ${state.insightsPayload?.provenance?.dataMode || "loading"}.
            </p>
          </div>
          <div class="auth-source-grid">${procurementSourceCards}</div>
          <div class="suite-action-band-actions">
            <button
              type="button"
              class="button button-secondary button-small"
              data-sync-tender-sources
              ${state.session?.signedIn ? "" : "disabled"}
            >
              ${state.syncingSources ? "Refreshing live feeds…" : "Refresh live feeds"}
            </button>
          </div>
        </div>

        <div class="tender-layout">
          <aside class="tender-rail">
            <div class="tender-rail-card">
              <p class="tender-block-label">Profile presets</p>
              <div class="tender-profile-list">
                ${tenderProfiles
                  .map(
                    (item) => `
                      <button type="button" class="tender-profile ${item.id === state.profileId ? "tender-profile--active" : ""}" data-profile-id="${item.id}">
                        <strong>${item.label}</strong>
                        <span>${item.companySize}</span>
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </div>

            <div class="tender-rail-card">
              <p class="tender-block-label">Current company shape</p>
              <ul class="tender-note-list">
                <li>Annual turnover: ${formatCrore(profile.annualTurnoverCrore)}</li>
                <li>Typical bid size: ${formatCrore(profile.averageTenderValueCrore)}</li>
                <li>Visible reference projects: ${profile.pastProjectsCount}</li>
                <li>Primary states: ${profile.states.join(", ")}</li>
              </ul>
              <div class="verify-pill-row">
                ${profile.credentials.map((item) => `<span class="verify-pill">${item}</span>`).join("")}
              </div>
            </div>

            <div class="tender-rail-card">
              <label class="tender-field">
                <span>Search opportunity stream</span>
                <input type="search" name="searchTerm" value="${state.searchTerm}" placeholder="Try hospital, solar, managed services, pump" />
              </label>
              <div class="tender-fit-row">
                ${["All", "High fit", "Medium fit", "Low fit"]
                  .map(
                    (item) => `
                      <button type="button" class="tender-fit-chip ${item === state.fitFilter ? "tender-fit-chip--active" : ""}" data-fit-filter="${item}">
                        ${item}
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </div>

            <div class="tender-rail-card">
              <p class="tender-block-label">SME-specific lens</p>
              <ul class="tender-note-list">
                <li>Visible qualification gaps matter more than raw tender volume.</li>
                <li>MSE policy and exemptions can change the true commercial fit.</li>
                <li>Some bids are consortium-fit even when they are not solo-fit.</li>
              </ul>
            </div>
          </aside>
          ${stageMarkup}
        </div>
      </div>
    `;

    root.querySelectorAll("[data-profile-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.profileId = button.dataset.profileId;
        state.fitFilter = "All";
        state.searchTerm = "";
        state.selectedTenderId = "";
        safeWrite(STORAGE_KEYS.profile, state.profileId);
        persistState();
        trackTradeGraphEvent("tenderradar_profile_selected", { profileId: state.profileId });
        refreshInsights(true);
        render();
      });
    });

    root.querySelectorAll("[data-fit-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.fitFilter = button.dataset.fitFilter;
        persistState();
        trackTradeGraphEvent("tenderradar_fit_filter_changed", { fitFilter: state.fitFilter });
        refreshInsights(true);
        render();
      });
    });

    root.querySelectorAll("[data-open-tender]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedTenderId = button.dataset.openTender;
        persistState();
        trackTradeGraphEvent("tenderradar_opened", { tenderId: state.selectedTenderId });
        render();
      });
    });

    root.querySelectorAll("[data-shortlist-tender]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleShortlist(button.dataset.shortlistTender);
      });
    });

    root.querySelectorAll("[data-set-tender-stage]").forEach((button) => {
      button.addEventListener("click", () => {
        const tenderId = button.dataset.tenderId;
        const nextStage = button.dataset.setTenderStage;

        if (!tenderId || !nextStage) {
          return;
        }

        updateTenderCase(tenderId, (currentCase) => ({
          ...currentCase,
          stage: nextStage,
          auditLog: appendTenderAudit(currentCase, `Stage moved to ${nextStage}.`),
        }));
        persistState();
        trackTradeGraphEvent("tenderradar_stage_changed", { tenderId, nextStage });
        render();
      });
    });

    root.querySelector('input[name="searchTerm"]')?.addEventListener("input", (event) => {
      state.searchTerm = event.currentTarget.value;
      persistState();
      trackTradeGraphEvent("tenderradar_search_changed", { length: state.searchTerm.length });
      render();
    });

    root
      .querySelectorAll('select[name="tenderCaseOwner"], input[name="tenderCaseDueDate"], select[name="tenderCaseDecision"], input[name="tenderCasePartnerPlan"], input[name="tenderCaseNextAction"], textarea[name="tenderCaseNote"]')
      .forEach((field) => {
        const handleCaseField = (event) => {
          if (!activeTender) {
            return;
          }

          updateTenderCase(activeTender.id, (currentCase) => ({
            ...currentCase,
            owner: event.currentTarget.name === "tenderCaseOwner" ? event.currentTarget.value : currentCase.owner,
            dueDate: event.currentTarget.name === "tenderCaseDueDate" ? event.currentTarget.value : currentCase.dueDate,
            decision: event.currentTarget.name === "tenderCaseDecision" ? event.currentTarget.value : currentCase.decision,
            partnerPlan:
              event.currentTarget.name === "tenderCasePartnerPlan" ? event.currentTarget.value : currentCase.partnerPlan,
            nextAction:
              event.currentTarget.name === "tenderCaseNextAction" ? event.currentTarget.value : currentCase.nextAction,
            note: event.currentTarget.name === "tenderCaseNote" ? event.currentTarget.value : currentCase.note,
          }));
          persistState();
        };

        field.addEventListener("input", handleCaseField);
        field.addEventListener("change", handleCaseField);
      });

    root.querySelector("[data-sync-tender-sources]")?.addEventListener("click", async () => {
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
    fitFilter: state.fitFilter,
    selectedTenderId: state.selectedTenderId,
  })
    .then((persisted) => {
      if (persisted && typeof persisted === "object") {
        state.profileId = persisted.profileId || state.profileId;
        state.shortlistIds = Array.isArray(persisted.shortlistIds) ? persisted.shortlistIds : state.shortlistIds;
        state.workflow = persisted.workflow && typeof persisted.workflow === "object" ? persisted.workflow : state.workflow;
        state.cases = persisted.cases && typeof persisted.cases === "object" ? persisted.cases : state.cases;
        state.searchTerm = persisted.searchTerm || state.searchTerm;
        state.fitFilter = persisted.fitFilter || state.fitFilter;
        state.selectedTenderId = persisted.selectedTenderId || state.selectedTenderId;
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

  trackTradeGraphEvent("tenderradar_viewed");
  render();
}
