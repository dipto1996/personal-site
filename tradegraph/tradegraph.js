import {
  buildUnifiedAuditTimeline,
  summarizeUnifiedAudit,
} from "/apps/tradegraph/lib/audit.js";
import {
  dashboardNarrative,
  sourceCoverage,
} from "/apps/tradegraph/data/demo-data.js";
import { getTradeGraphAnalyticsSnapshot, trackTradeGraphEvent } from "/apps/tradegraph/lib/analytics.js";
import { exportOpportunities as exportMarkets, exportProfiles } from "/apps/exportpulse/data/catalog.js";
import {
  buildExportOpportunityView,
  buildMarketMix,
  buildBlockerMix,
  marketsMatch,
  summarizeExportWorkspace,
  getTopEntries as getTopExportEntries,
} from "/lib/exportpulse.js";
import { buildCompanyGraphSnapshot, suiteProfiles } from "/lib/companygraph.js";
import {
  buildExportReadinessSeries,
  buildOverviewMetrics,
  buildTrustDistribution,
} from "/apps/tradegraph/lib/scoring.js";
import {
  buildRadarView,
  formatCrore,
  formatLakh,
  getTopEntries,
  summarizeRadar,
} from "/lib/tenderradar.js";
import { tenderOpportunities as tenders, tenderProfiles } from "/apps/tenderradar/data/catalog.js";
import {
  loginWithDemo,
  loadAlerts,
  loadAnalyticsSummary,
  loadBilling,
  loadRuntime,
  loadSession,
  loadSources,
  readPersistentState,
  startCheckout,
} from "/lib/workspace-client.js";
import { mountControlCenter } from "/apps/tradegraph/ui/control-center.js";
import { mountExportPulse } from "/apps/exportpulse/index.js";
import { mountTenderRadar } from "/apps/tenderradar/index.js";
import { mountVerifySME, supplierProfiles as suppliers } from "/apps/verifysme/index.js";

const ROOT = "/tradegraph";
const ROOT_SELECTORS = [
  "[data-company-graph-app]",
  "[data-verifysme-app]",
  "[data-tenderradar-app]",
  "[data-exportpulse-app]",
  "[data-control-center-app]",
  "[data-tg-root]",
];
const WATCHLIST_KEY = "tradegraph-watchlist";
const SUITE_PROFILE_KEY = "tradegraph.suite.profile";
const PRODUCT_PAGE_PREFIX = "tradegraph-product-";

const TOP_NAV = [
  { label: "Suite", href: `${ROOT}/index.html`, hint: "Decision OS" },
  { label: "Use cases", href: `${ROOT}/use-cases/index.html`, hint: "Buyer journeys" },
  { label: "Products", href: `${ROOT}/products/index.html`, hint: "Three modules" },
  { label: "App", href: `${ROOT}/app/overview.html`, hint: "Live workspace" },
  { label: "Pricing", href: `${ROOT}/pricing.html`, hint: "Commercial model" },
  { label: "Docs", href: `${ROOT}/docs.html`, hint: "Data and moats" },
];

const SITE_NAV = [
  { label: "About", href: "/about.html" },
  { label: "Work", href: "/work.html" },
  { label: "TradeGraph", href: `${ROOT}/index.html`, current: true },
  { label: "Job Search", href: "/job-search.html" },
  { label: "Experience", href: "/experience.html" },
  { label: "Writing", href: "/writing.html" },
  { label: "Contact", href: "/contact.html" },
];

const APP_TREE = [
  {
    label: "Overview",
    href: `${ROOT}/app/overview.html`,
    hint: "Suite command center",
  },
  {
    label: "VerifySME",
    href: `${ROOT}/app/verifysme/queue.html`,
    children: [
      { label: "Queue", href: `${ROOT}/app/verifysme/queue.html`, hint: "Diligence flow" },
      { label: "Suppliers", href: `${ROOT}/app/verifysme/suppliers.html`, hint: "Trust list" },
      { label: "Comparisons", href: `${ROOT}/app/verifysme/comparisons.html`, hint: "Shortlist compare" },
      { label: "Supplier detail", href: `${ROOT}/app/verifysme/supplier-detail.html?supplierId=atlas-flex-packaging`, hint: "Evidence view" },
    ],
  },
  {
    label: "TenderRadar",
    href: `${ROOT}/app/tenderradar/pipeline.html`,
    children: [
      { label: "Pipeline", href: `${ROOT}/app/tenderradar/pipeline.html`, hint: "Bid desk" },
      { label: "Bid desk", href: `${ROOT}/app/tenderradar/bid-desk.html`, hint: "Shortlist ops" },
      { label: "Opportunities", href: `${ROOT}/app/tenderradar/opportunities.html`, hint: "Ranked bids" },
      {
        label: "Opportunity detail",
        href: `${ROOT}/app/tenderradar/opportunity-detail.html?profileId=atlaspack&tenderId=TR-011`,
        hint: "Decision view",
      },
    ],
  },
  {
    label: "ExportPulse",
    href: `${ROOT}/app/exportpulse/route-pipeline.html`,
    children: [
      { label: "Route pipeline", href: `${ROOT}/app/exportpulse/route-pipeline.html`, hint: "Readiness flow" },
      { label: "Markets", href: `${ROOT}/app/exportpulse/markets.html`, hint: "Opportunities" },
      { label: "Docs readiness", href: `${ROOT}/app/exportpulse/docs-readiness.html`, hint: "Docs + blockers" },
      { label: "Route detail", href: `${ROOT}/app/exportpulse/route-detail.html?profileId=gcc-packaging&routeId=EP-001`, hint: "Action queue" },
    ],
  },
  {
    label: "Ops",
    href: `${ROOT}/app/ops/sources.html`,
    children: [
      { label: "Sources", href: `${ROOT}/app/ops/sources.html`, hint: "Connector health" },
      { label: "Alerts", href: `${ROOT}/app/ops/alerts.html`, hint: "Saved rules" },
      { label: "Workspace", href: `${ROOT}/app/ops/workspace.html`, hint: "Members and state" },
      { label: "Billing", href: `${ROOT}/app/ops/billing.html`, hint: "Plan and seats" },
      { label: "Audit log", href: `${ROOT}/app/ops/audit-log.html`, hint: "Timeline history" },
    ],
  },
];

const PRODUCT_CONTENT = {
  verifysme: {
    label: "VerifySME",
    eyebrow: "Supplier intelligence",
    title: "Trust signals before sourcing teams burn time.",
    summary:
      "Qualify suppliers before RFQ, sampling, onboarding, or advance payment using a single evidence graph.",
    decision: "Can I trust this supplier/company enough to engage?",
    buyer: "Procurement lead / founder / quality head",
    outcomes: [
      "Shortlist only credible suppliers",
      "Detect identity and documentation mismatches",
      "Move the right names into diligence faster",
    ],
    moat: [
      "Udyam + MCA + IEC + GeM signal graph",
      "Assisted official workflow for portal-bound checks",
      "Evidence freshness and confidence on every company record",
    ],
    sources: sourceCoverage.find((item) => item.id === "verifysme"),
    livePreviewLabel: "Supplier diligence workspace",
    previewCta: `${ROOT}/app/verifysme/queue.html`,
    realToday: [
      "Supplier compare, shortlist, and stage movement are live inside the app shell.",
      "Official MCA and Udyam evidence can be bound to a case with freshness and confidence preserved.",
      "The same supplier record hands off directly into TenderRadar and ExportPulse.",
    ],
    assistedToday: [
      "Official MCA and Udyam portal interaction remains operator-assisted rather than unattended.",
      "Some documentation interpretation still depends on analyst judgment once the official trace is imported.",
    ],
    workflowSteps: [
      "Capture or open a supplier record.",
      "Bind official evidence and review trust blockers.",
      "Compare shortlisted suppliers side by side.",
      "Move the winner into bid or export workflows.",
    ],
    pageTree: [
      { label: "Use case", href: `${ROOT}/use-cases/supplier-verification.html` },
      { label: "Product page", href: `${ROOT}/products/verifysme.html` },
      { label: "App queue", href: `${ROOT}/app/verifysme/queue.html` },
      { label: "Compare suppliers", href: `${ROOT}/app/verifysme/comparisons.html` },
    ],
  },
  tenderradar: {
    label: "TenderRadar",
    eyebrow: "Tender intelligence",
    title: "See high-fit bids before the PDF maze starts.",
    summary:
      "Rank tenders by fit, highlight visible blockers, and decide whether to bid, partner, or walk away.",
    decision: "Should we spend time and money pursuing this tender?",
    buyer: "Bid manager / commercial lead",
    outcomes: [
      "Kill weak bids early",
      "Expose qualification gaps before the desk burns time",
      "Focus effort on bids that can actually close",
    ],
    moat: [
      "CPPP + GeM + state portal signal graph",
      "Bid-fit and threshold scoring tied to the same company graph",
      "Deadline, urgency, and blocker surfaces on every opportunity",
    ],
    sources: sourceCoverage.find((item) => item.id === "tenderradar"),
    livePreviewLabel: "Bid qualification workspace",
    previewCta: `${ROOT}/app/tenderradar/pipeline.html`,
    realToday: [
      "GeM and CPPP-derived opportunities can be scored, shortlisted, and moved through bid stages.",
      "Fit, urgency, and blocker views are visible in ranked queues and detail screens.",
      "The bid desk carries owner, decision, and handoff state into adjacent product surfaces.",
    ],
    assistedToday: [
      "Full tender-pack interpretation and partner strategy still require operator review.",
      "TradeGraph does not pretend that every procurement portal edge case is fully automated today.",
    ],
    workflowSteps: [
      "Open the profile-aligned opportunity stream.",
      "Kill weak bids or save viable ones into the desk.",
      "Review threshold blockers and assign an owner.",
      "Handoff supplier diligence or export expansion where needed.",
    ],
    pageTree: [
      { label: "Use case", href: `${ROOT}/use-cases/tender-qualification.html` },
      { label: "Product page", href: `${ROOT}/products/tenderradar.html` },
      { label: "App pipeline", href: `${ROOT}/app/tenderradar/pipeline.html` },
      { label: "Bid desk", href: `${ROOT}/app/tenderradar/bid-desk.html` },
    ],
  },
  exportpulse: {
    label: "ExportPulse",
    eyebrow: "Export readiness",
    title: "Turn export curiosity into a route-by-route plan.",
    summary:
      "Understand which market route is viable now, which documents are missing, and what should be fixed first.",
    decision: "Which market route can we realistically enter next, and what blocks it?",
    buyer: "Founder / export manager / trade enabler",
    outcomes: [
      "Identify the best-fit export routes",
      "Surface the missing documents and readiness blockers",
      "Turn market-entry exploration into a real action queue",
    ],
    moat: [
      "Trade Connect + DGFT + exporter identity graph",
      "Route readiness and blocker waterfall from the same supplier record",
      "Market-specific action plan instead of generic export advice",
    ],
    sources: sourceCoverage.find((item) => item.id === "exportpulse"),
    livePreviewLabel: "Route readiness workspace",
    previewCta: `${ROOT}/app/exportpulse/route-pipeline.html`,
    realToday: [
      "DGFT-derived route signals, route scoring, and readiness blockers are available in live product views.",
      "Route stages, action queues, and cross-product links persist in the shared workspace shell.",
      "Document and blocker views are visible before the team starts buyer outreach.",
    ],
    assistedToday: [
      "Document-pack completion and route interpretation still require operator judgment.",
      "Buyer outreach and downstream trade execution are not misrepresented as fully automated.",
    ],
    workflowSteps: [
      "Select the exporter profile and open ranked routes.",
      "Inspect blocker mix and documentation gaps.",
      "Move the strongest routes through docs fix and outreach stages.",
      "Loop back into supplier or tender context if the route depends on upstream evidence.",
    ],
    pageTree: [
      { label: "Use case", href: `${ROOT}/use-cases/export-launch.html` },
      { label: "Product page", href: `${ROOT}/products/exportpulse.html` },
      { label: "App routes", href: `${ROOT}/app/exportpulse/route-pipeline.html` },
      { label: "Docs readiness", href: `${ROOT}/app/exportpulse/docs-readiness.html` },
    ],
  },
};

const ROUTES = {
  home: { kind: "home", title: "TradeGraph Decision OS", breadcrumbs: [{ label: "TradeGraph", href: `${ROOT}/index.html` }] },
  docs: { kind: "docs", title: "TradeGraph Docs", breadcrumbs: [{ label: "TradeGraph", href: `${ROOT}/index.html` }, { label: "Docs" }] },
  pricing: { kind: "pricing", title: "TradeGraph Pricing", breadcrumbs: [{ label: "TradeGraph", href: `${ROOT}/index.html` }, { label: "Pricing" }] },
  "use-cases": {
    kind: "use-case-index",
    title: "Use cases",
    breadcrumbs: [{ label: "TradeGraph", href: `${ROOT}/index.html` }, { label: "Use cases" }],
  },
  "use-cases/supplier-verification": {
    kind: "use-case",
    title: "Supplier verification",
    product: "verifysme",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "Use cases", href: `${ROOT}/use-cases/index.html` },
      { label: "Supplier verification" },
    ],
  },
  "use-cases/tender-qualification": {
    kind: "use-case",
    title: "Tender qualification",
    product: "tenderradar",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "Use cases", href: `${ROOT}/use-cases/index.html` },
      { label: "Tender qualification" },
    ],
  },
  "use-cases/export-launch": {
    kind: "use-case",
    title: "Export launch",
    product: "exportpulse",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "Use cases", href: `${ROOT}/use-cases/index.html` },
      { label: "Export launch" },
    ],
  },
  products: {
    kind: "product-index",
    title: "Products",
    breadcrumbs: [{ label: "TradeGraph", href: `${ROOT}/index.html` }, { label: "Products" }],
  },
  "products/verifysme": {
    kind: "product",
    title: "VerifySME",
    product: "verifysme",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "Products", href: `${ROOT}/products/index.html` },
      { label: "VerifySME" },
    ],
  },
  "products/tenderradar": {
    kind: "product",
    title: "TenderRadar",
    product: "tenderradar",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "Products", href: `${ROOT}/products/index.html` },
      { label: "TenderRadar" },
    ],
  },
  "products/exportpulse": {
    kind: "product",
    title: "ExportPulse",
    product: "exportpulse",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "Products", href: `${ROOT}/products/index.html` },
      { label: "ExportPulse" },
    ],
  },
  overview: {
    kind: "overview",
    title: "Overview",
    breadcrumbs: [{ label: "TradeGraph", href: `${ROOT}/index.html` }, { label: "App", href: `${ROOT}/app/overview.html` }, { label: "Overview" }],
  },
  "app/verifysme/queue": {
    kind: "app-product",
    title: "VerifySME queue",
    product: "verifysme",
    view: "queue",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "VerifySME", href: `${ROOT}/app/verifysme/queue.html` },
      { label: "Queue" },
    ],
  },
  "app/verifysme/suppliers": {
    kind: "app-product",
    title: "VerifySME suppliers",
    product: "verifysme",
    view: "suppliers",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "VerifySME", href: `${ROOT}/app/verifysme/queue.html` },
      { label: "Suppliers" },
    ],
  },
  "app/verifysme/comparisons": {
    kind: "app-product",
    title: "VerifySME comparisons",
    product: "verifysme",
    view: "comparisons",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "VerifySME", href: `${ROOT}/app/verifysme/queue.html` },
      { label: "Comparisons" },
    ],
  },
  "app/verifysme/supplier-detail": {
    kind: "app-product",
    title: "VerifySME supplier detail",
    product: "verifysme",
    view: "detail",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "VerifySME", href: `${ROOT}/app/verifysme/queue.html` },
      { label: "Supplier detail" },
    ],
  },
  "app/tenderradar/pipeline": {
    kind: "app-product",
    title: "TenderRadar pipeline",
    product: "tenderradar",
    view: "pipeline",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "TenderRadar", href: `${ROOT}/app/tenderradar/pipeline.html` },
      { label: "Pipeline" },
    ],
  },
  "app/tenderradar/opportunities": {
    kind: "app-product",
    title: "TenderRadar opportunities",
    product: "tenderradar",
    view: "opportunities",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "TenderRadar", href: `${ROOT}/app/tenderradar/pipeline.html` },
      { label: "Opportunities" },
    ],
  },
  "app/tenderradar/bid-desk": {
    kind: "app-product",
    title: "TenderRadar bid desk",
    product: "tenderradar",
    view: "bid-desk",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "TenderRadar", href: `${ROOT}/app/tenderradar/pipeline.html` },
      { label: "Bid desk" },
    ],
  },
  "app/tenderradar/opportunity-detail": {
    kind: "app-product",
    title: "TenderRadar opportunity detail",
    product: "tenderradar",
    view: "detail",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "TenderRadar", href: `${ROOT}/app/tenderradar/pipeline.html` },
      { label: "Opportunity detail" },
    ],
  },
  "app/exportpulse/route-pipeline": {
    kind: "app-product",
    title: "ExportPulse route pipeline",
    product: "exportpulse",
    view: "pipeline",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "ExportPulse", href: `${ROOT}/app/exportpulse/route-pipeline.html` },
      { label: "Route pipeline" },
    ],
  },
  "app/exportpulse/markets": {
    kind: "app-product",
    title: "ExportPulse markets",
    product: "exportpulse",
    view: "markets",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "ExportPulse", href: `${ROOT}/app/exportpulse/route-pipeline.html` },
      { label: "Markets" },
    ],
  },
  "app/exportpulse/docs-readiness": {
    kind: "app-product",
    title: "ExportPulse docs readiness",
    product: "exportpulse",
    view: "docs-readiness",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "ExportPulse", href: `${ROOT}/app/exportpulse/route-pipeline.html` },
      { label: "Docs readiness" },
    ],
  },
  "app/exportpulse/route-detail": {
    kind: "app-product",
    title: "ExportPulse route detail",
    product: "exportpulse",
    view: "detail",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "ExportPulse", href: `${ROOT}/app/exportpulse/route-pipeline.html` },
      { label: "Route detail" },
    ],
  },
  "app/ops/sources": {
    kind: "ops",
    title: "Source operations",
    view: "sources",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "Ops", href: `${ROOT}/app/ops/sources.html` },
      { label: "Sources" },
    ],
  },
  "app/ops/alerts": {
    kind: "ops",
    title: "Alert operations",
    view: "alerts",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "Ops", href: `${ROOT}/app/ops/sources.html` },
      { label: "Alerts" },
    ],
  },
  "app/ops/workspace": {
    kind: "ops",
    title: "Workspace operations",
    view: "workspace",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "Ops", href: `${ROOT}/app/ops/sources.html` },
      { label: "Workspace" },
    ],
  },
  "app/ops/billing": {
    kind: "ops",
    title: "Billing operations",
    view: "billing",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "Ops", href: `${ROOT}/app/ops/sources.html` },
      { label: "Billing" },
    ],
  },
  "app/ops/audit-log": {
    kind: "ops",
    title: "Audit log",
    view: "audit-log",
    breadcrumbs: [
      { label: "TradeGraph", href: `${ROOT}/index.html` },
      { label: "App", href: `${ROOT}/app/overview.html` },
      { label: "Ops", href: `${ROOT}/app/ops/sources.html` },
      { label: "Audit log" },
    ],
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function localRead(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function localWrite(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function topEntries(mapObject, limit = 4) {
  return Object.entries(mapObject)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}

function getPage(pathKey) {
  return ROUTES[pathKey] || ROUTES.home;
}

function renderTopNav() {
  const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
  return `
    <div class="tg-topnav" aria-label="TradeGraph sections">
      ${TOP_NAV.map((item) => {
        const isSection =
          (item.label === "Use cases" && currentPath.startsWith(`${ROOT}/use-cases/`)) ||
          (item.label === "Products" && currentPath.startsWith(`${ROOT}/products/`)) ||
          (item.label === "App" && currentPath.startsWith(`${ROOT}/app/`));
        const isActive = isSection || currentPath === item.href || currentPath === item.href.replace(".html", "");
        return `<a class="${isActive ? "is-active" : ""}" href="${item.href}" title="${escapeHtml(item.hint)}">${escapeHtml(item.label)}</a>`;
      }).join("")}
    </div>
  `;
}

function renderSiteHeader() {
  return `
    <header class="topbar tg-site-topbar">
      <a class="brand" href="/index.html">Diptopal Roy</a>
      <nav class="nav" aria-label="Primary">
        ${SITE_NAV.map((item) => `<a class="${item.current ? "is-current" : ""}" href="${item.href}" ${item.current ? 'aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`).join("")}
      </nav>
      <a class="nav-cta" href="/contact.html?intent=product-evaluator&product=TradeGraph&source=tradegraph">Get in touch</a>
    </header>
  `;
}

function renderActionButton(href, label, accent = false) {
  return `<a class="tg-cta ${accent ? "tg-cta--accent" : ""}" href="${href}">${escapeHtml(label)}</a>`;
}

function renderActionTrigger(label, dataAttribute, accent = false) {
  return `<button type="button" class="tg-cta ${accent ? "tg-cta--accent" : ""} tg-cta-button" ${dataAttribute}>${escapeHtml(label)}</button>`;
}

function getProviderStatus(currentState, providerKey) {
  return currentState.runtime?.runtime?.providers?.find((provider) => provider.key === providerKey) || null;
}

function renderRealityCards(product) {
  return `
    <div class="tg-grid tg-grid--2">
      <article class="tg-card tg-card--accent">
        <span class="tg-card-kicker">What is real today</span>
        <h3>${escapeHtml(product.label)} live product behavior</h3>
        <ul class="tg-checklist">
          ${product.realToday.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
      <article class="tg-card">
        <span class="tg-card-kicker">What is assisted today</span>
        <h3>Honest operator boundary</h3>
        <ul class="tg-checklist">
          ${product.assistedToday.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
    </div>
  `;
}

function renderPersonaRails() {
  const rails = [
    {
      label: "Founder",
      detail: "See the full suite, pricing honesty, and the buyer-ready path through the product.",
      href: `${ROOT}/app/overview.html`,
    },
    {
      label: "Sourcing lead",
      detail: "Start with supplier diligence, shortlist comparison, and evidence-backed trust decisions.",
      href: `${ROOT}/use-cases/supplier-verification.html`,
    },
    {
      label: "Bid manager",
      detail: "Open the bid desk and decision surfaces for fit, urgency, and qualification blockers.",
      href: `${ROOT}/use-cases/tender-qualification.html`,
    },
    {
      label: "Export manager",
      detail: "Start with route scoring, docs readiness, and action queues tied to the same company record.",
      href: `${ROOT}/use-cases/export-launch.html`,
    },
  ];

  return `
    <div class="tg-grid tg-grid--4">
      ${rails
        .map(
          (rail) => `
            <article class="tg-card">
              <span class="tg-card-kicker">${escapeHtml(rail.label)}</span>
              <p>${escapeHtml(rail.detail)}</p>
              <div class="tg-top-actions" style="margin-top: 12px">
                ${renderActionButton(rail.href, `Open ${rail.label}`)}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDemoJourney() {
  const steps = [
    {
      label: "1. Verify supplier",
      detail: "Start with one supplier and bind official evidence before a commercial decision is made.",
      href: `${ROOT}/app/verifysme/supplier-detail.html?supplierId=atlas-flex-packaging`,
    },
    {
      label: "2. Qualify tender",
      detail: "Carry the supplier context into a bid decision with visible thresholds and stage movement.",
      href: `${ROOT}/app/tenderradar/opportunity-detail.html?profileId=atlaspack&tenderId=TR-011`,
    },
    {
      label: "3. Check route",
      detail: "Move into export route readiness with blockers, docs, and next actions preserved.",
      href: `${ROOT}/app/exportpulse/route-detail.html?profileId=gcc-packaging&routeId=EP-001`,
    },
    {
      label: "4. Inspect ops history",
      detail: "Review sources, runtime honesty, and the audit log before treating the suite as launch-ready.",
      href: `${ROOT}/app/ops/audit-log.html`,
    },
  ];

  return `
    <div class="tg-tree-map">
      ${steps
        .map(
          (step) => `
            <div class="tg-tree-node">
              <strong>${escapeHtml(step.label)}</strong>
              <p>${escapeHtml(step.detail)}</p>
              <a href="${step.href}">Open step</a>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderWorkflowSteps(product) {
  return `
    <div class="tg-tree-map">
      ${product.workflowSteps
        .map(
          (step, index) => `
            <div class="tg-tree-node">
              <strong>Step ${index + 1}</strong>
              <p>${escapeHtml(step)}</p>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderBillingTruthCard(currentState) {
  const billingProvider = getProviderStatus(currentState, "billing");
  const billingLive = billingProvider?.status === "configured";
  const signedIn = Boolean(currentState.session?.signedIn);

  return `
    <article class="tg-card ${billingLive ? "tg-card--accent" : ""}">
      <span class="tg-card-kicker">Billing mode honesty</span>
      <h3>${billingLive ? (signedIn ? "Stripe checkout is configured." : "Stripe is configured, but checkout still starts from a signed-in workspace.") : "This deployment is routing pricing into lead capture, not fake checkout."}</h3>
      <p>${escapeHtml(billingProvider?.note || "Billing provider status is still loading.")}</p>
      <div class="tg-top-actions">
        ${billingLive
          ? signedIn
            ? renderActionTrigger("Start Pro checkout", 'data-start-checkout="pro"', true)
            : renderActionTrigger("Open workspace access", "data-open-workspace-access", true)
          : renderActionButton("/contact.html?intent=operator-buyer&product=TradeGraph&source=tradegraph-pricing", "Request demo / pricing", true)}
        ${renderActionButton(`${ROOT}/app/ops/billing.html`, "Open billing ops")}
      </div>
    </article>
  `;
}

function buildLookupMap(items = [], key = "id", labelKey = "name") {
  return Object.fromEntries(
    items.map((item) => [item[key], item[labelKey] || item.title || item.market || item[key]]),
  );
}

function renderAuditTimeline(entries = []) {
  if (!entries.length) {
    return `
      <article class="tg-card">
        <span class="tg-card-kicker">Audit timeline</span>
        <h3>No audit entries yet</h3>
        <p>Use the demo workspace, move workflow stages, or create an alert to populate the history surface.</p>
      </article>
    `;
  }

  return `
    <div class="tg-grid tg-grid--2">
      ${entries
        .map(
          (entry) => `
            <article class="tg-card">
              <span class="tg-card-kicker">${escapeHtml(entry.badge)} · ${escapeHtml(entry.source)}</span>
              <h3>${escapeHtml(entry.title)}</h3>
              <p>${escapeHtml(entry.detail)}</p>
              <p class="tg-note">${escapeHtml(entry.subject)} · ${escapeHtml(entry.createdLabel)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderWorkspaceActivationCard(currentState, options = {}) {
  const session = currentState.session;
  const isGuest = !session?.signedIn;
  const demoAvailable = session?.demoAvailable !== false;
  const workspaceName = session?.workspace?.name || "Guest workspace";
  const memberCount = session?.workspace?.memberCount || 0;
  const role = session?.workspace?.role || "guest";
  const checklist = isGuest
    ? [
        "Use the seeded demo workspace to try source sync, alerts, and plan changes immediately.",
        "Sign in when you want alert rules, billing state, and evidence links to persist beyond this browser.",
        "Workspace access is the boundary for shared operators, invite codes, and backend analytics summaries.",
      ]
    : [
        `Current role: ${role}.`,
        `${memberCount} workspace member${memberCount === 1 ? "" : "s"} can share saved alerts, billing state, and evidence history.`,
        "Use workspace access to switch workspaces, create invites, or move from a demo tenant to your own account.",
      ];

  return `
    <article class="tg-card ${isGuest ? "tg-card--accent" : ""}">
      <span class="tg-card-kicker">${isGuest ? "Workspace quick start" : "Workspace ready"}</span>
      <h3>${isGuest ? "Start with the demo workspace or sign in before you do ops work." : escapeHtml(workspaceName)}</h3>
      <p data-workspace-entry-note>${escapeHtml(
        options.note
          || (isGuest
            ? "Guest mode is useful for browsing, but protected refreshes, saved alerts, and shared state become real only after workspace access is enabled."
            : "This workspace is now the durable boundary for product state, member access, and cross-module operations."),
      )}</p>
      <ul class="tg-checklist">
        ${checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <div class="tg-top-actions">
        ${isGuest && demoAvailable ? renderActionTrigger("Use demo workspace", "data-use-demo-workspace", true) : renderActionButton(`${ROOT}/app/ops/workspace.html`, "Open workspace ops", true)}
        ${renderActionTrigger(isGuest ? "Open workspace access" : "Manage workspace", "data-open-workspace-access")}
      </div>
    </article>
  `;
}

function renderOpsGuideCard(view) {
  const content = {
    sources: {
      kicker: "Source runbook",
      title: "Use this page to keep source credibility visible.",
      note: "Refresh public feeds, inspect restricted connectors, and confirm the product is honest about what is live versus assisted.",
      checklist: [
        "Check which connectors are live, restricted, or simulated before using the downstream product views.",
        "Refresh the live source snapshot after signing in so current tender, export, and registry signals are in view.",
        "If a source is blocked, use the runtime card to distinguish provider configuration issues from public-access constraints.",
      ],
      primaryHref: `${ROOT}/app/ops/alerts.html`,
      primaryLabel: "Open alerts",
      secondaryHref: `${ROOT}/app/overview.html`,
      secondaryLabel: "Back to overview",
    },
    alerts: {
      kicker: "Alert runbook",
      title: "Create alert rules only after the source picture looks credible.",
      note: "Saved rules should follow actual operating signals, not demo placeholders. This page lets you turn source coverage into repeatable outreach and monitoring.",
      checklist: [
        "Create rules around the keywords and source sets that matter for one buyer, supplier, or market wedge.",
        "Test a rule before relying on it so you can inspect the preview payload and match quality.",
        "Use workspace access if you want those rules to persist and be visible to other operators.",
      ],
      primaryHref: `${ROOT}/app/ops/sources.html`,
      primaryLabel: "Review sources",
      secondaryHref: `${ROOT}/app/tenderradar/pipeline.html`,
      secondaryLabel: "Open TenderRadar",
    },
    billing: {
      kicker: "Commercial runbook",
      title: "Keep plan state honest before anyone treats this as a customer surface.",
      note: "This page should make it obvious whether billing is simulated, live, or missing dependencies, and whether plan changes actually bind to a workspace.",
      checklist: [
        "Verify the active plan and seat count so the workspace packaging matches what the user should experience.",
        "Use provider readiness to confirm whether Stripe is live or the current behavior is a local fallback.",
        "Move back to Free when you need a clean baseline for demos or operator QA.",
      ],
      primaryHref: `${ROOT}/pricing.html`,
      primaryLabel: "Open pricing",
      secondaryHref: `${ROOT}/app/ops/workspace.html`,
      secondaryLabel: "Open workspace ops",
    },
    workspace: {
      kicker: "Collaboration runbook",
      title: "This is where the product stops behaving like a solo browser demo.",
      note: "Make workspace boundaries explicit so users understand where data lives, who can see it, and how invites and persistence actually work.",
      checklist: [
        "Show the active workspace, member count, and persistence mode instead of hiding collaboration behind a generic account badge.",
        "Use workspace access to create invites, switch workspaces, or graduate from the demo tenant into a real account.",
        "Keep analytics, billing state, and saved alerts attached to the workspace so the product feels coherent across modules.",
      ],
      primaryHref: `${ROOT}/app/ops/billing.html`,
      primaryLabel: "Open billing ops",
      secondaryHref: `${ROOT}/app/overview.html`,
      secondaryLabel: "Back to overview",
    },
    "audit-log": {
      kicker: "Audit runbook",
      title: "One timeline should explain what changed across products and ops.",
      note: "Use this page to inspect stage movement, evidence binding, alert activity, and workspace events without hunting through separate modules.",
      checklist: [
        "Review stage changes and evidence binding before showing the product to a buyer.",
        "Confirm source refresh, alert activity, and workspace actions are visible in one history surface.",
        "Treat missing history as a product gap, not a reporting footnote.",
      ],
      primaryHref: `${ROOT}/app/ops/sources.html`,
      primaryLabel: "Review sources",
      secondaryHref: `${ROOT}/app/overview.html`,
      secondaryLabel: "Back to overview",
    },
  }[view];

  return `
    <article class="tg-card">
      <span class="tg-card-kicker">${escapeHtml(content.kicker)}</span>
      <h3>${escapeHtml(content.title)}</h3>
      <p>${escapeHtml(content.note)}</p>
      <ul class="tg-checklist">
        ${content.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      <div class="tg-top-actions">
        ${renderActionButton(content.primaryHref, content.primaryLabel, true)}
        ${renderActionButton(content.secondaryHref, content.secondaryLabel)}
      </div>
    </article>
  `;
}

function renderBreadcrumbs(items) {
  return `
    <nav class="tg-crumbs" aria-label="Breadcrumb">
      ${items
        .map((item, index) => {
          if (item.href) {
            return `<a href="${item.href}">${escapeHtml(item.label)}</a>${index < items.length - 1 ? "<span>/</span>" : ""}`;
          }

          return `<span>${escapeHtml(item.label)}</span>${index < items.length - 1 ? "<span>/</span>" : ""}`;
        })
        .join("")}
    </nav>
  `;
}

function renderMetricGrid(metrics) {
  return `
    <div class="tg-grid tg-grid--4">
      ${metrics
        .map(
          (metric) => `
            <article class="tg-card ${metric.accent ? "tg-card--accent" : ""}">
              <span class="tg-card-kicker">${escapeHtml(metric.label)}</span>
              <h3>${escapeHtml(metric.value)}</h3>
              <p>${escapeHtml(metric.detail)}</p>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderBarChart(items, options = {}) {
  const max = options.max || Math.max(...items.map((item) => item.value), 1);
  return `
    <div class="tg-chart">
      ${options.title ? `<div class="tg-chart-head"><strong>${escapeHtml(options.title)}</strong>${options.note ? `<span class="tg-note">${escapeHtml(options.note)}</span>` : ""}</div>` : ""}
      <div class="tg-bars">
        ${items
          .map(
            (item) => `
              <div class="tg-bar">
                <div class="tg-bar-label">
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(item.valueText || item.value)}</strong>
                </div>
                <div class="tg-bar-track">
                  <span class="tg-bar-fill ${item.variant ? `tg-bar-fill--${item.variant}` : ""}" style="width: ${Math.max((item.value / max) * 100, item.value ? 18 : 0)}%"></span>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderTable(headers, rows) {
  return `
    <table class="tg-table">
      <thead>
        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderTreeNav(activeKey) {
  const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";

  return `
    <aside class="tg-sidebar">
      <div class="tg-sidebar-section">
        <span>App Tree</span>
        <div class="tg-sidebar-tree">
          ${APP_TREE.map((group) => {
            const groupTargets = group.children?.length ? group.children : [group];
            const isGroupActive = groupTargets.some((item) => currentPath === item.href || currentPath === item.href.replace(".html", ""));
            return `
              <details class="tg-sidebar-group" ${isGroupActive ? "open" : ""}>
                <summary>
                  <span>${escapeHtml(group.label)}</span>
                  <small>${escapeHtml(group.children ? `${group.children.length} pages` : "page")}</small>
                </summary>
                <div class="tg-sidebar-links">
                  ${
                    group.children
                      ? group.children
                          .map(
                            (item) => `
                              <a class="tg-sidebar-link ${currentPath === item.href || currentPath === item.href.replace(".html", "") ? "is-active" : ""}" href="${item.href}">
                                <span>${escapeHtml(item.label)}</span>
                                <small>${escapeHtml(item.hint)}</small>
                              </a>
                            `,
                          )
                          .join("")
                      : `<a class="tg-sidebar-link ${currentPath === group.href || currentPath === group.href.replace(".html", "") ? "is-active" : ""}" href="${group.href}">
                          <span>${escapeHtml(group.label)}</span>
                          <small>${escapeHtml(group.hint || "Overview")}</small>
                        </a>`
                  }
                </div>
              </details>
            `;
          }).join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderSourceStrip(sources) {
  if (!sources?.sources?.length) {
    return `<div class="tg-source-strip"><span class="tg-source-chip"><strong>Sources</strong><em>loading</em></span></div>`;
  }

  return `
    <div class="tg-source-strip">
      ${sources.sources.map((source) => `<span class="tg-source-chip"><strong>${escapeHtml(source.label)}</strong><em>${escapeHtml(source.status)}</em></span>`).join("")}
    </div>
  `;
}

function renderSourceTable(sourceGroup) {
  if (!sourceGroup?.classes?.length) {
    return `<p class="tg-note">No source coverage data available.</p>`;
  }

  return renderTable(
    ["Source", "Status", "Why it matters"],
    sourceGroup.classes.map((item) => [
      `<strong>${escapeHtml(item.name)}</strong>`,
      `<span class="tg-pill ${item.status === "mapped" ? "tg-pill--accent" : item.status === "partial" ? "tg-pill--warning" : ""}">${escapeHtml(item.status)}</span>`,
      escapeHtml(item.note),
    ]),
  );
}

function renderShell({ title, breadcrumbs, bodyClass = "", sidebar = "", content = "", sourceStrip = "", headerAction = "" }) {
  return `
    <div class="site-shell tg-site-shell">
      ${renderSiteHeader()}
      <main class="page-stack tg-page-stack">
        <section class="tg-suite-bar">
          <div class="tg-suite-bar-copy">
            <p class="eyebrow">TradeGraph</p>
            <h2>Decision workspace for Indian SME operators</h2>
            <p>
              Public procurement feeds, trade notices, and assisted official company checks
              connected into supplier diligence, tender qualification, and export route planning.
            </p>
          </div>
          <div class="tg-suite-bar-actions">
            ${headerAction}
            ${renderActionButton(`${ROOT}/app/overview.html`, "Open app", true)}
          </div>
          ${renderTopNav()}
        </section>

        <div class="tg-layout ${sidebar ? "tg-layout--app" : "tg-layout--public"}">
          ${sidebar}
          <section class="tg-main">
          ${renderBreadcrumbs(breadcrumbs)}
          <section class="tg-hero">
            <div class="tg-hero-copy">
              <p class="tg-eyebrow">${escapeHtml(title.eyebrow)}</p>
              <h1>${escapeHtml(title.heading)}</h1>
              <p>${escapeHtml(title.lede)}</p>
              <div class="tg-pill-row">
                ${title.pills.map((pill) => `<span class="tg-pill ${pill.variant ? `tg-pill--${pill.variant}` : ""}">${escapeHtml(pill.label)}</span>`).join("")}
              </div>
              <div class="tg-top-actions">
                ${renderActionButton(title.primaryHref, title.primaryLabel, true)}
                ${title.secondaryHref ? renderActionButton(title.secondaryHref, title.secondaryLabel, false) : ""}
              </div>
              <div class="tg-hero-kpis">
                ${title.kpis.map((kpi) => `
                  <div class="tg-kpi">
                    <span>${escapeHtml(kpi.label)}</span>
                    <strong>${escapeHtml(kpi.value)}</strong>
                  </div>
                `).join("")}
              </div>
            </div>
            <div class="tg-hero-panel">
              <div class="tg-hero-panel-head">
                <strong class="tg-panel-title">${escapeHtml(title.panelTitle)}</strong>
                <span class="tg-panel-note">${escapeHtml(title.panelNote)}</span>
              </div>
              ${sourceStrip}
              ${title.panelBody || ""}
            </div>
          </section>

          ${content}
          </section>
        </div>
      </main>

      <footer class="footer tg-footer">
        <p>Diptopal Roy. TradeGraph as a product-first operating surface for Indian SME decision workflows.</p>
        <p>${escapeHtml(title.footer || "TradeGraph")}</p>
      </footer>
    </div>
  `;
}

function renderSuiteGraph(profileId) {
  const snapshot = buildCompanyGraphSnapshot(profileId);
  const productCards = [
    {
      label: "VerifySME",
      value: snapshot.verify.compositeScore,
      detail: `${snapshot.supplier.name} trust score with ${snapshot.verify.evidenceCount} evidence points`,
      variant: snapshot.verify.riskBand === "Low risk" ? "accent" : "",
    },
    {
      label: "TenderRadar",
      value: snapshot.tender.topOpportunity?.analysis?.totalScore || 0,
      detail: snapshot.tender.topOpportunity ? `${snapshot.tender.topOpportunity.title}` : "No tender visible",
      variant: snapshot.tender.topOpportunity?.analysis?.fitBand === "High fit" ? "accent" : "warning",
    },
    {
      label: "ExportPulse",
      value: snapshot.export.topOpportunity?.analysis?.totalScore || 0,
      detail: snapshot.export.topOpportunity ? `${snapshot.export.topOpportunity.market} route readiness` : "No route visible",
      variant: snapshot.export.topOpportunity?.analysis?.readinessBand === "Ready now" ? "accent" : "warning",
    },
  ];

  const nextActionRows = snapshot.nextActions.map((action, index) => [
    `<strong>${index + 1}</strong>`,
    escapeHtml(action),
  ]);

  return `
    <div class="tg-section tg-section--flush">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Company graph</p>
          <h2>One supplier record, three decision surfaces.</h2>
          <p class="tg-section-intro">Pick a profile to see how trust, tender fit, and export readiness connect into one operating picture.</p>
        </div>
        <div class="tg-pill-row">
          ${suiteProfiles
            .map(
              (profile) => `
                <button type="button" class="tg-pill ${profile.id === profileId ? "tg-pill--accent" : ""}" data-suite-profile="${profile.id}">
                  ${escapeHtml(profile.label)}
                </button>
              `,
            )
            .join("")}
        </div>
      </div>
      ${renderMetricGrid(
        buildOverviewMetrics(suppliers, tenders, exportMarkets, localRead(WATCHLIST_KEY, [])),
      )}
      <div class="tg-grid tg-grid--3">
        ${productCards
          .map(
            (card) => `
              <article class="tg-card ${card.variant === "accent" ? "tg-card--accent" : ""}">
                <span class="tg-card-kicker">${escapeHtml(card.label)}</span>
                <h3>${escapeHtml(String(card.value))}</h3>
                <p>${escapeHtml(card.detail)}</p>
              </article>
            `,
          )
          .join("")}
      </div>
      <div class="tg-two-col">
        <article class="tg-card">
          <span class="tg-card-kicker">What the owner sees</span>
          <h3>${escapeHtml(snapshot.suite.label)}</h3>
          <p>${escapeHtml(snapshot.suite.narrative)}</p>
          <ul class="tg-checklist">
            <li>Supplier: ${escapeHtml(snapshot.supplier.name)} · ${escapeHtml(snapshot.supplier.city)}, ${escapeHtml(snapshot.supplier.state)}</li>
            <li>Tender: ${escapeHtml(snapshot.tender.topOpportunity?.title || "No visible tender")}</li>
            <li>Route: ${escapeHtml(snapshot.export.topOpportunity?.market || "No visible route")}</li>
          </ul>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Next actions</span>
          <h3>Decision chain</h3>
          <table class="tg-table">
            <tbody>
              ${nextActionRows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </article>
      </div>
    </div>
  `;
}

function getProductMetrics(productKey, profileId = suiteProfiles[0].id) {
  const suiteProfile = suiteProfiles.find((item) => item.id === profileId) || suiteProfiles[0];
  const linkedSupplier = suppliers.find((item) => item.id === suiteProfile.supplierId) || suppliers[0];
  if (productKey === "verifysme") {
    const trust = buildTrustDistribution(suppliers);
    const freshness = suppliers
      .slice()
      .sort((left, right) => left.freshnessDays - right.freshnessDays)
      .map((supplier) => ({ label: supplier.name, value: 30 - supplier.freshnessDays, valueText: `${supplier.freshnessDays}d` }));

    return {
      bars: trust.map((item) => ({ label: item.label, value: item.value, valueText: String(item.value) })),
      freshness,
      table: sourceCoverage.find((item) => item.id === "verifysme"),
    };
  }

  if (productKey === "tenderradar") {
    const profile = tenderProfiles.find((item) => item.id === suiteProfile.tenderProfileId) || tenderProfiles[0];
    const ranked = buildRadarView(tenders, profile);
    const summary = summarizeRadar(ranked);

    const urgency = ranked.slice(0, 5).map((item) => ({ label: item.title, value: item.analysis.daysLeft, valueText: item.analysis.urgency, variant: item.analysis.urgency === "Closing soon" ? "danger" : item.analysis.urgency === "Planning window" ? "warn" : "" }));
    const fitMix = topEntries(summary.buyerMix, 4).map(([label, value]) => ({ label, value, valueText: String(value) }));

    return { bars: fitMix, urgency, table: sourceCoverage.find((item) => item.id === "tenderradar"), profile, summary };
  }

  const exportProfile = exportProfiles.find((item) => item.id === suiteProfile.exportProfileId) || exportProfiles[0];
  const slicedMarkets = exportMarkets.filter(
    (opportunity) =>
      !exportProfile.targetMarkets.length ||
      exportProfile.targetMarkets.some((market) => marketsMatch(market, opportunity.market)) ||
      opportunity.matchSupplierIds.includes(linkedSupplier.id),
  );
  const scored = buildExportOpportunityView(slicedMarkets, linkedSupplier);
  const summary = summarizeExportWorkspace(scored);
  const readiness = scored.slice(0, 5).map((item) => ({ label: item.market, value: item.analysis.totalScore, valueText: item.analysis.readinessBand, variant: item.analysis.readinessBand === "Ready now" ? "accent" : item.analysis.readinessBand === "Needs 1-2 fixes" ? "warn" : "danger" }));
  const blockerMix = topEntries(buildBlockerMix(scored), 4).map(([label, value]) => ({ label, value, valueText: String(value) }));

  return { bars: blockerMix, readiness, table: sourceCoverage.find((item) => item.id === "exportpulse"), profile: exportProfile, supplier: linkedSupplier, summary };
}

function renderHomePage(state) {
  const profileId = state.profileId;
  const snapshot = buildCompanyGraphSnapshot(profileId);
  const trustBars = buildTrustDistribution(suppliers).map((item) => ({ label: item.label, value: item.value, valueText: String(item.value), variant: item.label === "Needs diligence" ? "danger" : "" }));
  const readinessBars = buildExportReadinessSeries(suppliers)
    .slice()
    .sort((left, right) => right.value - left.value)
    .map((item) => ({ label: item.name, value: item.value, valueText: `${item.value}`, variant: item.value >= 80 ? "accent" : item.value >= 70 ? "warn" : "danger" }));

  const heroTitle = {
    eyebrow: "Supplier trust, procurement intelligence, and export planning",
    heading: "TradeGraph turns public feeds and official company checks into three business decisions.",
    lede:
      "VerifySME checks whether a supplier is real and usable. TenderRadar checks whether a tender is worth chasing. ExportPulse checks which export route is viable next.",
    primaryLabel: "Open app overview",
    primaryHref: `${ROOT}/app/overview.html`,
    secondaryLabel: "Read the product docs",
    secondaryHref: `${ROOT}/docs.html`,
    panelTitle: "How data enters TradeGraph",
    panelNote: "Live feeds + assisted official checks",
    kpis: [
      { label: "Supplier diligence", value: `${snapshot.verify.compositeScore}/100` },
      { label: "Bid fit", value: `${snapshot.tender.topOpportunity?.analysis?.totalScore || 0}/100` },
      { label: "Route readiness", value: `${snapshot.export.topOpportunity?.analysis?.totalScore || 0}/100` },
    ],
    pills: [
      { label: "Public data first", variant: "accent" },
      { label: "Assisted MCA + Udyam", variant: "warning" },
      { label: "History + provenance", variant: "" },
    ],
    panelBody: `
      <div class="tg-data-flow">
        <article class="tg-flow-step">
          <strong>1. Live public feeds</strong>
          <p>GeM BidPlus, CPPP tender listings, and DGFT trade notices are synced into the workspace.</p>
        </article>
        <article class="tg-flow-step">
          <strong>2. Official company checks</strong>
          <p>MCA and Udyam enter through assisted official workflows, so the evidence remains grounded in source systems.</p>
        </article>
        <article class="tg-flow-step">
          <strong>3. Decision outputs</strong>
          <p>The same company record powers trust scoring, bid/no-bid qualification, and route readiness planning.</p>
        </article>
      </div>
    `,
    footer: "Suite landing",
  };

  const content = `
    <section class="tg-section">
      <div class="tg-two-col">
        ${renderWorkspaceActivationCard(state, {
          note: state.session?.signedIn
            ? "The workspace shell is active. Use it to keep alerts, billing state, and source-refresh actions tied to a real operator context."
            : "The fastest path is to use the demo workspace, then move into a real account once you want persistence and collaboration.",
        })}
        <article class="tg-card">
          <span class="tg-card-kicker">First-run path</span>
          <h3>Get to a usable workflow in three steps.</h3>
          <ul class="tg-checklist">
            <li>Open the workspace access flow or enter the seeded demo workspace.</li>
            <li>Check live source health so you know which signals are current, assisted, or restricted.</li>
            <li>Move into VerifySME, TenderRadar, or ExportPulse with the same company graph and saved workspace state.</li>
          </ul>
          <div class="tg-top-actions">
            ${renderActionButton(`${ROOT}/app/ops/sources.html`, "Review source ops", true)}
            ${renderActionButton(`${ROOT}/app/verifysme/queue.html`, "Open VerifySME")}
          </div>
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Persona entry rails</p>
          <h2>Enter through the decision you actually own.</h2>
          <p class="tg-section-intro">Founders, sourcing leads, bid managers, and export managers should not have to reverse-engineer the product tree.</p>
        </div>
      </div>
      ${renderPersonaRails()}
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Suite landing</p>
          <h2>What this suite actually does for an Indian SME owner.</h2>
          <p class="tg-section-intro">The suite uses one evidence graph to support three commercial decisions: trust the supplier, qualify the bid, and enter the route.</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        ${Object.values(PRODUCT_CONTENT)
          .map(
            (product) => `
              <article class="tg-card tg-card--accent">
                <span class="tg-card-kicker">${escapeHtml(product.eyebrow)}</span>
                <h3>${escapeHtml(product.label)}</h3>
                <p>${escapeHtml(product.summary)}</p>
                <div class="tg-pill-row">
                  <span class="tg-pill">${escapeHtml(product.decision)}</span>
                </div>
                <div class="tg-top-actions" style="margin-top: 12px">
                  <a class="tg-cta tg-cta--accent" href="${ROOT}/products/${product.label.toLowerCase()}.html">Open product page</a>
                  <a class="tg-cta" href="${product.previewCta}">Open app</a>
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Reality check</p>
          <h2>TradeGraph is explicit about what is live, assisted, and launch-ready.</h2>
          <p class="tg-section-intro">The suite is stronger when trust claims stay precise. Public feeds are live. Official portal work is assisted where the source contract demands it.</p>
        </div>
      </div>
      ${renderRealityCards(PRODUCT_CONTENT.verifysme)}
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">What data is actually in the product</p>
          <h2>TradeGraph is a decision layer over real company, tender, and trade signals.</h2>
          <p class="tg-section-intro">The suite does not invent a generic dataset. It normalizes a few concrete source classes and turns them into operating decisions.</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        <article class="tg-card">
          <span class="tg-card-kicker">Company data</span>
          <h3>Identity and trust signals</h3>
          <ul class="tg-checklist">
            <li>MCA company master data and directors</li>
            <li>Udyam registration evidence</li>
            <li>Supplier summaries, evidence freshness, and diligence status</li>
          </ul>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Demand data</span>
          <h3>Procurement opportunity flow</h3>
          <ul class="tg-checklist">
            <li>GeM BidPlus opportunities</li>
            <li>CPPP tender-by-date listings</li>
            <li>Qualification blockers, urgency, and bid-fit scoring</li>
          </ul>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Trade data</span>
          <h3>Export route planning inputs</h3>
          <ul class="tg-checklist">
            <li>DGFT trade notices and policy changes</li>
            <li>Market-route profiles and readiness blockers</li>
            <li>Action queues tied back to the same company record</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Shared moat</p>
          <h2>One graph, three decisions.</h2>
          <p class="tg-section-intro">The commercial moat is a connected evidence graph across identity, capability, opportunity, and route readiness.</p>
        </div>
      </div>
      ${renderMetricGrid(dashboardNarrative.map((item, index) => ({ label: item.label, value: item.value, detail: index === 0 ? "Shared company graph" : index === 1 ? "Public pilot for buyers and operators" : "Seats, alerts, diligence, and services", accent: index === 0 })))}
      <div class="tg-two-col">
        <article class="tg-card">
          <span class="tg-card-kicker">Decision chain</span>
          <h3>Company -> Opportunity -> Route -> Action</h3>
          <div class="tg-tree-map">
            <div class="tg-tree-node">
              <strong>VerifySME</strong>
              <p>Can I trust this supplier/company enough to engage?</p>
            </div>
            <div class="tg-tree-node">
              <strong>TenderRadar</strong>
              <p>Should we spend time and money pursuing this tender?</p>
            </div>
            <div class="tg-tree-node">
              <strong>ExportPulse</strong>
              <p>Which market route can we realistically enter next, and what blocks it?</p>
            </div>
          </div>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Profile switcher</span>
          <h3>See the same company through different lenses</h3>
          <div class="tg-pill-row">
            ${suiteProfiles
              .map(
                (profile) => `
                  <button type="button" class="tg-pill ${profile.id === profileId ? "tg-pill--accent" : ""}" data-suite-profile="${profile.id}">
                    ${escapeHtml(profile.label)}
                  </button>
                `,
              )
              .join("")}
          </div>
          <div class="tg-divider"></div>
          <p>${escapeHtml(snapshot.suite.narrative)}</p>
          <ul class="tg-checklist">
            ${snapshot.nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
          </ul>
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Data density</p>
          <h2>Readable charts, not decorative cards.</h2>
          <p class="tg-section-intro">The suite needs trust distribution, readiness spread, and source maps. These are the first meaningful visual surfaces in the rebuilt experience.</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        <article class="tg-card">
          ${renderBarChart(trustBars, { title: "Supplier trust spread", note: "Risk bands across the supplier set" })}
        </article>
        <article class="tg-card">
          ${renderBarChart(readinessBars, { title: "Export readiness by supplier", note: "Higher is closer to route activation", max: 100 })}
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Source map</span>
          <h3>What data powers each product</h3>
          ${renderSourceTable(sourceCoverage.find((item) => item.id === "verifysme"))}
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Customer demo path</p>
          <h2>One visible journey through the suite.</h2>
          <p class="tg-section-intro">The fastest way to understand the product is to walk the same company through diligence, bid qualification, route planning, and ops history.</p>
        </div>
      </div>
      ${renderDemoJourney()}
    </section>
  `;

  return { heroTitle, content };
}

function renderDocsPage() {
  const heroTitle = {
    eyebrow: "Data and workflow notes",
    heading: "How TradeGraph sources data and turns it into operator workflows.",
    lede:
      "Use this page to understand the page tree, the source adapters, and exactly how company data becomes trust scores, tender decisions, and route plans.",
    primaryLabel: "Open overview",
    primaryHref: `${ROOT}/app/overview.html`,
    secondaryLabel: "Open pricing",
    secondaryHref: `${ROOT}/pricing.html`,
    panelTitle: "Page tree",
    panelNote: "Product-first, tree-structured",
    kpis: [
      { label: "Public pages", value: "Suite + use cases + products" },
      { label: "App pages", value: "Overview + product workspaces + ops" },
      { label: "Moat", value: "Evidence graph + provenance" },
    ],
    pills: [
      { label: "Separate URLs", variant: "accent" },
      { label: "Deep links", variant: "" },
      { label: "Decision trace", variant: "warning" },
    ],
    footer: "Docs",
  };

  const content = `
    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">How to read the suite</p>
          <h2>Public pages explain the why. App pages handle the work.</h2>
        </div>
      </div>
      <div class="tg-tree-map">
        <div class="tg-tree-node">
          <strong>/tradegraph/index.html</strong>
          <p>Suite landing. Explains the company graph, the three products, and the commercial thesis.</p>
        </div>
        <div class="tg-tree-node">
          <strong>/tradegraph/use-cases/*.html</strong>
          <p>Problem-first pages for supplier verification, tender qualification, and export launch.</p>
        </div>
        <div class="tg-tree-node">
          <strong>/tradegraph/products/*.html</strong>
          <p>Product landing pages with operator context, source framing, and a clear route into the app shell.</p>
        </div>
        <div class="tg-tree-node">
          <strong>/tradegraph/app/*.html</strong>
          <p>Operational dashboards and detail views with a real left tree nav and breadcrumbs.</p>
        </div>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Source modes</p>
          <h2>TradeGraph has two sourcing modes on purpose.</h2>
          <p class="tg-section-intro">Some data is synced live from public pages. Some data stays official and assisted because the portal boundary is part of the source contract.</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--2">
        <article class="tg-card tg-card--accent">
          <span class="tg-card-kicker">Live public feeds</span>
          <h3>Used for TenderRadar and ExportPulse</h3>
          <ul class="tg-checklist">
            <li>GeM BidPlus: open bid feed</li>
            <li>CPPP ePublishing: tender-by-date listings</li>
            <li>DGFT: trade notices and policy PDFs</li>
            <li>MCA OGD catalog: public master-data visibility and freshness</li>
          </ul>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Assisted official checks</span>
          <h3>Used for VerifySME trust evidence</h3>
          <ul class="tg-checklist">
            <li>Udyam: captcha-assisted verify or official certificate import</li>
            <li>MCA: Find CIN + official master-data lookup pasted back into the workspace</li>
            <li>The product stores the structured result and provenance, not a fake scraped clone of the portal</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Object model</p>
          <h2>Company -> Opportunity -> Route -> Action</h2>
          <p class="tg-section-intro">One object graph should connect the three products instead of three disconnected tabs. This is the structuring principle for the rebuild.</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--4">
        ${[
          ["Company", "Identity, trust, compliance, and capability signals"],
          ["Opportunity", "Tender or market fit with visible thresholds"],
          ["Route", "Export path with readiness and blockers"],
          ["Action", "The next operational move for the team"],
        ]
          .map(
            ([label, detail]) => `
              <article class="tg-card">
                <span class="tg-card-kicker">${label}</span>
                <p>${detail}</p>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Public data</p>
          <h2>Known source classes and why they matter.</h2>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        ${sourceCoverage.map((group) => `
          <article class="tg-card">
            <h3>${escapeHtml(group.id.toUpperCase())}</h3>
            ${renderSourceTable(group)}
          </article>
        `).join("")}
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Concrete example</p>
          <h2>How one company flows through the suite.</h2>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        <article class="tg-card">
          <span class="tg-card-kicker">VerifySME</span>
          <h3>Atlas Flex Packaging</h3>
          <p>Use MCA and Udyam evidence to confirm the supplier is real, check directors and charges, and decide whether it enters the approved vendor queue.</p>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">TenderRadar</span>
          <h3>Packaging tender fit</h3>
          <p>Use the same company profile to score visible GeM and CPPP opportunities, surface threshold blockers, and decide bid / no-bid / partner.</p>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">ExportPulse</span>
          <h3>GCC route readiness</h3>
          <p>Use the same supplier capability and compliance posture to judge whether a GCC packaging route is ready now or blocked by missing paperwork and market prep.</p>
        </article>
      </div>
    </section>
  `;

  return { heroTitle, content };
}

function renderPricingPage(currentState) {
  const billingProvider = getProviderStatus(currentState, "billing");
  const billingLive = billingProvider?.status === "configured";
  const signedIn = Boolean(currentState.session?.signedIn);
  const heroTitle = {
    eyebrow: "Commercial model",
    heading: "Pricing that matches the way operators actually buy.",
    lede:
      "The suite should sell trust, time saved, and better decisions, not generic seat counts with no workflow value.",
    primaryLabel: billingLive && signedIn ? "Start Pro checkout" : "Request demo / pricing",
    primaryHref: billingLive && signedIn ? `${ROOT}/pricing.html#checkout` : "/contact.html?intent=operator-buyer&product=TradeGraph&source=tradegraph-pricing",
    secondaryLabel: "Read docs",
    secondaryHref: `${ROOT}/docs.html`,
    panelTitle: "Packaging",
    panelNote: billingLive ? "Free -> Pro -> Enterprise" : "Lead capture until billing is live",
    kpis: [
      { label: "Entry", value: "Free workspace" },
      { label: "Expansion", value: "Pro seats + alerts" },
      { label: "Billing mode", value: billingLive ? "Stripe live" : "Lead capture" },
    ],
    pills: [
      { label: billingLive ? "Checkout enabled" : "Checkout hidden until live", variant: "accent" },
      { label: "Pricing honesty", variant: "warning" },
      { label: "Workspace-scoped", variant: "" },
    ],
    panelBody: `
      <div class="tg-data-flow">
        <article class="tg-flow-step">
          <strong>Free</strong>
          <p>Use a workspace, review sources, and validate the buyer journey without fake purchase behavior.</p>
        </article>
        <article class="tg-flow-step">
          <strong>Pro</strong>
          <p>Shared workspace, more alerts, and repeat operator workflows once the team is beyond one-off evaluation.</p>
        </article>
        <article class="tg-flow-step">
          <strong>Enterprise</strong>
          <p>Custom source coverage, onboarding, and governance for teams treating the suite as operating infrastructure.</p>
        </article>
      </div>
    `,
    footer: "Pricing",
  };

  const plans = [
    {
      name: "Pilot",
      price: "Talk to us",
      detail: "Single-workspace review for one company graph and one decision loop.",
      bullets: ["Public product walk-through", "One live workspace", "Decision review session"],
    },
    {
      name: "Team",
      price: "Seats + alerts",
      detail: "For teams making repeat supplier, tender, or export decisions each week.",
      bullets: ["Shared workspace", "Saved views", "Operational alerts", "Provenance drawers"],
      accent: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      detail: "For organizations that need integrations, SLAs, or managed source coverage.",
      bullets: ["Custom ingestion", "Analyst workflows", "Governance and audit logs", "API access"],
    },
  ];

  const content = `
    <section class="tg-section">
      <div class="tg-grid tg-grid--3">
        ${plans
          .map(
            (plan) => `
              <article class="tg-card ${plan.accent ? "tg-card--accent" : ""}">
                <span class="tg-card-kicker">${escapeHtml(plan.name)}</span>
                <h3>${escapeHtml(plan.price)}</h3>
                <p>${escapeHtml(plan.detail)}</p>
                <ul class="tg-checklist">
                  ${plan.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
                </ul>
                <div class="tg-top-actions" style="margin-top: 12px">
                  ${
                    plan.name === "Pilot"
                      ? renderActionButton(`${ROOT}/app/overview.html`, "Open workspace", true)
                      : plan.name === "Team" && billingLive && signedIn
                        ? renderActionTrigger("Start Pro checkout", 'data-start-checkout="pro"', true)
                        : renderActionButton("/contact.html?intent=operator-buyer&product=TradeGraph&source=tradegraph-pricing", "Request demo", true)
                  }
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>

    <section class="tg-section" id="checkout">
      <div class="tg-two-col">
        ${renderBillingTruthCard(currentState)}
        <article class="tg-card">
          <span class="tg-card-kicker">What the buyer is buying</span>
          <h3>Decision quality with visible proof.</h3>
          <ul class="tg-checklist">
            <li>One workspace across supplier, tender, and export workflows.</li>
            <li>Source freshness, provenance, and stage movement visible in the product.</li>
            <li>No fake-live billing claims when Stripe is not configured on the current deployment.</li>
          </ul>
          <div class="tg-top-actions">
            ${renderActionButton("/contact.html?intent=operator-buyer&product=TradeGraph&source=tradegraph-pricing", "Talk pricing", true)}
            ${renderActionButton(`${ROOT}/app/ops/billing.html`, "Inspect billing mode")}
          </div>
        </article>
      </div>
    </section>
  `;

  return { heroTitle, content };
}

function renderUseCaseIndexPage() {
  const heroTitle = {
    eyebrow: "Use cases",
    heading: "Three operator journeys, one evidence graph.",
    lede:
      "Start with the operating problem, not the feature list. Each TradeGraph use case maps to a buyer trigger and a measurable decision.",
    primaryLabel: "Open suite overview",
    primaryHref: `${ROOT}/app/overview.html`,
    secondaryLabel: "Open product pages",
    secondaryHref: `${ROOT}/products/index.html`,
    panelTitle: "Buyer triggers",
    panelNote: "Procurement, bid desk, export planning",
    kpis: [
      { label: "Journeys", value: "3" },
      { label: "Shared graph", value: "Company -> Opportunity -> Route" },
      { label: "Buyer", value: "Indian SME owner/operator" },
    ],
    pills: [
      { label: "Problem-first", variant: "accent" },
      { label: "Role-specific", variant: "" },
      { label: "Decision-led", variant: "warning" },
    ],
    footer: "Use cases",
  };

  const content = `
    <section class="tg-section">
      <div class="tg-grid tg-grid--3">
        ${Object.entries(PRODUCT_CONTENT)
          .map(([productKey, product]) => `
            <article class="tg-card tg-card--accent">
              <span class="tg-card-kicker">${escapeHtml(product.eyebrow)}</span>
              <h3>${escapeHtml(product.label)}</h3>
              <p>${escapeHtml(product.decision)}</p>
              <ul class="tg-checklist">
                <li>${escapeHtml(product.buyer)}</li>
                <li>${escapeHtml(product.outcomes[0])}</li>
                <li>${escapeHtml(product.moat[0])}</li>
              </ul>
              <div class="tg-top-actions" style="margin-top: 12px">
                <a class="tg-cta tg-cta--accent" href="${ROOT}/use-cases/${productKey === "verifysme" ? "supplier-verification" : productKey === "tenderradar" ? "tender-qualification" : "export-launch"}.html">Read use case</a>
                <a class="tg-cta" href="${ROOT}/products/${productKey}.html">Open product</a>
              </div>
            </article>
          `)
          .join("")}
      </div>
    </section>
  `;

  return { heroTitle, content };
}

function renderUseCasePage(productKey, currentState) {
  const product = PRODUCT_CONTENT[productKey];
  const visual = getProductMetrics(productKey, currentState.profileId);

  const heroTitle = {
    eyebrow: `Use case / ${product.label}`,
    heading: product.title,
    lede: product.summary,
    primaryLabel: `Open ${product.label}`,
    primaryHref: `${ROOT}/products/${product.label.toLowerCase()}.html`,
    secondaryLabel: "Open app",
    secondaryHref: product.previewCta,
    panelTitle: product.decision,
    panelNote: product.buyer,
    kpis: [
      { label: "Decision", value: product.decision },
      { label: "Audience", value: product.buyer },
      { label: "Outcome", value: product.outcomes[0] },
    ],
    pills: [
      { label: "Problem first", variant: "accent" },
      { label: "Public data backed", variant: "" },
      { label: "Decision trace", variant: "warning" },
    ],
    footer: `Use case / ${product.label}`,
  };

  const content = `
    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Who this is for</p>
          <h2>${escapeHtml(product.buyer)}</h2>
          <p class="tg-section-intro">${escapeHtml(product.summary)}</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        ${product.outcomes.map((item, index) => `
          <article class="tg-card ${index === 0 ? "tg-card--accent" : ""}">
            <span class="tg-card-kicker">Outcome ${index + 1}</span>
            <p>${escapeHtml(item)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Why it works</p>
          <h2>What data the product needs and what it returns.</h2>
        </div>
      </div>
      <div class="tg-grid tg-grid--2">
        <article class="tg-card">
          <span class="tg-card-kicker">Moat</span>
          <h3>Why this product is harder to copy</h3>
          <ul class="tg-checklist">
            ${product.moat.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Data coverage</span>
          <h3>${escapeHtml(product.label)} source map</h3>
          ${renderSourceTable(product.sources)}
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Trust boundary</p>
          <h2>What is real today versus assisted today.</h2>
        </div>
      </div>
      ${renderRealityCards(product)}
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Workflow</p>
          <h2>The sample operator path through ${escapeHtml(product.label)}.</h2>
        </div>
      </div>
      ${renderWorkflowSteps(product)}
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Visual proof</p>
          <h2>Readable decision surfaces, not decorative cards.</h2>
        </div>
      </div>
      <div class="tg-grid tg-grid--2">
        <article class="tg-card">
          ${renderBarChart(
            productKey === "verifysme"
              ? buildTrustDistribution(suppliers).map((item) => ({ label: item.label, value: item.value, valueText: String(item.value), variant: item.label === "Needs diligence" ? "danger" : "" }))
              : productKey === "tenderradar"
                ? visual.urgency.slice(0, 4)
                : visual.readiness.slice(0, 4),
            {
              title:
                productKey === "verifysme"
                  ? "Trust distribution"
                  : productKey === "tenderradar"
                    ? "Closing urgency"
                    : "Route readiness spread",
            },
          )}
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Decision question</span>
          <h3>${escapeHtml(product.decision)}</h3>
          <ul class="tg-checklist">
            ${product.pageTree.map((item) => `<li><a href="${item.href}">${escapeHtml(item.label)}</a></li>`).join("")}
          </ul>
          <div class="tg-top-actions">
            <a class="tg-cta tg-cta--accent" href="${product.previewCta}">${escapeHtml(product.livePreviewLabel)}</a>
          </div>
        </article>
      </div>
    </section>
  `;

  return { heroTitle, content };
}

function renderProductIndexPage() {
  const heroTitle = {
    eyebrow: "Products",
    heading: "Three first-class products inside one suite.",
    lede:
      "Each product has its own workflow, screens, and buyer logic. They share data, not presentation clutter.",
    primaryLabel: "Open app overview",
    primaryHref: `${ROOT}/app/overview.html`,
    secondaryLabel: "Read use cases",
    secondaryHref: `${ROOT}/use-cases/index.html`,
    panelTitle: "Suite model",
    panelNote: "Separate products, shared graph",
    kpis: [
      { label: "Products", value: "3" },
      { label: "Ops layer", value: "1" },
      { label: "Shared object model", value: "Company -> Opportunity -> Route -> Action" },
    ],
    pills: [
      { label: "Product-first", variant: "accent" },
      { label: "Tree nav", variant: "" },
      { label: "Shared workspace", variant: "warning" },
    ],
    footer: "Products",
  };

  const content = `
    <section class="tg-section">
      <div class="tg-grid tg-grid--3">
        ${Object.entries(PRODUCT_CONTENT)
          .map(([productKey, product]) => `
            <article class="tg-card">
              <span class="tg-card-kicker">${escapeHtml(product.eyebrow)}</span>
              <h3>${escapeHtml(product.label)}</h3>
              <p>${escapeHtml(product.summary)}</p>
              <ul class="tg-checklist">
                <li>${escapeHtml(product.decision)}</li>
                <li>${escapeHtml(product.buyer)}</li>
                <li>${escapeHtml(product.outcomes[0])}</li>
              </ul>
              <div class="tg-top-actions" style="margin-top: 12px">
                <a class="tg-cta tg-cta--accent" href="${ROOT}/products/${productKey}.html">Open product page</a>
                <a class="tg-cta" href="${product.previewCta}">Open app</a>
              </div>
            </article>
          `)
          .join("")}
      </div>
    </section>
  `;

  return { heroTitle, content };
}

function renderProductPage(productKey, currentState) {
  const product = PRODUCT_CONTENT[productKey];
  const visual = getProductMetrics(productKey, currentState.profileId);

  const heroTitle = {
    eyebrow: `Product / ${product.label}`,
    heading: `${product.label} as a serious B2B product`,
    lede: product.summary,
    primaryLabel: `Open ${product.label} app`,
    primaryHref: product.previewCta,
    secondaryLabel: "Open use case",
    secondaryHref: `${ROOT}/use-cases/${productKey === "verifysme" ? "supplier-verification" : productKey === "tenderradar" ? "tender-qualification" : "export-launch"}.html`,
    panelTitle: product.decision,
    panelNote: product.buyer,
    kpis: [
      { label: "Buyer", value: product.buyer },
      { label: "Decision", value: product.decision },
      { label: "Moat", value: product.moat[0] },
    ],
    pills: [
      { label: "Workflow map", variant: "accent" },
      { label: "Tree nav", variant: "" },
      { label: "Provenance", variant: "warning" },
    ],
    footer: `Product page / ${product.label}`,
  };

  const content = `
    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Commercial framing</p>
          <h2>What the user gets from ${escapeHtml(product.label)}.</h2>
          <p class="tg-section-intro">${escapeHtml(product.summary)}</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        ${product.outcomes.map((item) => `
          <article class="tg-card">
            <span class="tg-card-kicker">Outcome</span>
            <p>${escapeHtml(item)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Decision surfaces</p>
          <h2>What the operator sees before opening the app.</h2>
          <p class="tg-section-intro">The product page explains the workflow and the data shape. The operational surface lives in the app shell.</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        <article class="tg-card">
          ${
            productKey === "verifysme"
              ? renderBarChart(visual.bars, { title: "Trust distribution", note: "Risk spread across the supplier set" })
              : productKey === "tenderradar"
                ? renderBarChart(visual.bars, { title: "Buyer concentration", note: "Where this profile is seeing visible tender volume" })
                : renderBarChart(visual.readiness, { title: "Route readiness", note: "Current route portfolio by market" })
          }
        </article>
        <article class="tg-card">
          ${
            productKey === "verifysme"
              ? renderBarChart(visual.freshness.slice(0, 5), { title: "Evidence freshness", note: "Recently refreshed supplier records" })
              : productKey === "tenderradar"
                ? renderBarChart(visual.urgency.slice(0, 5), { title: "Deadline pressure", note: "Closest visible tenders for the active company profile" })
                : renderBarChart(visual.bars, { title: "Readiness blockers", note: "What blocks route activation most often" })
          }
        </article>
        <article class="tg-card tg-card--accent">
          <span class="tg-card-kicker">Workflow path</span>
          <h3>${escapeHtml(product.livePreviewLabel)}</h3>
          <ul class="tg-checklist">
            ${product.pageTree.map((item) => `<li><a href="${item.href}">${escapeHtml(item.label)}</a></li>`).join("")}
          </ul>
          <div class="tg-top-actions" style="margin-top: 12px">
            <a class="tg-cta tg-cta--accent" href="${product.previewCta}">Open operational workspace</a>
          </div>
          <p class="tg-note">Current profile lens: ${escapeHtml(suiteProfiles.find((item) => item.id === currentState.profileId)?.label || suiteProfiles[0].label)}</p>
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-two-col">
        <article class="tg-card">
          <span class="tg-card-kicker">Public proof</span>
          <h3>${escapeHtml(product.label)} source map</h3>
          ${renderSourceTable(product.sources)}
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Moat</span>
          <h3>Why the product stays useful</h3>
          <ul class="tg-checklist">
            ${product.moat.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
          <div class="tg-divider"></div>
          <div class="tg-top-actions">
            ${renderActionButton(product.previewCta, `Open ${product.label} workspace`, true)}
            ${renderActionButton("/contact.html?intent=operator-buyer&product=TradeGraph&source=tradegraph-product", "Request demo")}
          </div>
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Reality check</p>
          <h2>Live versus assisted on this product surface.</h2>
        </div>
      </div>
      ${renderRealityCards(product)}
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Workflow</p>
          <h2>How the operator should move through the product.</h2>
        </div>
      </div>
      ${renderWorkflowSteps(product)}
    </section>
  `;

  return { heroTitle, content };
}

function renderOverviewPage(state) {
  const profileId = state.profileId;
  const snapshot = buildCompanyGraphSnapshot(profileId);
  const sources = state.sources;
  const overviewMetrics = buildOverviewMetrics(suppliers, tenders, exportMarkets, localRead(WATCHLIST_KEY, []));

  const heroTitle = {
    eyebrow: "App overview",
    heading: "One operating picture for all three commercial decisions.",
    lede:
      "This overview page is the cross-product command center: source health, company graph, alerting, and the three module entry points.",
    primaryLabel: "Open VerifySME queue",
    primaryHref: `${ROOT}/app/verifysme/queue.html`,
    secondaryLabel: "Open TenderRadar pipeline",
    secondaryHref: `${ROOT}/app/tenderradar/pipeline.html`,
    panelTitle: "Workspace status",
    panelNote: state.session?.workspace?.name || "Guest workspace",
    kpis: [
      { label: "Session", value: state.session?.signedIn ? "Signed in" : "Guest" },
      { label: "Source sets", value: `${sources?.sources?.length || 0}` },
      { label: "Live sets", value: `${sources?.sources?.filter((source) => source.status === "live").length || 0}` },
    ],
    pills: [
      { label: "History", variant: "accent" },
      { label: "Provenance", variant: "" },
      { label: "Action queue", variant: "warning" },
    ],
    footer: "Overview",
  };

  const productRows = Object.values(PRODUCT_CONTENT).map((product) => ({
    title: product.label,
    detail: product.decision,
    href: product.previewCta,
  }));

  const sourceRows = (sources?.sources || []).map((source) => ({
    label: source.label,
    status: source.status,
    detail: source.note,
    count: source.itemCount,
  }));

  const content = `
    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Company graph</p>
          <h2>Switch the underlying company and see the same workflow from three angles.</h2>
        </div>
      </div>
      <div class="tg-pill-row">
        ${suiteProfiles
          .map(
            (profile) => `
              <button type="button" class="tg-pill ${profile.id === profileId ? "tg-pill--accent" : ""}" data-suite-profile="${profile.id}">
                ${escapeHtml(profile.label)}
              </button>
            `,
          )
          .join("")}
      </div>
      ${renderMetricGrid(overviewMetrics)}
      <div class="tg-grid tg-grid--3">
        <article class="tg-card">
          <span class="tg-card-kicker">VerifySME</span>
          <h3>${escapeHtml(snapshot.supplier.name)}</h3>
          <p>${escapeHtml(snapshot.supplier.summary)}</p>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">TenderRadar</span>
          <h3>${escapeHtml(snapshot.tender.topOpportunity?.title || "No visible tender")}</h3>
          <p>${escapeHtml(snapshot.tender.topOpportunity?.scopeSummary || "No tender summary available.")}</p>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">ExportPulse</span>
          <h3>${escapeHtml(snapshot.export.topOpportunity?.market || "No route visible")}</h3>
          <p>${escapeHtml(snapshot.export.topOpportunity?.demandSignal || "No route summary available.")}</p>
        </article>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Source health</p>
          <h2>Live public sources and the company graph behind them.</h2>
        </div>
      </div>
      <div class="tg-ops-rail">
        ${sourceRows.map((source) => `
          <article class="tg-ops-card">
            <span>${escapeHtml(source.label)}</span>
            <strong>${escapeHtml(source.status)}</strong>
            <p>${escapeHtml(source.detail)} · ${escapeHtml(String(source.count || 0))} items</p>
          </article>
        `).join("")}
      </div>
      <div class="tg-module-frame">
        <div id="tradegraph-overview-control-center"></div>
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Product entry points</p>
          <h2>Each module has its own workflow tree.</h2>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        ${productRows.map((row) => `
          <article class="tg-card">
            <span class="tg-card-kicker">${escapeHtml(row.title)}</span>
            <h3>${escapeHtml(row.detail)}</h3>
            <a class="tg-cta tg-cta--accent" href="${row.href}">Open module</a>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Outcome mix</p>
          <h2>What the owner should do next.</h2>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        ${snapshot.nextActions.map((action, index) => `
          <article class="tg-card ${index === 0 ? "tg-card--accent" : ""}">
            <span class="tg-card-kicker">Next action ${index + 1}</span>
            <p>${escapeHtml(action)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;

  return { heroTitle, content };
}

function renderAppProductPage(productKey, view) {
  const product = PRODUCT_CONTENT[productKey];
  const snapshot = buildCompanyGraphSnapshot(state.profileId);
  const metrics = getProductMetrics(productKey, state.profileId);
  const viewMeta = {
    verifysme: {
      queue: {
        label: "Queue",
        lede: "A triage surface for the team to move records through diligence, shortlist, and action.",
        intro:
          "Use this queue to move supplier records through first review, evidence checks, approval, or hold states.",
      },
      suppliers: {
        label: "Suppliers",
        lede: "A ranked list of the most relevant suppliers and signals.",
        intro:
          "Use this list to intake suppliers, compare trust signals, and choose which records deserve a full diligence case.",
      },
      comparisons: {
        label: "Comparisons",
        lede: "A shortlist board for side-by-side supplier comparison before a procurement decision.",
        intro:
          "Use this view when the team has narrowed the field and needs one defensible comparison surface across trust, readiness, and next workflow.",
      },
      detail: {
        label: "Supplier detail",
        lede: "A detail view that keeps the evidence, the route, and the next action together.",
        intro: "Use this detail view to inspect one company across identity evidence, diligence notes, tender relevance, and export readiness.",
      },
    },
    tenderradar: {
      pipeline: {
        label: "Pipeline",
        lede: "A bid-desk surface for ranking tenders, assigning owners, and cutting weak pursuits early.",
        intro:
          "Use this pipeline to decide which tenders move forward, which ones need partners, and which ones should be killed early.",
      },
      opportunities: {
        label: "Opportunities",
        lede: "A ranked market view of tenders with fit, urgency, and visible blockers.",
        intro:
          "Use this ranked list to compare tender fit, urgency, and threshold gaps before the team spends time on full bid prep.",
      },
      "bid-desk": {
        label: "Bid desk",
        lede: "A working desk for shortlisted tenders, owner assignment, and bid-stage movement.",
        intro:
          "Use this view when the team is already beyond discovery and needs a tighter operating surface for live pursuits.",
      },
      detail: {
        label: "Opportunity detail",
        lede: "A decision view that holds scope, qualifications, and the next bid action together.",
        intro: "Use this detail view to inspect one opportunity, its blockers, the assigned owner, and the next bid action.",
      },
    },
    exportpulse: {
      pipeline: {
        label: "Route pipeline",
        lede: "A route-planning surface for sequencing export moves against readiness and risk.",
        intro:
          "Use this pipeline to rank export routes by readiness and move the best ones into an actual execution plan.",
      },
      markets: {
        label: "Markets",
        lede: "A route portfolio view with market-level fit, compliance pressure, and timeline signals.",
        intro:
          "Use this list to compare route attractiveness, compliance pressure, and what the company must fix before entering a market.",
      },
      "docs-readiness": {
        label: "Docs readiness",
        lede: "A route-readiness desk that keeps document gaps, blockers, and next actions together.",
        intro:
          "Use this view when the team needs to clear documentation and compliance blockers before launching a route.",
      },
      detail: {
        label: "Route detail",
        lede: "A detail view that keeps the route thesis, blockers, and action queue together.",
        intro: "Use this detail view to understand one export route, its blockers, and the next action sequence for the team.",
      },
    },
  };
  const resolvedView = viewMeta[productKey]?.[view] || {
    label: "Detail",
    lede: "A detail view that keeps the evidence, the route, and the next action together.",
    intro: "The detail view should keep the evidence, the blockers, and the next move together.",
  };
  const viewLabel = resolvedView.label;
  const heroTitle = {
    eyebrow: `App / ${product.label}`,
    heading: `${product.label} ${viewLabel.toLowerCase()}`,
    lede: resolvedView.lede,
    primaryLabel: `Open ${product.label} product page`,
    primaryHref: `${ROOT}/products/${product.label.toLowerCase()}.html`,
    secondaryLabel: "Open overview",
    secondaryHref: `${ROOT}/app/overview.html`,
    panelTitle: "Workspace context",
    panelNote: product.buyer,
    kpis: [
      { label: "Question", value: product.decision },
      { label: "Module", value: product.label },
      { label: "View", value: viewLabel },
    ],
    pills: [
      { label: "Left tree nav", variant: "accent" },
      { label: "Breadcrumbs", variant: "" },
      { label: "Decision depth", variant: "warning" },
    ],
    footer: `${product.label} / ${viewLabel}`,
  };

  const moduleMountId = `${PRODUCT_PAGE_PREFIX}${productKey}-${view}`;

  const extraCards =
    productKey === "verifysme"
      ? [
          { label: "Trust funnel", value: `${snapshot.verify.compositeScore}/100`, detail: `Evidence count: ${snapshot.verify.evidenceCount}` },
          { label: "Freshness", value: `${Math.min(...suppliers.map((supplier) => supplier.freshnessDays || 0))}d`, detail: "Newest company evidence" },
          { label: "Risk split", value: `${buildTrustDistribution(suppliers).find((item) => item.label === "Needs diligence")?.value || 0}`, detail: "Needs diligence" },
        ]
      : productKey === "tenderradar"
        ? [
            { label: "Top fit", value: `${snapshot.tender.topOpportunity?.analysis?.totalScore || 0}`, detail: snapshot.tender.topOpportunity?.title || "No visible tender" },
            { label: "Shortlist ready", value: `${metrics.summary?.counts?.shortlistReady || 0}`, detail: "Bid desk filter" },
            { label: "Closing soon", value: `${metrics.summary?.counts?.closingSoon || 0}`, detail: "Urgency pressure" },
          ]
        : [
            { label: "Ready now", value: `${snapshot.export.topOpportunity?.analysis?.readinessBand || "Needs work"}`, detail: snapshot.export.topOpportunity?.market || "No visible route" },
            { label: "Average score", value: `${metrics.summary?.averageScore || 0}`, detail: "Route portfolio" },
            { label: "Direct match", value: `${metrics.summary?.directMarketMatches || 0}`, detail: "Market proof" },
          ];

  const content = `
    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Action surface</p>
          <h2>${escapeHtml(product.label)} in a real working context.</h2>
          <p class="tg-section-intro">${escapeHtml(resolvedView.intro)}</p>
        </div>
      </div>
      <div class="tg-grid tg-grid--3">
        ${extraCards.map((card, index) => `
          <article class="tg-card ${index === 0 ? "tg-card--accent" : ""}">
            <span class="tg-card-kicker">${escapeHtml(card.label)}</span>
            <h3>${escapeHtml(String(card.value))}</h3>
            <p>${escapeHtml(card.detail)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="tg-section">
      <div class="tg-two-col">
        <article class="tg-card">
          <span class="tg-card-kicker">Live workspace</span>
          <h3>${escapeHtml(product.livePreviewLabel)}</h3>
          <div class="tg-module-frame tg-module-frame--padded">
            <div id="${moduleMountId}"></div>
          </div>
        </article>
        <article class="tg-card">
          <span class="tg-card-kicker">Provenance and source map</span>
          <h3>Why the operator should trust this screen</h3>
          ${renderSourceTable(product.sources)}
          <div class="tg-divider"></div>
          <ul class="tg-checklist">
            ${product.moat.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </article>
      </div>
    </section>
  `;

  return { heroTitle, content, moduleMountId, productKey };
}

function renderOpsPage(view, state) {
  const auditEntries = buildUnifiedAuditTimeline({
    verifyState: state.audit?.verify || {},
    tenderState: state.audit?.tender || {},
    exportState: state.audit?.export || {},
    activity: state.analytics?.summary?.recentEvents || [],
    lookups: {
      verifysme: buildLookupMap(suppliers, "id", "name"),
      tenderradar: buildLookupMap(tenders, "id", "title"),
      exportpulse: buildLookupMap(exportMarkets, "id", "market"),
    },
    limit: 12,
  });
  const auditSummary = summarizeUnifiedAudit(auditEntries);
  const heroTitle = {
    eyebrow: "Ops / Workspace control",
    heading:
      view === "sources"
        ? "Live source health and sync control."
        : view === "alerts"
          ? "Alert lifecycle and delivery control."
          : view === "billing"
            ? "Plan state and billing control."
            : view === "audit-log"
              ? "Unified audit history across workspace and product flows."
              : "Workspace membership and state control.",
    lede:
      view === "sources"
        ? "Keep connector health visible and re-sync public feeds when needed."
        : view === "alerts"
          ? "Create, test, pause, and delete rules without leaving the product shell."
          : view === "billing"
            ? "See what is configured, simulated, or live before handing the product to a customer."
            : view === "audit-log"
              ? "Inspect stage movement, evidence binding, alert activity, and workspace events in one timeline."
              : "See which workspace is active and how state is stored.",
    primaryLabel: "Open overview",
    primaryHref: `${ROOT}/app/overview.html`,
    secondaryLabel: "Open app tree",
    secondaryHref: `${ROOT}/app/overview.html`,
    panelTitle: "Workspace",
    panelNote: state.session?.workspace?.name || "Guest workspace",
    kpis: [
      { label: "Signed in", value: state.session?.signedIn ? "Yes" : "Guest" },
      { label: "Sources", value: `${state.sources?.sources?.length || 0}` },
      { label: view === "audit-log" ? "Timeline events" : "Plan", value: view === "audit-log" ? `${auditSummary.total}` : state.billing?.subscription?.plan?.label || "Free" },
    ],
    pills: [
      { label: "Controls", variant: "accent" },
      { label: "Auditability", variant: "" },
      { label: "Non-destructive", variant: "warning" },
    ],
    footer: `Ops / ${view}`,
  };

  const opsSummary = [
    {
      label: "Live sources",
      value: `${state.sources?.sources?.filter((source) => source.status === "live").length || 0}/${state.sources?.sources?.length || 0}`,
      detail: "Configured connectors that report live status.",
    },
    {
      label: "Alerts",
      value: `${state.alerts?.rules?.length || 0}`,
      detail: "Saved rules in the active workspace.",
    },
    {
      label: "Runtime",
      value: state.runtime?.runtime?.persistenceMode || "local-json",
      detail: "Persistence mode and provider readiness.",
    },
    {
      label: "Events",
      value: `${getTradeGraphAnalyticsSnapshot().total || 0}`,
      detail: "Current browser-side product event count.",
    },
  ];

  if (view === "audit-log") {
    opsSummary[1] = {
      label: "Workspace events",
      value: `${auditSummary.workspaceEvents}`,
      detail: "Alerts, source sync, billing, and workspace activity.",
    };
    opsSummary[2] = {
      label: "Case events",
      value: `${auditSummary.caseEvents}`,
      detail: "Stage changes, intake events, and product-case updates.",
    };
    opsSummary[3] = {
      label: "Evidence bindings",
      value: `${auditSummary.evidenceBindings}`,
      detail: "Official evidence attachments visible in the unified history.",
    };
  }

  const content = view === "audit-log"
    ? `
    <section class="tg-section">
      <div class="tg-ops-rail">
        ${opsSummary.map((item) => `
          <article class="tg-ops-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <p>${escapeHtml(item.detail)}</p>
          </article>
        `).join("")}
      </div>
    </section>
    <section class="tg-section">
      <div class="tg-two-col">
        ${renderWorkspaceActivationCard(state, {
          note: state.session?.signedIn
            ? "This workspace can now show audit history across product flows, alerts, and runtime operations."
            : "Enter the demo workspace or sign in to persist more meaningful audit history across the suite.",
        })}
        ${renderOpsGuideCard(view)}
      </div>
    </section>
    <section class="tg-section">
      <div class="tg-section-head">
        <div>
          <p class="tg-eyebrow">Unified timeline</p>
          <h2>Recent history across VerifySME, TenderRadar, ExportPulse, and workspace ops.</h2>
          <p class="tg-section-intro">This surface merges product-case audit logs with recent workspace activity so the operator can inspect what actually changed.</p>
        </div>
      </div>
      ${renderAuditTimeline(auditEntries)}
    </section>
  `
    : `
    <section class="tg-section">
      <div class="tg-ops-rail">
        ${opsSummary.map((item) => `
          <article class="tg-ops-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <p>${escapeHtml(item.detail)}</p>
          </article>
        `).join("")}
      </div>
    </section>
    <section class="tg-section">
      <div class="tg-two-col">
        ${renderWorkspaceActivationCard(state, {
          note: state.session?.signedIn
            ? "This workspace is active, so changes here can persist across modules. Use the manage action if you need to switch tenants, invite collaborators, or inspect the current membership boundary."
            : "The ops surface is most useful after you enter the demo workspace or sign in, because source refresh, alerts, billing state, and analytics all bind to workspace access.",
        })}
        ${renderOpsGuideCard(view)}
      </div>
    </section>
    <section class="tg-section">
      <div class="tg-module-frame tg-module-frame--padded">
        <div id="tradegraph-ops-control-center"></div>
      </div>
    </section>
  `;

  return { heroTitle, content };
}

function renderPage() {
  const pageKey = document.body.dataset.pageKey || document.body.dataset.tgPage || "home";
  const page = getPage(pageKey);
  const session = state.session;
  const workspaceLabel = session?.signedIn ? session.workspace?.name || "Signed in workspace" : "Guest workspace";
  const headerAction = `<span class="tg-pill ${session?.signedIn ? "tg-pill--accent" : "tg-pill--warning"}">${escapeHtml(workspaceLabel)}</span>`;

  document.title = `TradeGraph | ${page.title}`;

  let sidebar = "";
  let content = "";
  let hero = null;
  let moduleMount = null;
  let moduleMountType = null;

  switch (page.kind) {
    case "home": {
      const rendered = renderHomePage(state);
      hero = rendered.heroTitle;
      content = rendered.content;
      break;
    }
    case "docs": {
      const rendered = renderDocsPage();
      hero = rendered.heroTitle;
      content = rendered.content;
      break;
    }
    case "pricing": {
      const rendered = renderPricingPage(state);
      hero = rendered.heroTitle;
      content = rendered.content;
      break;
    }
    case "use-case-index": {
      const rendered = renderUseCaseIndexPage();
      hero = rendered.heroTitle;
      content = rendered.content;
      break;
    }
    case "use-case": {
      const rendered = renderUseCasePage(page.product, state);
      hero = rendered.heroTitle;
      content = rendered.content;
      break;
    }
    case "product-index": {
      const rendered = renderProductIndexPage();
      hero = rendered.heroTitle;
      content = rendered.content;
      break;
    }
    case "product": {
      const rendered = renderProductPage(page.product, state);
      hero = rendered.heroTitle;
      content = rendered.content;
      break;
    }
    case "overview": {
      const rendered = renderOverviewPage(state);
      hero = rendered.heroTitle;
      content = rendered.content;
      moduleMount = "tradegraph-overview-control-center";
      moduleMountType = "control-center";
      sidebar = renderTreeNav("overview");
      break;
    }
    case "app-product": {
      const rendered = renderAppProductPage(page.product, page.view);
      hero = rendered.heroTitle;
      content = rendered.content;
      moduleMount = rendered.moduleMountId;
      moduleMountType = rendered.productKey;
      sidebar = renderTreeNav(pageKey);
      break;
    }
    case "ops": {
      const rendered = renderOpsPage(page.view, state);
      hero = rendered.heroTitle;
      content = rendered.content;
      sidebar = renderTreeNav(pageKey);
      moduleMount = "tradegraph-ops-control-center";
      moduleMountType = "control-center";
      break;
    }
    default:
      break;
  }

  const shell = renderShell({
    title: hero,
    breadcrumbs: page.breadcrumbs,
    bodyClass: page.kind,
    sidebar,
    content,
    sourceStrip: page.kind === "overview" || page.kind === "ops" ? renderSourceStrip(state.sources) : "",
    headerAction,
  });

  root.innerHTML = shell;

  if (page.kind === "home" || page.kind === "overview" || page.kind === "product" || page.kind === "app-product" || page.kind === "ops") {
    const profileButtons = root.querySelectorAll("[data-suite-profile]");
    profileButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.profileId = button.dataset.suiteProfile;
        localWrite(SUITE_PROFILE_KEY, state.profileId);
        trackTradeGraphEvent("suite_profile_switched", { profileId: state.profileId });
        renderPage();
      });
    });
  }

  if (page.kind === "product" && moduleMount && moduleMountType) {
    const mountNode = document.getElementById(moduleMount);
    mountProductModule(moduleMountType, mountNode);
  }

  if (page.kind === "app-product" && moduleMount && moduleMountType) {
    const mountNode = document.getElementById(moduleMount);
    mountProductModule(moduleMountType, mountNode);
  }

  if (page.kind === "overview") {
    const mountNode = document.getElementById(moduleMount);
    mountControlCenter(mountNode);
  }

  if (page.kind === "ops" && moduleMount) {
    const mountNode = document.getElementById(moduleMount);
    if (page.view !== "audit-log") {
      mountControlCenter(mountNode, { focusSection: page.view });
    }
  }

  root.querySelectorAll("[data-open-workspace-access]").forEach((button) => {
    button.addEventListener("click", () => {
      const trigger = document.querySelector("[data-auth-open]");

      if (trigger) {
        trigger.click();
        return;
      }

      const note = button.closest(".tg-card")?.querySelector("[data-workspace-entry-note]");
      if (note) {
        note.textContent = "Workspace access controls are not available on this page yet.";
      }
    });
  });

  root.querySelectorAll("[data-use-demo-workspace]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) {
        return;
      }

      const originalLabel = button.textContent;
      const note = button.closest(".tg-card")?.querySelector("[data-workspace-entry-note]");
      button.disabled = true;
      button.textContent = "Starting demo…";

      try {
        await loginWithDemo();
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        button.textContent = originalLabel;
        if (note) {
          note.textContent = error.message;
        }
      }
    });
  });

  root.querySelectorAll("[data-start-checkout]").forEach((button) => {
    button.addEventListener("click", async () => {
      const planKey = button.getAttribute("data-start-checkout") || "pro";

      if (!state.session?.signedIn || !state.session?.workspace?.id) {
        const trigger = document.querySelector("[data-auth-open]");
        if (trigger) {
          trigger.click();
          return;
        }
        window.location.assign("/contact.html?intent=operator-buyer&product=TradeGraph&source=tradegraph-pricing");
        return;
      }

      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "Starting checkout…";

      try {
        const result = await startCheckout({
          planKey,
          billingEmail: state.session?.user?.email || "",
          successUrl: `${window.location.origin}${ROOT}/app/ops/billing.html?checkout=success`,
          cancelUrl: `${window.location.origin}${ROOT}/pricing.html?checkout=cancelled`,
        });

        if (result.checkoutUrl) {
          window.location.assign(result.checkoutUrl);
          return;
        }

        if (result.mode === "contact_sales") {
          window.location.assign("/contact.html?intent=operator-buyer&product=TradeGraph&source=tradegraph-enterprise");
          return;
        }

        state.billing = await loadBilling(true).catch(() => state.billing);
        renderPage();
      } catch (error) {
        button.disabled = false;
        button.textContent = originalLabel;
        const note = button.closest(".tg-card")?.querySelector(".tg-note");
        if (note) {
          note.textContent = error.message;
        }
      }
    });
  });

  trackTradeGraphEvent("tradegraph_page_viewed", { page: pageKey });
}

function mountProductModule(productKey, rootNode) {
  if (!rootNode) {
    return;
  }

  if (productKey === "verifysme") {
    mountVerifySME(rootNode);
    return;
  }

  if (productKey === "tenderradar") {
    mountTenderRadar(rootNode);
    return;
  }

  if (productKey === "exportpulse") {
    mountExportPulse(rootNode);
  }
}

const root = document.querySelector(ROOT_SELECTORS.join(", "));
const state = {
  session: null,
  sources: null,
  runtime: null,
  billing: null,
  alerts: null,
  analytics: null,
  audit: null,
  profileId: localRead(SUITE_PROFILE_KEY, suiteProfiles[0].id),
};

async function initTradeGraph() {
  if (!root) {
    return;
  }

  state.session = await loadSession().catch(() => null);
  const [sources, runtime, billing, alerts, analytics, verifyAudit, tenderAudit, exportAudit] = await Promise.all([
    loadSources().catch(() => null),
    loadRuntime().catch(() => null),
    loadBilling().catch(() => null),
    loadAlerts().catch(() => null),
    loadAnalyticsSummary().catch(() => null),
    readPersistentState("verifysme.workspace", {}).catch(() => ({})),
    readPersistentState("tenderradar.workspace", {}).catch(() => ({})),
    readPersistentState("exportpulse.workspace", {}).catch(() => ({})),
  ]);

  state.sources = sources;
  state.runtime = runtime;
  state.billing = billing;
  state.alerts = alerts;
  state.analytics = analytics;
  state.audit = {
    verify: verifyAudit,
    tender: tenderAudit,
    export: exportAudit,
  };

  renderPage();
}

initTradeGraph().catch((error) => {
  if (root) {
    root.innerHTML = `
      <div class="tg-shell">
        <main class="tg-main">
          <section class="tg-section">
            <p class="tg-eyebrow">TradeGraph</p>
            <h1>Could not load the product shell.</h1>
            <p class="tg-note">${escapeHtml(error.message)}</p>
            <a class="tg-cta tg-cta--accent" href="${ROOT}/index.html">Back to suite</a>
          </section>
        </main>
      </div>
    `;
  }
});
