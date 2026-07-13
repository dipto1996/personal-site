import {
  createUdyamChallenge,
  getSessionSnapshot,
  loadInsights,
  loadSession,
  loadSources,
  onSessionChange,
  parseMcaFindCinResults,
  parseMcaMasterData,
  parseUdyamImportedRecord,
  readPersistentState,
  syncSources,
  verifyUdyamRegistration,
  writePersistentState,
} from "../../lib/workspace-client.js";
import { buildRadarView } from "../../lib/tenderradar.js";
import { suiteProfiles } from "../../lib/companygraph.js";
import { exportOpportunities, exportProfiles } from "../exportpulse/data/catalog.js";
import { tenderOpportunities, tenderProfiles } from "../tenderradar/data/catalog.js";
import { trackTradeGraphEvent } from "../tradegraph/lib/analytics.js";
import { buildExportPulseUrl, buildTenderRadarUrl, buildVerifySMEUrl } from "../tradegraph/lib/routing.js";
import { renderVerifyInsights } from "../tradegraph/ui/insights.js";

const STORAGE_KEYS = {
  shortlist: "verifysme.shortlist",
  analytics: "verifysme.analytics",
  workflow: "verifysme.workflow",
  cases: "verifysme.cases",
  suppliers: "verifysme.suppliers",
};
const STATE_NAMESPACE = "verifysme.workspace";
const STATE_VERSION = 2;

const SUPPLIER_WORKFLOW_STAGES = [
  "New candidate",
  "Diligence",
  "Sample check",
  "Commercial review",
];
const DILIGENCE_OWNERS = ["Founder", "Procurement lead", "Quality lead", "Commercial lead"];
const CASE_APPROVAL_STATES = ["Pending sign-off", "Approved to sample", "Approved for RFQ", "Rejected"];

export const presetBriefs = [
  {
    id: "food-packaging",
    title: "Food-safe packaging vendor",
    description: "Shortlist low-risk suppliers with export-ready packaging capability.",
    sector: "Packaging",
    state: "",
    lowRiskOnly: true,
    exportReadyOnly: true,
    tenderReadyOnly: false,
    keyword: "food packaging",
  },
  {
    id: "private-label-wellness",
    title: "Private-label wellness manufacturer",
    description: "Find contract manufacturers with compliance hygiene and brochure depth.",
    sector: "Wellness",
    state: "",
    lowRiskOnly: false,
    exportReadyOnly: false,
    tenderReadyOnly: false,
    keyword: "contract manufacturer wellness",
  },
  {
    id: "industrial-fabrication",
    title: "Industrial fabrication partner",
    description: "Prioritize tender-compatible industrial suppliers with higher readiness.",
    sector: "Industrial",
    state: "",
    lowRiskOnly: false,
    exportReadyOnly: false,
    tenderReadyOnly: true,
    keyword: "industrial fabrication",
  },
  {
    id: "export-ready-apparel",
    title: "Export-ready apparel partner",
    description: "Focus on apparel manufacturers with DGFT and overseas shipment readiness.",
    sector: "Apparel",
    state: "",
    lowRiskOnly: true,
    exportReadyOnly: true,
    tenderReadyOnly: false,
    keyword: "apparel exporter",
  },
];

export const supplierProfiles = [
  {
    id: "atlas-flex-packaging",
    name: "Atlas Flex Packaging",
    sector: "Packaging",
    state: "Gujarat",
    city: "Ahmedabad",
    tags: ["food packaging", "laminates", "pouches", "export"],
    summary:
      "Flexible packaging supplier with food-safe laminates, export documents in place, and a strong evidence footprint.",
    trustScore: 92,
    exportReadiness: 84,
    tenderFit: 74,
    evidenceScore: 88,
    riskBand: "Low",
    dataConfidence: "High",
    udyamStatus: "Verified",
    iecStatus: "Active",
    gemStatus: "Supplier footprint",
    companyStatus: "Private limited",
    capacityBand: "Mid-scale",
    moq: "25,000 units",
    leadTime: "21-28 days",
    certifications: ["Udyam", "GST", "IEC", "ISO 22000", "BRCGS"],
    exportMarkets: ["UAE", "Kenya", "Saudi Arabia"],
    tenderNotes: "Strong fit for packaging and FMCG consumable bids up to mid-size lots.",
    evidence: [
      "MCA entity record",
      "Udyam registration",
      "DGFT IEC status",
      "Public export catalog",
      "GeM seller presence",
      "Food-grade certification PDF",
    ],
    concerns: ["Single major manufacturing cluster", "Freight dependence on western corridor"],
    freshnessDays: 8,
  },
  {
    id: "northbay-paperworks",
    name: "Northbay Paperworks",
    sector: "Packaging",
    state: "Maharashtra",
    city: "Nashik",
    tags: ["corrugated", "paper", "fmcg", "retail"],
    summary:
      "Corrugated packaging supplier with broad domestic fit, strong tender profile, and moderate export readiness.",
    trustScore: 86,
    exportReadiness: 62,
    tenderFit: 82,
    evidenceScore: 81,
    riskBand: "Low",
    dataConfidence: "High",
    udyamStatus: "Verified",
    iecStatus: "Inactive",
    gemStatus: "Bid-capable",
    companyStatus: "LLP",
    capacityBand: "High-volume",
    moq: "10,000 cartons",
    leadTime: "12-18 days",
    certifications: ["Udyam", "GST", "ISO 9001"],
    exportMarkets: [],
    tenderNotes: "Better for domestic institutional supply than export packaging.",
    evidence: [
      "MCA LLP record",
      "Udyam registration",
      "GeM listing",
      "Plant brochure PDF",
      "Public buyer references",
    ],
    concerns: ["No active IEC visibility", "Export documentation not yet strong"],
    freshnessDays: 14,
  },
  {
    id: "saffron-wellness-labs",
    name: "Saffron Wellness Labs",
    sector: "Wellness",
    state: "Haryana",
    city: "Gurugram",
    tags: ["nutraceuticals", "private label", "wellness", "contract manufacturer"],
    summary:
      "Private-label wellness manufacturer with high export readiness and strong catalog depth for emerging brands.",
    trustScore: 89,
    exportReadiness: 91,
    tenderFit: 58,
    evidenceScore: 86,
    riskBand: "Low",
    dataConfidence: "High",
    udyamStatus: "Verified",
    iecStatus: "Active",
    gemStatus: "No public footprint",
    companyStatus: "Private limited",
    capacityBand: "Mid-scale",
    moq: "5,000 units",
    leadTime: "28-35 days",
    certifications: ["Udyam", "GST", "IEC", "FSSAI", "ISO 22000"],
    exportMarkets: ["UAE", "Singapore"],
    tenderNotes: "Better for D2C and export than public-sector procurement.",
    evidence: [
      "MCA entity record",
      "Udyam registration",
      "DGFT IEC status",
      "FSSAI references",
      "Product brochure",
      "Third-party manufacturing page",
    ],
    concerns: ["Tender footprint not visible", "Batch variability must be validated"],
    freshnessDays: 11,
  },
  {
    id: "eastern-vita-formulations",
    name: "Eastern Vita Formulations",
    sector: "Wellness",
    state: "West Bengal",
    city: "Kolkata",
    tags: ["ayurveda", "wellness", "consumer products"],
    summary:
      "Consumer wellness and ayurvedic formulation manufacturer with decent compliance signals and weaker export maturity.",
    trustScore: 74,
    exportReadiness: 49,
    tenderFit: 40,
    evidenceScore: 69,
    riskBand: "Elevated",
    dataConfidence: "Medium",
    udyamStatus: "Verified",
    iecStatus: "Not visible",
    gemStatus: "No public footprint",
    companyStatus: "Partnership",
    capacityBand: "Small-batch",
    moq: "2,500 units",
    leadTime: "30-45 days",
    certifications: ["Udyam", "GST", "AYUSH"],
    exportMarkets: [],
    tenderNotes: "Not a strong tender or export candidate yet.",
    evidence: [
      "Udyam registration",
      "AYUSH references",
      "Local trade directory profile",
      "Website catalog",
    ],
    concerns: ["Weak IEC signal", "Low evidence depth", "Limited published quality docs"],
    freshnessDays: 23,
  },
  {
    id: "forgegrid-industrial",
    name: "ForgeGrid Industrial",
    sector: "Industrial",
    state: "Tamil Nadu",
    city: "Coimbatore",
    tags: ["fabrication", "machining", "industrial", "tender"],
    summary:
      "Industrial fabrication supplier with strong machining capability, public procurement fit, and broad institutional relevance.",
    trustScore: 90,
    exportReadiness: 70,
    tenderFit: 93,
    evidenceScore: 90,
    riskBand: "Low",
    dataConfidence: "High",
    udyamStatus: "Verified",
    iecStatus: "Active",
    gemStatus: "Bid-capable",
    companyStatus: "Private limited",
    capacityBand: "High-volume",
    moq: "Project-based",
    leadTime: "18-30 days",
    certifications: ["Udyam", "GST", "IEC", "ISO 9001"],
    exportMarkets: ["UAE"],
    tenderNotes: "High fit for fabrication, engineering, and industrial consumable tenders.",
    evidence: [
      "MCA entity record",
      "Udyam registration",
      "DGFT IEC status",
      "GeM footprint",
      "Capability brochure PDF",
      "Case study page",
    ],
    concerns: ["Lead times expand under heavy order books"],
    freshnessDays: 6,
  },
  {
    id: "delta-process-tech",
    name: "Delta Process Tech",
    sector: "Industrial",
    state: "Maharashtra",
    city: "Pune",
    tags: ["process equipment", "engineering", "oem"],
    summary:
      "Process equipment supplier with strong engineering signals and medium evidence confidence due to uneven public documentation.",
    trustScore: 82,
    exportReadiness: 67,
    tenderFit: 86,
    evidenceScore: 76,
    riskBand: "Medium",
    dataConfidence: "Medium",
    udyamStatus: "Verified",
    iecStatus: "Active",
    gemStatus: "Bid-capable",
    companyStatus: "Private limited",
    capacityBand: "Project-based",
    moq: "Project-based",
    leadTime: "30-45 days",
    certifications: ["Udyam", "GST", "IEC", "ISO 9001"],
    exportMarkets: ["Bangladesh"],
    tenderNotes: "Strong for engineering and plant infrastructure bids.",
    evidence: [
      "MCA entity record",
      "Udyam registration",
      "DGFT IEC status",
      "GeM presence",
      "Engineering capability deck",
    ],
    concerns: ["Fewer published buyer references", "Documentation freshness mixed"],
    freshnessDays: 19,
  },
  {
    id: "shoreline-apparel-exim",
    name: "Shoreline Apparel Exim",
    sector: "Apparel",
    state: "Tamil Nadu",
    city: "Tiruppur",
    tags: ["apparel", "garments", "private label", "export"],
    summary:
      "Export-ready apparel manufacturer with strong overseas orientation and high documentation density.",
    trustScore: 91,
    exportReadiness: 95,
    tenderFit: 54,
    evidenceScore: 89,
    riskBand: "Low",
    dataConfidence: "High",
    udyamStatus: "Verified",
    iecStatus: "Active",
    gemStatus: "No public footprint",
    companyStatus: "Private limited",
    capacityBand: "High-volume",
    moq: "8,000 pieces",
    leadTime: "25-35 days",
    certifications: ["Udyam", "GST", "IEC", "SEDEX", "WRAP"],
    exportMarkets: ["UK", "Germany", "UAE"],
    tenderNotes: "Strong export partner, limited tender relevance.",
    evidence: [
      "MCA entity record",
      "Udyam registration",
      "DGFT IEC status",
      "Export catalog",
      "Compliance audit references",
      "Buyer-facing capability deck",
    ],
    concerns: ["MOQ higher for small founders"],
    freshnessDays: 5,
  },
  {
    id: "urbanloom-private-label",
    name: "UrbanLoom Private Label",
    sector: "Apparel",
    state: "Delhi NCR",
    city: "Noida",
    tags: ["streetwear", "private label", "small batch"],
    summary:
      "Small-batch private-label apparel partner with founder-friendly MOQs and weaker export depth.",
    trustScore: 77,
    exportReadiness: 52,
    tenderFit: 35,
    evidenceScore: 71,
    riskBand: "Medium",
    dataConfidence: "Medium",
    udyamStatus: "Verified",
    iecStatus: "Not visible",
    gemStatus: "No public footprint",
    companyStatus: "Proprietorship",
    capacityBand: "Small-batch",
    moq: "800 pieces",
    leadTime: "18-24 days",
    certifications: ["Udyam", "GST"],
    exportMarkets: [],
    tenderNotes: "Useful for founder brands, not institutional procurement.",
    evidence: ["Udyam registration", "Brand-facing website", "Lookbook PDF", "Client gallery"],
    concerns: ["Limited external certifications", "No active IEC evidence"],
    freshnessDays: 17,
  },
  {
    id: "harbor-electrotech",
    name: "Harbor Electrotech",
    sector: "Electronics",
    state: "Karnataka",
    city: "Bengaluru",
    tags: ["electronics", "assemblies", "components", "tender"],
    summary:
      "Electronics assembly and component vendor with strong institutional fit and moderate export readiness.",
    trustScore: 88,
    exportReadiness: 73,
    tenderFit: 89,
    evidenceScore: 84,
    riskBand: "Low",
    dataConfidence: "High",
    udyamStatus: "Verified",
    iecStatus: "Active",
    gemStatus: "Bid-capable",
    companyStatus: "Private limited",
    capacityBand: "Mid-scale",
    moq: "Project-based",
    leadTime: "20-32 days",
    certifications: ["Udyam", "GST", "IEC", "ISO 9001", "RoHS"],
    exportMarkets: ["UAE", "Sri Lanka"],
    tenderNotes: "Very strong for electronics and instrumentation procurement.",
    evidence: [
      "MCA entity record",
      "DGFT IEC status",
      "GeM footprint",
      "Capability brochure",
      "Compliance certification pages",
    ],
    concerns: ["Component price volatility"],
    freshnessDays: 9,
  },
  {
    id: "copperleaf-cosmetics",
    name: "Copperleaf Cosmetics Works",
    sector: "Beauty",
    state: "Himachal Pradesh",
    city: "Baddi",
    tags: ["beauty", "cosmetics", "private label", "export"],
    summary:
      "Cosmetics private-label manufacturer with decent export potential and medium confidence due to uneven evidence density.",
    trustScore: 81,
    exportReadiness: 78,
    tenderFit: 38,
    evidenceScore: 73,
    riskBand: "Medium",
    dataConfidence: "Medium",
    udyamStatus: "Verified",
    iecStatus: "Active",
    gemStatus: "No public footprint",
    companyStatus: "Private limited",
    capacityBand: "Mid-scale",
    moq: "3,000 units",
    leadTime: "25-40 days",
    certifications: ["Udyam", "GST", "IEC", "ISO 22716"],
    exportMarkets: ["Nepal", "UAE"],
    tenderNotes: "Mostly D2C/private label oriented.",
    evidence: [
      "MCA entity record",
      "Udyam registration",
      "DGFT IEC status",
      "Catalog PDF",
      "Manufacturing page",
    ],
    concerns: ["Fewer public buyer references", "No procurement signal"],
    freshnessDays: 21,
  },
  {
    id: "summit-auto-cast",
    name: "Summit Auto Cast",
    sector: "Industrial",
    state: "Punjab",
    city: "Ludhiana",
    tags: ["castings", "auto ancillary", "industrial", "export"],
    summary:
      "Auto ancillary and casting supplier with strong export signals and solid procurement fit for industrial components.",
    trustScore: 87,
    exportReadiness: 83,
    tenderFit: 80,
    evidenceScore: 82,
    riskBand: "Low",
    dataConfidence: "High",
    udyamStatus: "Verified",
    iecStatus: "Active",
    gemStatus: "Supplier footprint",
    companyStatus: "Private limited",
    capacityBand: "High-volume",
    moq: "Project-based",
    leadTime: "24-36 days",
    certifications: ["Udyam", "GST", "IEC", "ISO 9001", "IATF 16949"],
    exportMarkets: ["Germany", "Poland"],
    tenderNotes: "Strong for industrial component programs with longer buying cycles.",
    evidence: [
      "MCA entity record",
      "Udyam registration",
      "DGFT IEC status",
      "Supplier brochure",
      "GeM footprint",
      "Quality certification docs",
    ],
    concerns: ["Automotive concentration"],
    freshnessDays: 12,
  },
  {
    id: "monsoon-retail-distribution",
    name: "Monsoon Retail Distribution",
    sector: "Distribution",
    state: "Uttar Pradesh",
    city: "Noida",
    tags: ["distribution", "retail", "fmcg", "tender"],
    summary:
      "Distribution-led supplier profile with moderate tender relevance and a lower evidence moat than manufacturers.",
    trustScore: 72,
    exportReadiness: 35,
    tenderFit: 68,
    evidenceScore: 64,
    riskBand: "Elevated",
    dataConfidence: "Medium",
    udyamStatus: "Verified",
    iecStatus: "Not visible",
    gemStatus: "Bid-capable",
    companyStatus: "Proprietorship",
    capacityBand: "Network-based",
    moq: "PO-based",
    leadTime: "7-14 days",
    certifications: ["Udyam", "GST"],
    exportMarkets: [],
    tenderNotes: "Useful for regional distribution bids, weak for export and manufacturing diligence.",
    evidence: ["Udyam registration", "GST listing", "GeM presence", "Company profile page"],
    concerns: ["Not a manufacturer", "Thinner documentation", "No export layer"],
    freshnessDays: 28,
  },
];

const sectorOrder = ["Packaging", "Industrial", "Wellness", "Apparel", "Electronics", "Beauty", "Distribution"];
const stateOrder = ["Gujarat", "Maharashtra", "Tamil Nadu", "Haryana", "Karnataka", "West Bengal", "Delhi NCR", "Himachal Pradesh", "Punjab", "Uttar Pradesh"];

export function getVerifyViewFromPathname(pathname = "") {
  if (pathname.includes("/supplier-detail")) {
    return "detail";
  }

  if (pathname.includes("/comparisons")) {
    return "comparisons";
  }

  if (pathname.includes("/suppliers")) {
    return "suppliers";
  }

  return "queue";
}

function createSupplierId(name) {
  const base = String(name || "supplier")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return base || `supplier-${Date.now()}`;
}

export function createWorkspaceSupplier(input = {}) {
  const tags = String(input.tags || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    id: input.id || `workspace-${createSupplierId(input.name)}`,
    name: String(input.name || "New supplier").trim(),
    sector: input.sector || "Packaging",
    state: input.state || "Gujarat",
    city: String(input.city || "Unknown city").trim(),
    tags,
    summary:
      String(input.summary || "").trim()
      || "Manually added supplier awaiting official registry evidence and commercial validation.",
    trustScore: 58,
    exportReadiness: 34,
    tenderFit: 38,
    evidenceScore: 24,
    riskBand: "Medium",
    dataConfidence: "Low",
    udyamStatus: "Awaiting official check",
    iecStatus: "Not checked",
    gemStatus: "Unknown",
    companyStatus: "Unverified entity",
    capacityBand: "Unknown",
    moq: "To be confirmed",
    leadTime: "To be confirmed",
    certifications: [],
    exportMarkets: [],
    tenderNotes: "Run diligence before RFQ or sample discussion.",
    evidence: ["Manual supplier intake"],
    concerns: ["No official registry evidence bound yet"],
    freshnessDays: 0,
    officialEvidenceCount: 0,
    liveTenderMatches: [],
    liveRouteMatches: [],
  };
}

export function mergeSupplierCatalog(baseProfiles, workspaceProfiles) {
  const map = new Map();

  [...baseProfiles, ...(Array.isArray(workspaceProfiles) ? workspaceProfiles : [])].forEach((profile) => {
    if (!profile?.id) {
      return;
    }

    map.set(profile.id, {
      ...profile,
      tags: Array.isArray(profile.tags) ? profile.tags : [],
      certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
      exportMarkets: Array.isArray(profile.exportMarkets) ? profile.exportMarkets : [],
      evidence: Array.isArray(profile.evidence) ? profile.evidence : [],
      concerns: Array.isArray(profile.concerns) ? profile.concerns : [],
    });
  });

  return Array.from(map.values());
}

export function createDefaultDiligenceCase(supplierId, overrides = {}) {
  return {
    supplierId,
    stage: overrides.stage || SUPPLIER_WORKFLOW_STAGES[0],
    owner: overrides.owner || DILIGENCE_OWNERS[1],
    dueDate: overrides.dueDate || "",
    approval: overrides.approval || CASE_APPROVAL_STATES[0],
    blocker: overrides.blocker || "Need official registry evidence before commercial progression.",
    nextAction: overrides.nextAction || "Bind Udyam or MCA proof and complete supplier intro call.",
    internalNote: overrides.internalNote || "",
    sampleStatus: overrides.sampleStatus || "Not started",
    commercialStatus: overrides.commercialStatus || "Not started",
    evidence: {
      udyam: overrides.evidence?.udyam || null,
      mca: overrides.evidence?.mca || null,
    },
    auditLog: Array.isArray(overrides.auditLog) ? overrides.auditLog : [],
    lastUpdated: overrides.lastUpdated || new Date().toISOString(),
  };
}

function getSupplierCase(cases, supplierId, stage) {
  return {
    ...createDefaultDiligenceCase(supplierId, { stage }),
    ...(cases?.[supplierId] || {}),
    evidence: {
      udyam: cases?.[supplierId]?.evidence?.udyam || null,
      mca: cases?.[supplierId]?.evidence?.mca || null,
    },
  };
}

function appendCaseAudit(caseRecord, message) {
  const entry = `${new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} · ${message}`;

  return [...(caseRecord.auditLog || []), entry].slice(-8);
}

function updateSupplierCase(state, supplierId, updater) {
  const currentStage = state.workflow[supplierId] || SUPPLIER_WORKFLOW_STAGES[0];
  const currentCase = getSupplierCase(state.cases, supplierId, currentStage);
  const nextCase = updater(currentCase);

  state.cases = {
    ...state.cases,
    [supplierId]: {
      ...nextCase,
      stage: nextCase.stage || currentStage,
      lastUpdated: new Date().toISOString(),
    },
  };
  state.workflow = {
    ...state.workflow,
    [supplierId]: nextCase.stage || currentStage,
  };
  safeWrite(STORAGE_KEYS.workflow, state.workflow);
  safeWrite(STORAGE_KEYS.cases, state.cases);
}

function bindEvidenceToSupplierCase(state, supplierId, sourceKey, result) {
  updateSupplierCase(state, supplierId, (currentCase) => {
    const companyLabel =
      result.companyName
      || result.enterpriseName
      || result.legalName
      || result.ownerName
      || "Official evidence";

    return {
      ...currentCase,
      blocker:
        sourceKey === "udyam"
          ? currentCase.blocker.replace("Need official registry evidence before commercial progression.", "Complete MCA or commercial validation before sign-off.")
          : currentCase.blocker,
      nextAction:
        sourceKey === "mca"
          ? "Review directors / status, then decide sample or commercial progression."
          : "Review Udyam match, then run MCA or commercial validation.",
      evidence: {
        ...currentCase.evidence,
        [sourceKey]: {
          source: sourceKey.toUpperCase(),
          companyLabel,
          checkedAt: new Date().toISOString(),
          confidence: result.confidence || result.status || "Structured match",
          record: result,
        },
      },
      auditLog: appendCaseAudit(currentCase, `${sourceKey.toUpperCase()} evidence bound to ${companyLabel}.`),
    };
  });
}

function buildDiligenceMemo(profile, caseRecord) {
  const evidenceRows = [
    caseRecord.evidence?.udyam
      ? `- Udyam: ${caseRecord.evidence.udyam.companyLabel} (${caseRecord.evidence.udyam.confidence})`
      : "- Udyam: not bound yet",
    caseRecord.evidence?.mca
      ? `- MCA: ${caseRecord.evidence.mca.companyLabel} (${caseRecord.evidence.mca.confidence})`
      : "- MCA: not bound yet",
  ].join("\n");

  return `# ${profile.name} diligence memo

- Supplier: ${profile.name}
- Sector: ${profile.sector}
- Location: ${profile.city}, ${profile.state}
- Case owner: ${caseRecord.owner}
- Current stage: ${caseRecord.stage}
- Approval: ${caseRecord.approval}
- Due date: ${caseRecord.dueDate || "Not set"}
- Next action: ${caseRecord.nextAction}
- Blocker: ${caseRecord.blocker}

## Trust posture

- Composite score: ${profile.compositeScore}
- Trust score: ${profile.trustScore}
- Evidence score: ${profile.evidenceScore}
- Export readiness: ${profile.exportReadiness}
- Tender fit: ${profile.tenderFit}
- Data confidence: ${profile.dataConfidence}

## Official evidence
${evidenceRows}

## Operator note
${caseRecord.internalNote || "No internal note captured yet."}
`;
}

function safeRead(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
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

function renderRegistrySourceCards(payload) {
  const records = [
    getSourceRecord(payload, "udyam", "Udyam Registration"),
    getSourceRecord(payload, "mca", "MCA Master Data"),
    getSourceRecord(payload, "dgft", "DGFT Trade Notices"),
    getSourceRecord(payload, "gem", "GeM BidPlus"),
  ];

  return records
    .map((record) => {
      const latestItem = record.items?.[0];
      const latestLabel = latestItem?.title || latestItem?.bidNumber || latestItem?.department || record.evidence || "No live sample yet";
      const statusLabel = record.status === "live" ? `${record.itemCount} records` : record.status;

      return `
        <article class="auth-source-card tender-source-card">
          <span>${record.label}</span>
          <strong>${statusLabel}</strong>
          <p>${record.note}</p>
          <p class="verify-note">${latestLabel}</p>
          <p class="verify-note">Checked ${formatCheckedAt(record.checkedAt)}</p>
        </article>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderUdyamResult(result) {
  if (!result) {
    return `
      <div class="verify-empty-panel verify-empty-panel--compact">
        <p class="eyebrow">Official check</p>
        <h3>No live lookup yet</h3>
        <p>Load the government captcha, enter a Udyam number, and VerifySME will return the official portal response inside this workspace.</p>
      </div>
    `;
  }

  const toneClass =
    result.status === "verified" || result.status === "parsed"
      ? "verify-udyam-result--success"
      : result.status === "invalid_captcha"
        ? "verify-udyam-result--warning"
        : "verify-udyam-result--neutral";
  const detailGrid = Array.isArray(result.details) && result.details.length
    ? `
        <div class="verify-udyam-grid">
          ${result.details
            .map(
              (item) => `
                <article class="verify-udyam-kv">
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(item.value)}</strong>
                </article>
              `,
            )
            .join("")}
        </div>
      `
    : `<p class="verify-note">No structured details were returned for this lookup.</p>`;
  const links = Array.isArray(result.links) && result.links.length
    ? `
        <div class="verify-proof-grid">
          ${result.links
            .map(
              (item) => `
                <article class="verify-proof-card">
                  <span>${escapeHtml(item.label)}</span>
                  <a class="inline-link" href="${item.url}" target="_blank" rel="noreferrer">Open official link</a>
                </article>
              `,
            )
            .join("")}
        </div>
      `
    : "";

  return `
    <div class="verify-udyam-result ${toneClass}">
      <div class="verify-dossier-head">
        <div>
          <p class="verify-block-label">Official Udyam response</p>
          <h3>${escapeHtml(result.registrationNumber || "Lookup result")}</h3>
        </div>
        <div class="verify-score-pill">${escapeHtml(result.status.replace(/_/g, " "))}</div>
      </div>
      <p class="verify-note">${escapeHtml(result.message || "")}</p>
      ${detailGrid}
      ${links}
    </div>
  `;
}

function renderMcaResult(result) {
  if (!result) {
    return `
      <div class="verify-empty-panel verify-empty-panel--compact">
        <p class="eyebrow">Official MCA parse</p>
        <h3>No MCA record imported yet</h3>
        <p>Open the official MCA flow, complete the captcha, then paste the copied master-data page here. VerifySME will structure the result in this workspace.</p>
      </div>
    `;
  }

  const detailGrid = Array.isArray(result.details) && result.details.length
    ? `
        <div class="verify-udyam-grid">
          ${result.details
            .map(
              (item) => `
                <article class="verify-udyam-kv">
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(item.value)}</strong>
                </article>
              `,
            )
            .join("")}
        </div>
      `
    : "";
  const directors = Array.isArray(result.directors) && result.directors.length
    ? `
        <div class="verify-section-stack">
          <div class="verify-dossier-head">
            <div>
              <p class="verify-block-label">Directors / signatories</p>
              <h3>${result.directors.length} rows parsed</h3>
            </div>
          </div>
          <div class="verify-table-shell">
            <table class="verify-table">
              <thead>
                <tr>
                  <th>DIN / PAN</th>
                  <th>Name</th>
                  <th>Begin date</th>
                  <th>End date</th>
                  <th>Surrendered DIN</th>
                </tr>
              </thead>
              <tbody>
                ${result.directors
                  .map(
                    (row) => `
                      <tr>
                        <td>${escapeHtml(row.dinPan)}</td>
                        <td>${escapeHtml(row.name)}</td>
                        <td>${escapeHtml(row.beginDate)}</td>
                        <td>${escapeHtml(row.endDate)}</td>
                        <td>${escapeHtml(row.surrenderedDin)}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `
    : "";
  const charges = Array.isArray(result.charges) && result.charges.length
    ? `
        <div class="verify-section-stack">
          <div class="verify-dossier-head">
            <div>
              <p class="verify-block-label">Charges</p>
              <h3>${result.charges.length} rows parsed</h3>
            </div>
          </div>
          <div class="verify-table-shell">
            <table class="verify-table">
              <thead>
                <tr>
                  <th>Assets under charge</th>
                  <th>Charge amount</th>
                  <th>Created</th>
                  <th>Modified</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${result.charges
                  .map(
                    (row) => `
                      <tr>
                        <td>${escapeHtml(row.assetsUnderCharge)}</td>
                        <td>${escapeHtml(row.chargeAmount)}</td>
                        <td>${escapeHtml(row.createdOn)}</td>
                        <td>${escapeHtml(row.modifiedOn)}</td>
                        <td>${escapeHtml(row.status)}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `
    : "";
  const links = Array.isArray(result.links) && result.links.length
    ? `
        <div class="verify-proof-grid">
          ${result.links
            .map(
              (item) => `
                <article class="verify-proof-card">
                  <span>${escapeHtml(item.label)}</span>
                  <a class="inline-link" href="${item.url}" target="_blank" rel="noreferrer">Open official link</a>
                </article>
              `,
            )
            .join("")}
        </div>
      `
    : "";

  return `
    <div class="verify-udyam-result verify-udyam-result--success">
      <div class="verify-dossier-head">
        <div>
          <p class="verify-block-label">Official MCA record</p>
          <h3>${escapeHtml(result.companyName || result.cin || "Parsed MCA result")}</h3>
        </div>
        <div class="verify-score-pill">${escapeHtml(result.confidence)} confidence</div>
      </div>
      <p class="verify-note">${escapeHtml(result.message || "")}</p>
      <p class="verify-note">
        ${escapeHtml(result.cin || "No CIN captured")} · ${escapeHtml(result.companyStatus || "Status not captured")} · ${escapeHtml(result.matchedFieldCount || 0)} fields matched
      </p>
      ${links}
      ${detailGrid}
      ${directors}
      ${charges}
    </div>
  `;
}

function renderMcaFindCinResult(state) {
  if (!state.mca.findCinResult) {
    return `
      <div class="verify-empty-panel verify-empty-panel--compact">
        <p class="eyebrow">Find CIN parse</p>
        <h3>No candidate CINs imported yet</h3>
        <p>Paste the official MCA Find CIN results to shortlist the right legal entity before opening the master-data view.</p>
      </div>
    `;
  }

  const result = state.mca.findCinResult;
  const rows = Array.isArray(result.candidates) ? result.candidates : [];

  return `
    <div class="verify-udyam-result verify-udyam-result--success">
      <div class="verify-dossier-head">
        <div>
          <p class="verify-block-label">Official MCA Find CIN parse</p>
          <h3>${rows.length} candidate ${rows.length === 1 ? "entity" : "entities"}</h3>
        </div>
        <div class="verify-score-pill">${escapeHtml(String(result.candidateCount || rows.length))} rows</div>
      </div>
      <p class="verify-note">${escapeHtml(result.message || "")}</p>
      <div class="verify-table-shell">
        <table class="verify-table">
          <thead>
            <tr>
              <th>CIN</th>
              <th>Company name</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.cin)}</td>
                    <td>${escapeHtml(row.companyName)}</td>
                    <td>${escapeHtml(row.status || "Status not captured")}</td>
                    <td>
                      <button
                        type="button"
                        class="verify-inline-button"
                        data-select-mca-cin="${escapeHtml(row.cin)}"
                        data-select-mca-name="${escapeHtml(row.companyName)}"
                      >
                        Use this CIN
                      </button>
                    </td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderUdyamLookupCard(state) {
  const hasChallenge = Boolean(state.udyam.challenge?.token);
  const statusSource = getSourceRecord(state.sourcePayload, "udyam", "Udyam Registration");
  const isLivePortal = statusSource.status === "live";
  const challengeButtonLabel = state.udyam.loading
    ? "Loading official captcha…"
    : hasChallenge
      ? "Refresh captcha"
      : "Load official captcha";
  const verifyDisabled = !isLivePortal || !hasChallenge || !state.udyam.registrationNumber || !state.udyam.captcha || state.udyam.loading;
  const importDisabled = !state.session?.signedIn || !state.udyam.certificateText.trim() || state.udyam.loading;

  return `
    <div class="verify-rail-card verify-rail-card--udyam">
      <div class="verify-panel-head">
        <div>
          <p class="verify-block-label">Official Udyam lookup</p>
          <h3>Live verification + certificate import</h3>
        </div>
        <span>${statusSource.status === "live" ? "Live" : statusSource.status}</span>
      </div>
      <p class="verify-note">
        Use the official Government of India verify flow when it is available. If the portal is under maintenance or you already have the official certificate / QR result, import that evidence directly and keep the structured record inside this workspace.
      </p>
      <p class="verify-note">${escapeHtml(statusSource.note)}</p>
      <div class="verify-card-actions">
        <a class="verify-inline-button" href="https://udyamregistration.gov.in/Udyam_Verify.aspx" target="_blank" rel="noreferrer">Open official verify page</a>
        <a class="verify-inline-button" href="https://udyamregistration.gov.in/PrintUdyamApplication.aspx" target="_blank" rel="noreferrer">Open print certificate</a>
      </div>
      <div class="verify-udyam-form">
        ${
          isLivePortal
            ? `
              <label class="verify-field">
                <span>Udyam registration number</span>
                <input
                  type="text"
                  name="udyamRegistrationNumber"
                  value="${escapeHtml(state.udyam.registrationNumber)}"
                  placeholder="UDYAM-XX-00-0000000"
                  autocomplete="off"
                />
              </label>
              <div class="verify-card-actions">
                <button
                  type="button"
                  class="verify-inline-button"
                  data-load-udyam-challenge
                  ${state.session?.signedIn ? "" : "disabled"}
                >
                  ${challengeButtonLabel}
                </button>
              </div>
              ${
                hasChallenge
                  ? `
                    <div class="verify-udyam-challenge">
                      <img src="${state.udyam.challenge.captchaDataUrl}" alt="Official Udyam verification code" class="verify-udyam-captcha" />
                      <div class="verify-udyam-meta">
                        <strong>Case-sensitive government captcha</strong>
                        <span>Expires ${new Date(state.udyam.challenge.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                      </div>
                    </div>
                    <label class="verify-field">
                      <span>Verification code</span>
                      <input
                        type="text"
                        name="udyamCaptcha"
                        value="${escapeHtml(state.udyam.captcha)}"
                        placeholder="Enter the code shown above"
                        autocomplete="off"
                      />
                    </label>
                    <div class="verify-card-actions">
                      <button
                        type="button"
                        class="verify-inline-button verify-inline-button--saved"
                        data-submit-udyam-verify
                        ${verifyDisabled ? "disabled" : ""}
                      >
                        ${state.udyam.loading ? "Verifying…" : "Verify with official portal"}
                      </button>
                    </div>
                  `
                  : `
                    <div class="verify-empty-panel verify-empty-panel--compact">
                      <p class="verify-note">Load the official captcha to start a live Udyam lookup.</p>
                    </div>
                  `
              }
            `
            : `
              <div class="verify-empty-panel verify-empty-panel--compact">
                <p class="verify-note">The live portal is not available from this environment right now. Use the official certificate or QR-result import below.</p>
              </div>
            `
        }
        <label class="verify-field">
          <span>Paste official Udyam certificate or QR-result text / HTML</span>
          <textarea
            name="udyamCertificateText"
            rows="7"
            placeholder="Paste copied official Udyam certificate text, print page HTML, or QR verification page HTML here."
          >${escapeHtml(state.udyam.certificateText)}</textarea>
        </label>
        <div class="verify-card-actions">
          <button
            type="button"
            class="verify-inline-button verify-inline-button--saved"
            data-submit-udyam-import
            ${importDisabled ? "disabled" : ""}
          >
            ${state.udyam.loading ? "Parsing…" : "Import official Udyam record"}
          </button>
        </div>
        ${
          state.udyam.error
            ? `<p class="auth-error">${escapeHtml(state.udyam.error)}</p>`
            : ""
        }
        ${renderUdyamResult(state.udyam.result)}
      </div>
    </div>
  `;
}

function renderMcaLookupCard(state) {
  const statusSource = getSourceRecord(state.sourcePayload, "mca", "MCA Master Data");
  const findCinDisabled = !state.session?.signedIn || !state.mca.findCinText.trim() || state.mca.loading;
  const parseDisabled = !state.session?.signedIn || !state.mca.sourceText.trim() || state.mca.loading;
  const selectedCinSummary = state.mca.selectedCin
    ? `
        <div class="verify-empty-panel verify-empty-panel--compact">
          <p class="eyebrow">Selected legal entity</p>
          <h3>${escapeHtml(state.mca.selectedCompanyName || state.mca.selectedCin)}</h3>
          <p>${escapeHtml(state.mca.selectedCin)}</p>
        </div>
      `
    : "";

  return `
    <div class="verify-rail-card verify-rail-card--udyam">
      <div class="verify-panel-head">
        <div>
          <p class="verify-block-label">Official MCA workflow</p>
          <h3>Find CIN, then import master data</h3>
        </div>
        <span>${statusSource.status === "live" ? "Live" : statusSource.status}</span>
      </div>
      <p class="verify-note">
        MCA’s public pages are bot-protected. VerifySME keeps the government step in your browser: first copy the official Find CIN results to isolate the right entity, then open the official master-data page and paste that record here for full structuring.
      </p>
      <p class="verify-note">${escapeHtml(statusSource.note)}</p>
      <div class="verify-card-actions">
        <a class="verify-inline-button" href="https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do" target="_blank" rel="noreferrer">Open official master data</a>
        <a class="verify-inline-button" href="https://www.mca.gov.in/mcafoportal/findCIN.do" target="_blank" rel="noreferrer">Open Find CIN</a>
      </div>
      <label class="verify-field">
        <span>Paste copied MCA Find CIN result text or HTML</span>
        <textarea
          name="mcaFindCinText"
          rows="6"
          placeholder="Paste the copied official Find CIN results here to identify the correct CIN before opening master data."
        >${escapeHtml(state.mca.findCinText)}</textarea>
      </label>
      <div class="verify-card-actions">
        <button
          type="button"
          class="verify-inline-button"
          data-submit-mca-find-cin-parse
          ${findCinDisabled ? "disabled" : ""}
        >
          ${state.mca.loading ? "Parsing…" : "Parse Find CIN results"}
        </button>
      </div>
      ${renderMcaFindCinResult(state)}
      ${selectedCinSummary}
      <label class="verify-field">
        <span>Paste copied MCA master-data page text or HTML</span>
        <textarea
          name="mcaSourceText"
          rows="10"
          placeholder="Paste the copied MCA Company/LLP Master Data page here after completing the official captcha in your browser."
        >${escapeHtml(state.mca.sourceText)}</textarea>
      </label>
      <div class="verify-card-actions">
        <button
          type="button"
          class="verify-inline-button verify-inline-button--saved"
          data-submit-mca-parse
          ${parseDisabled ? "disabled" : ""}
        >
          ${state.mca.loading ? "Parsing…" : "Parse official MCA result"}
        </button>
      </div>
      ${
        state.mca.error
          ? `<p class="auth-error">${escapeHtml(state.mca.error)}</p>`
          : ""
      }
      ${renderMcaResult(state.mca.result)}
    </div>
  `;
}

export function getCompositeScore(profile) {
  const riskPenalty = profile.riskBand === "Low" ? 0 : profile.riskBand === "Medium" ? -8 : -16;
  return Math.round(
    profile.trustScore * 0.42 +
      profile.exportReadiness * 0.2 +
      profile.tenderFit * 0.2 +
      profile.evidenceScore * 0.18 +
      riskPenalty,
  );
}

export function buildFiltersFromPreset(presetId) {
  const preset = presetBriefs.find((item) => item.id === presetId);
  return preset
    ? {
        searchTerm: preset.keyword,
        sector: preset.sector,
        state: preset.state,
        lowRiskOnly: preset.lowRiskOnly,
        exportReadyOnly: preset.exportReadyOnly,
        tenderReadyOnly: preset.tenderReadyOnly,
      }
    : {
        searchTerm: "",
        sector: "",
        state: "",
        lowRiskOnly: false,
        exportReadyOnly: false,
        tenderReadyOnly: false,
      };
}

export function createDefaultFilters() {
  return {
    searchTerm: "",
    sector: "",
    state: "",
    lowRiskOnly: false,
    exportReadyOnly: false,
    tenderReadyOnly: false,
  };
}

function isSameFilterShape(left, right) {
  return (
    (left?.searchTerm || "") === (right?.searchTerm || "") &&
    (left?.sector || "") === (right?.sector || "") &&
    (left?.state || "") === (right?.state || "") &&
    Boolean(left?.lowRiskOnly) === Boolean(right?.lowRiskOnly) &&
    Boolean(left?.exportReadyOnly) === Boolean(right?.exportReadyOnly) &&
    Boolean(left?.tenderReadyOnly) === Boolean(right?.tenderReadyOnly)
  );
}

function isLegacyFoodPackagingDefault(filters) {
  return isSameFilterShape(filters, buildFiltersFromPreset("food-packaging"));
}

export function filterSuppliers(profiles, filters) {
  const term = filters.searchTerm.trim().toLowerCase();
  const searchTokens = term ? term.split(/\s+/).filter(Boolean) : [];
  const normalizeToken = (token) => token.replace(/(ers?|ing|ed|s)$/g, "");

  return profiles
    .filter((profile) => {
      if (filters.sector && profile.sector !== filters.sector) {
        return false;
      }

      if (filters.state && profile.state !== filters.state) {
        return false;
      }

      if (filters.lowRiskOnly && profile.riskBand !== "Low") {
        return false;
      }

      if (filters.exportReadyOnly && profile.exportReadiness < 75) {
        return false;
      }

      if (filters.tenderReadyOnly && profile.tenderFit < 75) {
        return false;
      }

      if (!searchTokens.length) {
        return true;
      }

      const searchVector = [
        profile.name,
        profile.sector,
        profile.state,
        profile.city,
        profile.summary,
        ...profile.tags,
        ...profile.certifications,
        ...profile.exportMarkets,
      ]
        .join(" ")
        .toLowerCase();

      return searchTokens.every((token) => {
        const normalized = normalizeToken(token);
        return searchVector.includes(token) || (normalized && searchVector.includes(normalized));
      });
    })
    .map((profile) => ({ ...profile, compositeScore: getCompositeScore(profile) }))
    .sort((left, right) => right.compositeScore - left.compositeScore);
}

export function getKpis(filtered, shortlistIds) {
  const averageTrust = filtered.length
    ? Math.round(filtered.reduce((sum, item) => sum + item.trustScore, 0) / filtered.length)
    : 0;
  const exportReady = filtered.filter((item) => item.exportReadiness >= 75).length;
  const tenderReady = filtered.filter((item) => item.tenderFit >= 75).length;

  return {
    supplierCount: filtered.length,
    averageTrust,
    exportReady,
    tenderReady,
    shortlistCount: shortlistIds.length,
  };
}

export function getSectorSummary(filtered) {
  return sectorOrder
    .map((sector) => {
      const items = filtered.filter((item) => item.sector === sector);
      return {
        sector,
        count: items.length,
        average: items.length
          ? Math.round(items.reduce((sum, item) => sum + item.compositeScore, 0) / items.length)
          : 0,
      };
    })
    .filter((item) => item.count > 0);
}

export function getStateSummary(filtered) {
  return stateOrder
    .map((state) => ({
      state,
      count: filtered.filter((item) => item.state === state).length,
    }))
    .filter((item) => item.count > 0)
    .slice(0, 6);
}

export function getRiskSummary(filtered) {
  return [
    { label: "Low", count: filtered.filter((item) => item.riskBand === "Low").length },
    { label: "Medium", count: filtered.filter((item) => item.riskBand === "Medium").length },
    { label: "Elevated", count: filtered.filter((item) => item.riskBand === "Elevated").length },
  ];
}

export function buildShortlistExport(profiles) {
  const rows = [
    ["Supplier", "Sector", "State", "Trust", "Export readiness", "Tender fit", "Risk", "Confidence"],
    ...profiles.map((profile) => [
      profile.name,
      profile.sector,
      profile.state,
      String(profile.trustScore),
      String(profile.exportReadiness),
      String(profile.tenderFit),
      profile.riskBand,
      profile.dataConfidence,
    ]),
  ];

  return rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
}

export function getTelemetry(events, filtered) {
  const recent = events.slice(-6).reverse();
  const topPreset = presetBriefs
    .map((preset) => ({
      title: preset.title,
      count: events.filter((event) => event.name === "verifysme_preset_selected" && event.presetId === preset.id).length,
    }))
    .sort((left, right) => right.count - left.count)[0];

  return {
    recent,
    topPreset: topPreset && topPreset.count ? topPreset : { title: "No preset activity yet", count: 0 },
    staleProfiles: filtered.filter((item) => item.freshnessDays > 20).length,
  };
}

function createEvent(name, payload = {}) {
  return {
    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    timestamp: new Date().toISOString(),
    ...payload,
  };
}

function eventLabel(event) {
  const labels = {
    verifysme_viewed: "Workspace viewed",
    verifysme_preset_selected: "Preset selected",
    verifysme_filter_changed: "Filters changed",
    verifysme_supplier_opened: "Supplier opened",
    verifysme_shortlist_toggled: "Shortlist updated",
    verifysme_compare_opened: "Compare opened",
    verifysme_export_triggered: "Shortlist exported",
    verifysme_supplier_added: "Supplier added",
    verifysme_udyam_challenge_loaded: "Udyam captcha loaded",
    verifysme_udyam_verified: "Udyam verification run",
    verifysme_udyam_imported: "Udyam record imported",
    verifysme_mca_find_cin_parsed: "MCA Find CIN parsed",
    verifysme_mca_cin_selected: "MCA CIN selected",
    verifysme_mca_parsed: "MCA record parsed",
    verifysme_memo_exported: "Diligence memo exported",
  };

  return labels[event.name] || event.name;
}

function renderStat(label, value, help) {
  return `
    <article class="verify-stat-card">
      <p class="verify-stat-label">${label}</p>
      <strong>${value}</strong>
      <span>${help}</span>
    </article>
  `;
}

function renderBarChart(items, labelKey, valueKey, modifier = "") {
  const max = Math.max(...items.map((item) => item[valueKey]), 1);

  return items
    .map(
      (item) => `
        <div class="verify-bar-row ${modifier}">
          <div class="verify-bar-copy">
            <span>${item[labelKey]}</span>
            <strong>${item[valueKey]}</strong>
          </div>
          <div class="verify-bar-track">
            <span style="width:${Math.max((item[valueKey] / max) * 100, item[valueKey] ? 18 : 0)}%"></span>
          </div>
        </div>
      `,
    )
    .join("");
}

function getWorkflowStage(profileId, workflowMap) {
  return workflowMap[profileId] || SUPPLIER_WORKFLOW_STAGES[0];
}

function buildWorkflowSummary(shortlistProfiles, workflowMap) {
  const counts = SUPPLIER_WORKFLOW_STAGES.reduce(
    (accumulator, stage) => ({ ...accumulator, [stage]: 0 }),
    {},
  );

  shortlistProfiles.forEach((profile) => {
    counts[getWorkflowStage(profile.id, workflowMap)] += 1;
  });

  return counts;
}

function buildEvidenceArtifacts(profile) {
  if (Array.isArray(profile.evidenceArtifacts) && profile.evidenceArtifacts.length) {
    return profile.evidenceArtifacts;
  }

  const officialConfidence = profile.dataConfidence === "High" ? "High confidence" : "Medium confidence";

  return [
    {
      source: "MCA",
      artifact: `${profile.name} legal entity and status record`,
      checked: `${profile.freshnessDays} days ago`,
      confidence: officialConfidence,
      url: "https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html",
    },
    {
      source: "Udyam",
      artifact: `${profile.name} MSME / registration presence`,
      checked: `${Math.max(profile.freshnessDays - 2, 1)} days ago`,
      confidence: "Registry match",
      url: "https://udyamregistration.gov.in/",
    },
    {
      source: profile.iecStatus === "Active" ? "DGFT" : "GeM",
      artifact:
        profile.iecStatus === "Active"
          ? `${profile.name} IEC and trade-readiness trace`
          : `${profile.name} public seller footprint and demand trace`,
      checked: `${Math.max(profile.freshnessDays - 1, 1)} days ago`,
      confidence: profile.iecStatus === "Active" ? "Trade status visible" : "Commercial activity visible",
      url:
        profile.iecStatus === "Active"
          ? "https://www.dgft.gov.in/CP/?opt=view-any-ice"
          : "https://gem.gov.in/",
    },
    {
      source: "Commercial artifacts",
      artifact: `${profile.certifications[profile.certifications.length - 1]} / capability document on file`,
      checked: `${Math.max(profile.freshnessDays - 3, 1)} days ago`,
      confidence: `${profile.evidence.length} total evidence points`,
      url: "",
    },
  ];
}

function getSupplierDecision(profile) {
  if (profile.riskBand === "Low" && profile.trustScore >= 88 && profile.evidenceScore >= 82) {
    return {
      label: "Engage now",
      tone: "strong",
      summary: "The public evidence stack is strong enough to justify direct commercial outreach.",
      buyerMemo: "Good first-call candidate for commercial qualification and sample discussion.",
    };
  }

  if (profile.riskBand === "Medium" || profile.evidenceScore < 78 || profile.dataConfidence !== "High") {
    return {
      label: "Validate before outreach",
      tone: "caution",
      summary: "The supplier looks commercially interesting, but the evidence stack still needs verification.",
      buyerMemo: "Good candidate for a validation call, plant proof request, or reference check before commitment.",
    };
  }

  return {
    label: "Monitor only",
    tone: "watch",
    summary: "Keep this profile in reserve until stronger evidence or fresher documentation is visible.",
    buyerMemo: "Use as backup coverage, not as a first-priority partner.",
  };
}

function buildEvidenceLadder(profile) {
  if (Array.isArray(profile.evidenceLadder) && profile.evidenceLadder.length) {
    return profile.evidenceLadder;
  }

  return [
    { label: "Business identity", value: `${profile.companyStatus} · ${profile.udyamStatus}` },
    { label: "Export identity", value: profile.iecStatus },
    { label: "Public procurement footprint", value: profile.gemStatus },
    { label: "Evidence depth", value: `${profile.evidence.length} visible public artifacts` },
    { label: "Refresh freshness", value: `${profile.freshnessDays} days` },
  ];
}

function getRecommendedWorkflows(profile) {
  return {
    tender:
      profile.tenderFit >= 75
        ? "This supplier is strong enough to flow directly into TenderRadar bid qualification."
        : "TenderRadar is possible later, but this supplier is not yet a top tender candidate.",
    export:
      profile.exportReadiness >= 75
        ? "ExportPulse should be the next screen if you want a market-entry conversation."
        : "ExportPulse is useful here mainly to surface which documents or markets still block readiness.",
  };
}

function getLinkedSuiteProfile(supplierId) {
  return suiteProfiles.find((item) => item.supplierId === supplierId) || null;
}

function getMatchingTenderLinks(profile) {
  if (Array.isArray(profile.liveTenderMatches) && profile.liveTenderMatches.length) {
    return profile.liveTenderMatches.slice(0, 3).map((item) => ({
      label: item.title,
      href: buildTenderRadarUrl("detail", {
        tenderId: item.id,
      }),
    }));
  }

  const suite = getLinkedSuiteProfile(profile.id);

  if (suite) {
    const tenderProfile = tenderProfiles.find((item) => item.id === suite.tenderProfileId);

    if (tenderProfile) {
      return buildRadarView(tenderOpportunities, tenderProfile)
        .filter((item) => item.analysis.fitBand !== "Low fit")
        .slice(0, 3)
        .map((item) => ({
          label: item.title,
          href: buildTenderRadarUrl("detail", {
            profileId: tenderProfile.id,
            tenderId: item.id,
          }),
        }));
    }
  }

  return tenderOpportunities
    .filter(
      (item) =>
        item.sector.toLowerCase().includes(profile.sector.toLowerCase())
        || profile.tags.some((tag) => item.keywords.includes(tag)),
    )
    .slice(0, 3)
    .map((item) => ({
      label: item.title,
      href: buildTenderRadarUrl("detail", { tenderId: item.id }),
    }));
}

function getMatchingRouteLinks(profile) {
  if (Array.isArray(profile.liveRouteMatches) && profile.liveRouteMatches.length) {
    return profile.liveRouteMatches.slice(0, 3).map((item) => ({
      label: item.routeTitle || `${item.market}`,
      href: buildExportPulseUrl("detail", {
        routeId: item.id,
      }),
    }));
  }

  const suite = getLinkedSuiteProfile(profile.id);

  if (suite) {
    const exportProfile = exportProfiles.find((item) => item.id === suite.exportProfileId);

    if (exportProfile) {
      return exportOpportunities
        .filter((item) => item.matchSupplierIds.includes(profile.id))
        .slice(0, 3)
        .map((item) => ({
          label: `${item.market} · ${item.channelModel}`,
          href: buildExportPulseUrl("detail", {
            profileId: exportProfile.id,
            routeId: item.id,
          }),
        }));
    }
  }

  return exportOpportunities
    .filter(
      (item) =>
        item.matchSupplierIds.includes(profile.id)
        || item.sector.toLowerCase() === profile.sector.toLowerCase(),
    )
    .slice(0, 3)
    .map((item) => ({
      label: `${item.market} · ${item.channelModel}`,
      href: buildExportPulseUrl("detail", { routeId: item.id }),
    }));
}

function renderSupplierCard(profile, activeId, shortlistIds, workflowMap) {
  const activeClass = profile.id === activeId ? "verify-supplier-card--active" : "";
  const saved = shortlistIds.includes(profile.id);
  const workflowStage = getWorkflowStage(profile.id, workflowMap);

  return `
    <article class="verify-supplier-card ${activeClass}" data-supplier-card data-supplier-id="${profile.id}">
      <div class="verify-supplier-head">
        <div>
          <p class="verify-supplier-sector">${profile.sector}</p>
          <h3>${profile.name}</h3>
          <p class="verify-supplier-meta">${profile.city}, ${profile.state}</p>
        </div>
        <div class="verify-supplier-score-stack">
          <span class="verify-stage-pill">${workflowStage}</span>
          <div class="verify-score-pill">${profile.compositeScore}</div>
        </div>
      </div>
      <p class="verify-supplier-summary">${profile.summary}</p>
      <div class="verify-pill-row">
        <span class="verify-pill">${profile.riskBand} risk</span>
        <span class="verify-pill">${profile.dataConfidence} confidence</span>
        <span class="verify-pill">${profile.capacityBand}</span>
        <span class="verify-pill">${profile.officialEvidenceCount || 0} official proofs</span>
        <span class="verify-pill">${profile.liveTenderMatches?.length || 0} tenders</span>
        <span class="verify-pill">${profile.liveRouteMatches?.length || 0} routes</span>
        <span class="verify-pill">${profile.freshnessDays}d fresh</span>
      </div>
      <div class="verify-mini-metrics">
        <div><span>Trust</span><strong>${profile.trustScore}</strong></div>
        <div><span>Export</span><strong>${profile.exportReadiness}</strong></div>
        <div><span>Tender</span><strong>${profile.tenderFit}</strong></div>
      </div>
      <div class="verify-card-actions">
        <button class="verify-inline-button" data-open-supplier data-supplier-id="${profile.id}">Open dossier</button>
        <button class="verify-inline-button ${saved ? "verify-inline-button--saved" : ""}" data-toggle-shortlist data-supplier-id="${profile.id}">
          ${saved ? "Saved" : "Save"}
        </button>
      </div>
    </article>
  `;
}

function renderDossier(profile, workflowMap) {
  if (!profile) {
    return `
      <div class="verify-empty-panel">
        <p class="eyebrow">Dossier</p>
        <h3>Select a supplier</h3>
        <p>Open any supplier to inspect trust signals, export readiness, tender fit, and evidence depth.</p>
      </div>
    `;
  }

  const decision = getSupplierDecision(profile);
  const evidenceLadder = buildEvidenceLadder(profile);
  const workflows = getRecommendedWorkflows(profile);
  const workflowStage = getWorkflowStage(profile.id, workflowMap);
  const evidenceArtifacts = buildEvidenceArtifacts(profile);
  const tenderLinks = getMatchingTenderLinks(profile);
  const routeLinks = getMatchingRouteLinks(profile);

  return `
    <article class="verify-dossier">
      <div class="verify-dossier-head">
        <div>
          <p class="eyebrow">Supplier dossier</p>
          <h3>${profile.name}</h3>
          <p>${profile.city}, ${profile.state} · ${profile.companyStatus} · ${profile.capacityBand}</p>
        </div>
        <div class="verify-dossier-score">
          <span>${workflowStage}</span>
          <strong>${profile.compositeScore}</strong>
        </div>
      </div>
      <div class="verify-decision-banner verify-decision-banner--${decision.tone}">
        <div>
          <p class="verify-block-label">Recommended action</p>
          <strong>${decision.label}</strong>
          <p>${decision.summary}</p>
        </div>
        <div class="verify-decision-meta">
          <div>
            <span>Buyer memo</span>
            <strong>${decision.buyerMemo}</strong>
          </div>
          <div>
            <span>Commercial posture</span>
            <strong>${profile.riskBand} risk · ${profile.dataConfidence} confidence</strong>
          </div>
        </div>
      </div>
      <div class="verify-dossier-grid">
        <div class="verify-dossier-block">
          <p class="verify-block-label">Trust and coverage</p>
          <ul>
            <li>Trust score: <strong>${profile.trustScore}</strong></li>
            <li>Evidence score: <strong>${profile.evidenceScore}</strong></li>
            <li>Freshness: <strong>${profile.freshnessDays} days</strong></li>
            <li>Confidence: <strong>${profile.dataConfidence}</strong></li>
          </ul>
        </div>
        <div class="verify-dossier-block">
          <p class="verify-block-label">Operational fit</p>
          <ul>
            <li>MOQ: <strong>${profile.moq}</strong></li>
            <li>Lead time: <strong>${profile.leadTime}</strong></li>
            <li>Risk band: <strong>${profile.riskBand}</strong></li>
            <li>Tender fit: <strong>${profile.tenderFit}</strong></li>
          </ul>
        </div>
      </div>
      <div class="verify-dossier-columns">
        <div>
          <p class="verify-block-label">Certifications and public signals</p>
          <div class="verify-pill-row">
            ${profile.certifications.map((item) => `<span class="verify-pill">${item}</span>`).join("")}
          </div>
          <p class="verify-block-label verify-block-label--push">Proof artifacts</p>
          <div class="verify-proof-grid">
            ${evidenceArtifacts
              .map(
                (item) => `
                  <article class="verify-proof-card">
                    <span>${item.source}</span>
                    <strong>${item.artifact}</strong>
                    <p>${item.checked} · ${item.confidence}</p>
                    ${
                      item.url
                        ? `<a class="inline-link" href="${item.url}" target="_blank" rel="noreferrer">View source</a>`
                        : `<span class="verify-proof-note">Artifact on file</span>`
                    }
                  </article>
                `,
              )
              .join("")}
          </div>
          <p class="verify-block-label verify-block-label--push">Evidence sources</p>
          <ul class="verify-source-list">
            ${profile.evidence.map((item) => `<li>${item}</li>`).join("")}
          </ul>
          <p class="verify-block-label verify-block-label--push">Evidence ladder</p>
          <ul class="verify-source-list">
            ${evidenceLadder.map((item) => `<li><strong>${item.label}:</strong> ${item.value}</li>`).join("")}
          </ul>
        </div>
        <div>
          <p class="verify-block-label">Export layer</p>
          <ul class="verify-source-list">
            <li>IEC status: ${profile.iecStatus}</li>
            <li>Export readiness: ${profile.exportReadiness}</li>
            <li>Markets: ${profile.exportMarkets.length ? profile.exportMarkets.join(", ") : "No public export markets yet"}</li>
          </ul>
          <p class="verify-block-label verify-block-label--push">Tender notes</p>
          <p class="verify-note">${profile.tenderNotes}</p>
          <p class="verify-block-label verify-block-label--push">Watch-outs</p>
          <ul class="verify-source-list">
            ${profile.concerns.map((item) => `<li>${item}</li>`).join("")}
          </ul>
          <p class="verify-block-label verify-block-label--push">Best next workflow</p>
          <ul class="verify-source-list">
            <li>${workflows.tender}</li>
            <li>${workflows.export}</li>
          </ul>
          <p class="verify-block-label verify-block-label--push">Connected decisions</p>
          <ul class="verify-source-list">
            ${
              tenderLinks.length
                ? tenderLinks.map((item) => `<li><a class="inline-link" href="${item.href}">${item.label}</a></li>`).join("")
                : "<li>No tender drill-through identified yet.</li>"
            }
            ${
              routeLinks.length
                ? routeLinks.map((item) => `<li><a class="inline-link" href="${item.href}">${item.label}</a></li>`).join("")
                : "<li>No export route drill-through identified yet.</li>"
            }
          </ul>
          <p class="verify-block-label verify-block-label--push">Move review stage</p>
          <div class="verify-workflow-actions">
            ${SUPPLIER_WORKFLOW_STAGES.map(
              (stage) => `
                <button
                  type="button"
                  class="verify-inline-button ${stage === workflowStage ? "verify-inline-button--saved" : ""}"
                  data-set-supplier-stage="${stage}"
                  data-supplier-id="${profile.id}"
                >
                  ${stage}
                </button>
              `,
            ).join("")}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderCompare(shortlistProfiles) {
  if (shortlistProfiles.length < 2) {
    return `
      <div class="verify-empty-panel verify-empty-panel--compare">
        <p class="eyebrow">Compare</p>
        <h3>Build a shortlist first</h3>
        <p>Save at least two suppliers to compare trust, export readiness, and tender fit side by side.</p>
      </div>
    `;
  }

  return `
    <div class="verify-compare-grid">
      ${shortlistProfiles
        .map(
          (profile) => `
            <article class="verify-compare-card">
              <p class="verify-supplier-sector">${profile.sector}</p>
              <h3>${profile.name}</h3>
              <p class="verify-supplier-meta">${profile.city}, ${profile.state}</p>
              <ul class="verify-source-list">
                <li>Composite: ${profile.compositeScore}</li>
                <li>Trust: ${profile.trustScore}</li>
                <li>Export readiness: ${profile.exportReadiness}</li>
                <li>Tender fit: ${profile.tenderFit}</li>
                <li>Risk: ${profile.riskBand}</li>
                <li>MOQ: ${profile.moq}</li>
              </ul>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDecisionDesk(telemetry, selected, shortlistProfiles, workflowMap) {
  const decision = selected ? getSupplierDecision(selected) : null;
  const evidenceLadder = selected ? buildEvidenceLadder(selected) : [];
  const workflowStage = selected ? getWorkflowStage(selected.id, workflowMap) : "No supplier selected";
  const workflowSummary = buildWorkflowSummary(shortlistProfiles, workflowMap);
  const topWorkflowStage = Object.entries(workflowSummary).sort((left, right) => right[1] - left[1])[0];
  const relatedFlow = selected ? getRecommendedWorkflows(selected) : null;

  return `
    <div class="verify-ops-grid">
      <article class="verify-ops-card">
        <p class="verify-block-label">Current recommendation</p>
        <strong>${decision ? decision.label : "Select a supplier"}</strong>
        <span>${decision ? decision.summary : "Open a supplier dossier to see the best next move."}</span>
      </article>
      <article class="verify-ops-card">
        <p class="verify-block-label">Source coverage</p>
        <strong>${selected ? `${selected.evidence.length} visible evidence points` : "No supplier selected"}</strong>
        <span>
          ${
            selected
              ? `${evidenceLadder.map((item) => item.label).slice(0, 3).join(", ")} checked ${selected.freshnessDays} days ago with ${selected.dataConfidence.toLowerCase()} confidence.`
              : "Select a supplier to see how much of the public diligence stack is actually visible."
          }
        </span>
      </article>
      <article class="verify-ops-card">
        <p class="verify-block-label">Review queue</p>
        <strong>${shortlistProfiles.length ? `${shortlistProfiles.length} suppliers in active review` : "No active review queue"}</strong>
        <span>
          ${
            shortlistProfiles.length
              ? `${topWorkflowStage[0]} is the heaviest queue stage right now. ${telemetry.staleProfiles} profiles in the current view are older than 20 days.`
              : "Save suppliers into the queue to compare them, assign review stages, and export a buyer brief."
          }
        </span>
      </article>
      <article class="verify-ops-card verify-ops-card--events">
        <p class="verify-block-label">Operator notes</p>
        <ul class="verify-event-list">
          <li>
            <strong>Active stage</strong>
            <span>${workflowStage}</span>
          </li>
          <li>
            <strong>Buyer memo</strong>
            <span>${decision ? decision.buyerMemo : "No supplier selected yet."}</span>
          </li>
          <li>
            <strong>Data quality watch</strong>
            <span>${telemetry.staleProfiles ? `${telemetry.staleProfiles} profiles in the current filtered set need a refresh review.` : "No stale profiles in the current filtered set."}</span>
          </li>
          <li>
            <strong>Next connected move</strong>
            <span>${relatedFlow ? relatedFlow.tender : "Select a supplier to unlock downstream workflows."}</span>
          </li>
        </ul>
      </article>
    </div>
  `;
}

function renderCaseSummaryCards(shortlistProfiles, cases, workflowMap) {
  if (!shortlistProfiles.length) {
    return `
      <div class="verify-empty-panel verify-empty-panel--compact">
        <p class="eyebrow">Queue</p>
        <h3>No active diligence queue yet</h3>
        <p>Save suppliers from the directory to start a real diligence queue with owners, due dates, and approval state.</p>
      </div>
    `;
  }

  return `
    <div class="tg-case-grid">
      ${shortlistProfiles
        .map((profile) => {
          const caseRecord = getSupplierCase(cases, profile.id, getWorkflowStage(profile.id, workflowMap));
          const evidenceCount = ["udyam", "mca"].filter((key) => caseRecord.evidence?.[key]).length;

          return `
            <article class="tg-case-card ${profile.riskBand === "Low" ? "tg-case-card--good" : profile.riskBand === "Elevated" ? "tg-case-card--alert" : ""}">
              <div class="tg-case-card-head">
                <div>
                  <span>${profile.sector}</span>
                  <strong>${profile.name}</strong>
                </div>
                <span class="verify-stage-pill">${caseRecord.stage}</span>
              </div>
              <p>${caseRecord.nextAction}</p>
              <ul class="tg-meta-list">
                <li><strong>Owner</strong><span>${caseRecord.owner}</span></li>
                <li><strong>Approval</strong><span>${caseRecord.approval}</span></li>
                <li><strong>Evidence</strong><span>${evidenceCount}/2 official traces</span></li>
                <li><strong>Due</strong><span>${caseRecord.dueDate || "Not set"}</span></li>
              </ul>
              <div class="verify-card-actions">
                <a class="verify-inline-button" href="${buildVerifySMEUrl("detail", { supplierId: profile.id })}">Open case</a>
                <button class="verify-inline-button" data-open-supplier data-supplier-id="${profile.id}">Focus</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCaseDesk(profile, caseRecord) {
  if (!profile) {
    return "";
  }

  const evidenceNotes = [
    caseRecord.evidence?.udyam
      ? `Udyam linked: ${caseRecord.evidence.udyam.companyLabel}`
      : "Udyam not linked yet",
    caseRecord.evidence?.mca
      ? `MCA linked: ${caseRecord.evidence.mca.companyLabel}`
      : "MCA not linked yet",
  ];

  return `
    <article class="tg-case-card tg-case-card--detail">
      <div class="tg-case-card-head">
        <div>
          <span>Diligence case</span>
          <strong>${profile.name}</strong>
        </div>
        <span class="verify-stage-pill">${caseRecord.stage}</span>
      </div>
      <div class="tg-case-form">
        <label class="verify-field">
          <span>Case owner</span>
          <select name="caseOwner">
            ${DILIGENCE_OWNERS.map((owner) => `<option value="${owner}" ${owner === caseRecord.owner ? "selected" : ""}>${owner}</option>`).join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>Due date</span>
          <input type="date" name="caseDueDate" value="${escapeHtml(caseRecord.dueDate)}" />
        </label>
        <label class="verify-field">
          <span>Approval state</span>
          <select name="caseApproval">
            ${CASE_APPROVAL_STATES.map((approval) => `<option value="${approval}" ${approval === caseRecord.approval ? "selected" : ""}>${approval}</option>`).join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>Sample status</span>
          <input type="text" name="caseSampleStatus" value="${escapeHtml(caseRecord.sampleStatus)}" placeholder="Pending, received, failed, approved" />
        </label>
        <label class="verify-field">
          <span>Commercial status</span>
          <input type="text" name="caseCommercialStatus" value="${escapeHtml(caseRecord.commercialStatus)}" placeholder="Intro call booked, pricing requested, RFQ sent" />
        </label>
        <label class="verify-field">
          <span>Primary blocker</span>
          <input type="text" name="caseBlocker" value="${escapeHtml(caseRecord.blocker)}" placeholder="What still blocks progression?" />
        </label>
        <label class="verify-field verify-field--full">
          <span>Next action</span>
          <input type="text" name="caseNextAction" value="${escapeHtml(caseRecord.nextAction)}" placeholder="What should the owner do next?" />
        </label>
        <label class="verify-field verify-field--full">
          <span>Internal note</span>
          <textarea name="caseInternalNote" rows="5" placeholder="Capture buyer guidance, caveats, or approval notes.">${escapeHtml(caseRecord.internalNote)}</textarea>
        </label>
      </div>
      <div class="tg-case-evidence">
        ${evidenceNotes.map((item) => `<span class="verify-pill">${escapeHtml(item)}</span>`).join("")}
      </div>
      <ul class="tg-meta-list">
        <li><strong>Updated</strong><span>${new Date(caseRecord.lastUpdated).toLocaleString()}</span></li>
        <li><strong>Supplier risk</strong><span>${profile.riskBand} · ${profile.dataConfidence} confidence</span></li>
      </ul>
      <div class="verify-card-actions">
        <button type="button" class="verify-inline-button verify-inline-button--saved" data-export-diligence-memo>Download diligence memo</button>
        <a class="verify-inline-button" href="${buildVerifySMEUrl("detail", { supplierId: profile.id })}">Copy deep link</a>
      </div>
      <div class="verify-proof-grid">
        ${(caseRecord.auditLog || []).length
          ? caseRecord.auditLog
              .slice()
              .reverse()
              .map(
                (entry) => `
                  <article class="verify-proof-card">
                    <span>Audit trail</span>
                    <strong>${escapeHtml(entry)}</strong>
                    <p>Persisted inside the workspace case record.</p>
                  </article>
                `,
              )
              .join("")
          : `
            <article class="verify-proof-card">
              <span>Audit trail</span>
              <strong>No case events yet</strong>
              <p>Official evidence imports and owner changes will show up here.</p>
            </article>
          `}
      </div>
    </article>
  `;
}

function renderSupplierIntakeForm(intakeState) {
  return `
    <article class="tg-case-card tg-case-card--detail">
      <div class="tg-case-card-head">
        <div>
          <span>Supplier intake</span>
          <strong>Add a new vendor to diligence</strong>
        </div>
      </div>
      <div class="tg-case-form">
        <label class="verify-field">
          <span>Supplier name</span>
          <input type="text" name="intakeName" value="${escapeHtml(intakeState.name)}" placeholder="Acme Pharma Packaging" />
        </label>
        <label class="verify-field">
          <span>Sector</span>
          <select name="intakeSector">
            ${sectorOrder.map((sector) => `<option value="${sector}" ${sector === intakeState.sector ? "selected" : ""}>${sector}</option>`).join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>State</span>
          <select name="intakeState">
            ${stateOrder.map((stateName) => `<option value="${stateName}" ${stateName === intakeState.state ? "selected" : ""}>${stateName}</option>`).join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>City</span>
          <input type="text" name="intakeCity" value="${escapeHtml(intakeState.city)}" placeholder="Ahmedabad" />
        </label>
        <label class="verify-field verify-field--full">
          <span>Tags</span>
          <input type="text" name="intakeTags" value="${escapeHtml(intakeState.tags)}" placeholder="fmcg, laminates, food-safe" />
        </label>
        <label class="verify-field verify-field--full">
          <span>Why this vendor matters</span>
          <textarea name="intakeSummary" rows="4" placeholder="What made this supplier worth adding to the diligence queue?">${escapeHtml(intakeState.summary)}</textarea>
        </label>
      </div>
      <div class="verify-card-actions">
        <button type="button" class="verify-inline-button verify-inline-button--saved" data-add-supplier>Save supplier to workspace</button>
      </div>
    </article>
  `;
}

function triggerDownload(filename, contents, mimeType = "text/csv;charset=utf-8") {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function mountVerifySME(root) {
  if (!root) {
    return;
  }

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const explicitFilterOverrides = {};
  const hasExplicitQueryParam = params.has("query");
  const hasExplicitSectorParam = params.has("sector");
  const hasExplicitStateParam = params.has("state");

  const initialShortlist = safeRead(STORAGE_KEYS.shortlist, []);
  const initialEvents = safeRead(STORAGE_KEYS.analytics, []);

  const state = {
    filters: createDefaultFilters(),
    shortlistIds: initialShortlist,
    analytics: initialEvents,
    workflow: safeRead(STORAGE_KEYS.workflow, {}),
    cases: safeRead(STORAGE_KEYS.cases, {}),
    workspaceSuppliers: safeRead(STORAGE_KEYS.suppliers, []),
    intake: {
      name: "",
      sector: sectorOrder[0],
      state: stateOrder[0],
      city: "",
      tags: "",
      summary: "",
    },
    selectedSupplierId: params.get("supplierId") || supplierProfiles[0].id,
    udyam: {
      registrationNumber: "",
      captcha: "",
      challenge: null,
      certificateText: "",
      result: null,
      error: "",
      loading: false,
    },
    mca: {
      findCinText: "",
      findCinResult: null,
      selectedCin: "",
      selectedCompanyName: "",
      sourceText: "",
      result: null,
      error: "",
      loading: false,
    },
    session: getSessionSnapshot(),
    sourcePayload: null,
    syncingSources: false,
    insightsPayload: null,
    insightsLoading: false,
    hydrated: false,
  };

  if (hasExplicitQueryParam) {
    explicitFilterOverrides.searchTerm = params.get("query") || "";
  }

  if (hasExplicitSectorParam) {
    explicitFilterOverrides.sector = params.get("sector") || "";
  }

  if (hasExplicitStateParam) {
    explicitFilterOverrides.state = params.get("state") || "";
  }

  function persistState() {
    if (!state.hydrated) {
      return;
    }

    const payload = {
      version: STATE_VERSION,
      filters: state.filters,
      shortlistIds: state.shortlistIds,
      analytics: state.analytics,
      workflow: state.workflow,
      cases: state.cases,
      workspaceSuppliers: state.workspaceSuppliers,
      selectedSupplierId: state.selectedSupplierId,
      udyam: {
        registrationNumber: state.udyam.registrationNumber,
        certificateText: state.udyam.certificateText,
        result: state.udyam.result,
      },
      mca: {
        findCinText: state.mca.findCinText,
        findCinResult: state.mca.findCinResult,
        selectedCin: state.mca.selectedCin,
        selectedCompanyName: state.mca.selectedCompanyName,
        sourceText: state.mca.sourceText,
        result: state.mca.result,
      },
    };

    writePersistentState(STATE_NAMESPACE, payload).catch(() => null);
  }

  function track(name, payload = {}) {
    const nextEvents = [...state.analytics, createEvent(name, payload)];
    state.analytics = nextEvents.slice(-60);
    safeWrite(STORAGE_KEYS.analytics, state.analytics);
    trackTradeGraphEvent(name, payload);
    persistState();
  }

  function updateShortlist(next) {
    state.shortlistIds = next;
    safeWrite(STORAGE_KEYS.shortlist, next);
    persistState();
  }

  function getAllSuppliers() {
    return mergeSupplierCatalog(supplierProfiles, state.workspaceSuppliers);
  }

  function getSelectedCase(profile) {
    if (!profile) {
      return null;
    }

    return getSupplierCase(state.cases, profile.id, getWorkflowStage(profile.id, state.workflow));
  }

  function updateUrlState() {
    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("supplierId", state.selectedSupplierId);

    if (state.filters.searchTerm) {
      nextUrl.searchParams.set("query", state.filters.searchTerm);
    } else {
      nextUrl.searchParams.delete("query");
    }

    if (state.filters.sector) {
      nextUrl.searchParams.set("sector", state.filters.sector);
    } else {
      nextUrl.searchParams.delete("sector");
    }

    if (state.filters.state) {
      nextUrl.searchParams.set("state", state.filters.state);
    } else {
      nextUrl.searchParams.delete("state");
    }

    window.history.replaceState({}, "", `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`.replace(/\?$/, ""));
  }

  function refreshInsights(force = false) {
    state.insightsLoading = true;

    return loadInsights(
      "verifysme",
      {
        profileId: state.selectedSupplierId,
        searchTerm: state.filters.searchTerm,
        sector: state.filters.sector,
        state: state.filters.state,
        lowRiskOnly: state.filters.lowRiskOnly,
        exportReadyOnly: state.filters.exportReadyOnly,
        tenderReadyOnly: state.filters.tenderReadyOnly,
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

  function render() {
    const activeView = getVerifyViewFromPathname(typeof window !== "undefined" ? window.location.pathname : "");
    const allSuppliers =
      Array.isArray(state.insightsPayload?.entities?.inventory) && state.insightsPayload.entities.inventory.length
        ? state.insightsPayload.entities.inventory
        : getAllSuppliers();
    const filtered =
      Array.isArray(state.insightsPayload?.entities?.visible)
        ? state.insightsPayload.entities.visible
        : filterSuppliers(allSuppliers, state.filters);
    const selectedFromAll = allSuppliers.find((item) => item.id === state.selectedSupplierId) || null;
    const selected =
      activeView === "detail"
        ? selectedFromAll || filtered[0] || null
        : filtered.find((item) => item.id === state.selectedSupplierId) || selectedFromAll || filtered[0] || null;

    if (selected) {
      state.selectedSupplierId = selected.id;
    }

    const shortlistProfiles = allSuppliers
      .filter((item) => state.shortlistIds.includes(item.id))
      .map((item) => ({ ...item, compositeScore: getCompositeScore(item) }))
      .sort((left, right) => right.compositeScore - left.compositeScore);
    const selectedCase = getSelectedCase(selected);

    const kpis = getKpis(filtered, state.shortlistIds);
    const sectorSummary = getSectorSummary(filtered);
    const stateSummary = getStateSummary(filtered);
    const riskSummary = getRiskSummary(filtered);
    const telemetry = getTelemetry(state.analytics, filtered);
    const selectedStage = selected ? getWorkflowStage(selected.id, state.workflow) : "No supplier selected";
    const workspaceName = state.session?.workspace?.name || "Local workspace";
    const registryCards = renderRegistrySourceCards(state.sourcePayload);
    const udyamLookupCard = renderUdyamLookupCard(state);
    const mcaLookupCard = renderMcaLookupCard(state);
    const suiteLinkage = selected ? getLinkedSuiteProfile(selected.id) : null;
    const tenderWorkspaceHref = suiteLinkage
      ? buildTenderRadarUrl("opportunities", { profileId: suiteLinkage.tenderProfileId })
      : buildTenderRadarUrl("opportunities");
    const exportWorkspaceHref = suiteLinkage
      ? buildExportPulseUrl("markets", { profileId: suiteLinkage.exportProfileId })
      : buildExportPulseUrl("markets");
    const insightMarkup = state.insightsLoading
      ? '<div class="tradegraph-insight-loading">Loading live VerifySME insights…</div>'
      : renderVerifyInsights(state.insightsPayload || {});

    updateUrlState();

    const filtersPanel = `
      <div class="verify-rail-card">
        <label class="verify-field">
          <span>Search by keyword</span>
          <input type="search" name="searchTerm" value="${state.filters.searchTerm}" placeholder="Try packaging, apparel exporter, industrial fabrication" />
        </label>
        <label class="verify-field">
          <span>Sector</span>
          <select name="sector">
            <option value="">All sectors</option>
            ${sectorOrder
              .map(
                (sector) => `<option value="${sector}" ${sector === state.filters.sector ? "selected" : ""}>${sector}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="verify-field">
          <span>State</span>
          <select name="state">
            <option value="">All states</option>
            ${stateOrder
              .map(
                (stateName) =>
                  `<option value="${stateName}" ${stateName === state.filters.state ? "selected" : ""}>${stateName}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="verify-toggle">
          <input type="checkbox" name="lowRiskOnly" ${state.filters.lowRiskOnly ? "checked" : ""} />
          <span>Low-risk only</span>
        </label>
        <label class="verify-toggle">
          <input type="checkbox" name="exportReadyOnly" ${state.filters.exportReadyOnly ? "checked" : ""} />
          <span>Export-ready only</span>
        </label>
        <label class="verify-toggle">
          <input type="checkbox" name="tenderReadyOnly" ${state.filters.tenderReadyOnly ? "checked" : ""} />
          <span>Tender-ready only</span>
        </label>
      </div>
      <div class="verify-rail-card">
        <p class="verify-block-label">Preset briefs</p>
        <div class="verify-preset-list">
          ${presetBriefs
            .map(
              (preset) => `
                <button class="verify-preset ${preset.keyword === state.filters.searchTerm && preset.sector === state.filters.sector ? "verify-preset--active" : ""}" data-preset-id="${preset.id}">
                  <strong>${preset.title}</strong>
                  <span>${preset.description}</span>
                </button>
              `,
            )
            .join("")}
        </div>
      </div>
    `;

    const supplierListMarkup = `
      <div class="verify-list-panel">
        <div class="verify-panel-head">
          <div>
            <p class="verify-block-label">Supplier graph</p>
            <h3>Ranked by composite fit</h3>
          </div>
          <button class="verify-inline-button" data-export-shortlist ${shortlistProfiles.length ? "" : "disabled"}>Export shortlist</button>
        </div>
        <div class="verify-supplier-list">
          ${
            filtered.length
              ? filtered
                  .map((profile) =>
                    renderSupplierCard(profile, state.selectedSupplierId, state.shortlistIds, state.workflow),
                  )
                  .join("")
              : `
                <div class="verify-empty-panel">
                  <p class="eyebrow">No results</p>
                  <h3>No suppliers match the current filters</h3>
                  <p>Try removing one of the readiness filters or starting from a preset brief.</p>
                </div>
              `
          }
        </div>
      </div>
    `;

    const queueViewMarkup = `
      <section class="verify-stat-grid">
        ${renderStat("Suppliers in view", kpis.supplierCount, "Filtered supplier pool in the active review slice")}
        ${renderStat("Avg trust", kpis.averageTrust, "Mean trust score in the current queue")}
        ${renderStat("Export-ready", kpis.exportReady, "Profiles ready for route planning")}
        ${renderStat("Tender-ready", kpis.tenderReady, "Profiles strong enough for bid qualification")}
        ${renderStat("Review queue", kpis.shortlistCount, "Suppliers moved into the active diligence queue")}
      </section>
      ${insightMarkup}
      <section class="verify-viz-grid">
        <article class="verify-viz-card">
          <div class="verify-viz-head">
            <div>
              <p class="verify-block-label">Sector signal mix</p>
              <h3>Where your strongest supply depth sits</h3>
            </div>
          </div>
          <div class="verify-chart-stack">${renderBarChart(sectorSummary, "sector", "average")}</div>
        </article>
        <article class="verify-viz-card">
          <div class="verify-viz-head">
            <div>
              <p class="verify-block-label">Geographic concentration</p>
              <h3>Top states in the filtered pool</h3>
            </div>
          </div>
          <div class="verify-chart-stack">${renderBarChart(stateSummary, "state", "count", "verify-bar-row--counts")}</div>
        </article>
        <article class="verify-viz-card">
          <div class="verify-viz-head">
            <div>
              <p class="verify-block-label">Risk composition</p>
              <h3>How clean the shortlist universe looks</h3>
            </div>
          </div>
          <div class="verify-chart-stack">${renderBarChart(riskSummary, "label", "count", "verify-bar-row--risk")}</div>
        </article>
      </section>
      <section class="verify-ops-panel">
        <div class="verify-panel-head">
          <div>
            <p class="verify-block-label">Diligence queue</p>
            <h3>Shortlisted suppliers with owner, approval, and evidence state</h3>
          </div>
          <div class="verify-card-actions">
            <a class="verify-inline-button" href="${buildVerifySMEUrl("suppliers", { supplierId: state.selectedSupplierId })}">Open supplier directory</a>
            <a class="verify-inline-button" href="${buildVerifySMEUrl("detail", { supplierId: state.selectedSupplierId })}">Open case detail</a>
          </div>
        </div>
        ${renderCaseSummaryCards(shortlistProfiles, state.cases, state.workflow)}
      </section>
      <section class="verify-workspace">
        <div class="verify-detail-panel">
          ${renderDossier(selected, state.workflow)}
        </div>
        <div class="verify-detail-panel">
          ${renderCaseDesk(selected, selectedCase)}
        </div>
      </section>
      <section class="verify-ops-panel">
        <div class="verify-panel-head">
          <div>
            <p class="verify-block-label">Commercial desk</p>
            <h3>Recommendation, source coverage, and review-stage pressure</h3>
          </div>
          <div class="verify-card-actions">
            <a class="verify-inline-button" href="${tenderWorkspaceHref}">Open TenderRadar</a>
            <a class="verify-inline-button" href="${exportWorkspaceHref}">Open ExportPulse</a>
          </div>
        </div>
        ${renderDecisionDesk(telemetry, selected, shortlistProfiles, state.workflow)}
      </section>
    `;

    const suppliersViewMarkup = `
      <section class="verify-stat-grid">
        ${renderStat("Suppliers in view", kpis.supplierCount, "Filtered supplier pool in the active review slice")}
        ${renderStat("Avg trust", kpis.averageTrust, "Mean trust score in the current queue")}
        ${renderStat("Review queue", kpis.shortlistCount, "Suppliers moved into the active diligence queue")}
        ${renderStat("Workspace suppliers", state.workspaceSuppliers.length, "Suppliers manually added by your team")}
      </section>
      <section class="verify-workspace">
        ${supplierListMarkup}
        <div class="verify-detail-panel">
          ${renderSupplierIntakeForm(state.intake)}
          ${renderDossier(selected, state.workflow)}
        </div>
      </section>
      <section class="verify-compare-panel">
        <div class="verify-panel-head">
          <div>
            <p class="verify-block-label">Shortlist compare</p>
            <h3>Side-by-side supplier fit</h3>
          </div>
          <button class="verify-inline-button" data-open-compare ${shortlistProfiles.length >= 2 ? "" : "disabled"}>Refresh compare</button>
        </div>
        ${renderCompare(shortlistProfiles)}
      </section>
    `;

    const comparisonsViewMarkup = `
      <section class="verify-stat-grid">
        ${renderStat("Shortlisted", shortlistProfiles.length, "Suppliers currently in the comparison set")}
        ${renderStat("Avg trust", shortlistProfiles.length ? Math.round(shortlistProfiles.reduce((sum, item) => sum + item.trustScore, 0) / shortlistProfiles.length) : 0, "Mean trust score across the saved shortlist")}
        ${renderStat("Export-ready", shortlistProfiles.filter((item) => item.exportReadiness >= 75).length, "Suppliers that can move into route planning now")}
        ${renderStat("Tender-ready", shortlistProfiles.filter((item) => item.tenderFit >= 75).length, "Suppliers strong enough for bid qualification")}
      </section>
      ${insightMarkup}
      <section class="verify-compare-panel">
        <div class="verify-panel-head">
          <div>
            <p class="verify-block-label">Comparison board</p>
            <h3>Side-by-side supplier fit with workflow context</h3>
          </div>
          <div class="verify-card-actions">
            <a class="verify-inline-button" href="${buildVerifySMEUrl("suppliers", { supplierId: state.selectedSupplierId })}">Open supplier stream</a>
            <a class="verify-inline-button" href="${selected ? buildVerifySMEUrl("detail", { supplierId: selected.id }) : buildVerifySMEUrl("queue")}">Open active case</a>
          </div>
        </div>
        ${renderCompare(shortlistProfiles)}
      </section>
      <section class="verify-workspace">
        <div class="verify-detail-panel">
          ${renderCaseSummaryCards(shortlistProfiles, state.cases, state.workflow)}
        </div>
        <div class="verify-detail-panel">
          ${renderDossier(selected, state.workflow)}
        </div>
      </section>
      <section class="verify-ops-panel">
        <div class="verify-panel-head">
          <div>
            <p class="verify-block-label">Cross-product handoff</p>
            <h3>Move the winning supplier into the next operating decision</h3>
          </div>
        </div>
        ${renderDecisionDesk(telemetry, selected, shortlistProfiles, state.workflow)}
      </section>
    `;

    const detailViewMarkup = `
      <section class="verify-stat-grid">
        ${renderStat("Current stage", selectedCase?.stage || "No supplier", "Where this diligence case currently sits")}
        ${renderStat("Approval", selectedCase?.approval || "No case", "Current procurement sign-off state")}
        ${renderStat("Official evidence", selectedCase ? ["udyam", "mca"].filter((key) => selectedCase.evidence?.[key]).length : 0, "Registry traces bound to this supplier")}
        ${renderStat("Due date", selectedCase?.dueDate || "Not set", "Target date for the next case checkpoint")}
      </section>
      <section class="verify-workspace">
        <div class="verify-detail-panel">
          ${renderDossier(selected, state.workflow)}
          ${renderCaseDesk(selected, selectedCase)}
        </div>
        <aside class="verify-rail">
          <div class="verify-rail-card">
            <p class="eyebrow">Case context</p>
            <h3>${selected ? selected.name : "No supplier selected"}</h3>
            <p>Use the official-source desk below to bind Udyam and MCA evidence directly to this supplier case, then progress sample and commercial review.</p>
          </div>
          <div class="verify-rail-card">
            <p class="verify-block-label">Registry adapters</p>
            <p class="verify-note">
              DGFT and GeM sync directly into this workspace. Udyam and MCA stay on the official government rails: run the live verify flow when available, or import copied official certificate / Find CIN / master-data output and keep the structured evidence here.
            </p>
            <div class="auth-source-grid">${registryCards}</div>
            <div class="verify-card-actions">
              <button
                type="button"
                class="verify-inline-button"
                data-sync-verify-sources
                ${state.session?.signedIn ? "" : "disabled"}
              >
                ${state.syncingSources ? "Refreshing…" : "Refresh adapters"}
              </button>
            </div>
          </div>
          ${udyamLookupCard}
          ${mcaLookupCard}
          <div class="verify-rail-card">
            <p class="verify-block-label">Connected workflows</p>
            <div class="verify-card-actions">
              <a class="verify-inline-button" href="${tenderWorkspaceHref}">Open TenderRadar</a>
              <a class="verify-inline-button" href="${exportWorkspaceHref}">Open ExportPulse</a>
              <a class="verify-inline-button" href="${buildVerifySMEUrl("suppliers", { supplierId: state.selectedSupplierId })}">Back to supplier list</a>
            </div>
          </div>
        </aside>
      </section>
    `;

    const railMarkup = activeView === "detail"
      ? ""
      : `
        <aside class="verify-rail">
          <div class="verify-rail-card">
            <p class="eyebrow">Active account</p>
            <h3>${workspaceName} sourcing desk</h3>
            <p>Search, verify, shortlist, and move suppliers through diligence, sample checks, and commercial review using visible evidence instead of raw directory pages.</p>
            <div class="verify-proof-grid">
              <article class="verify-proof-card">
                <span>Owner</span>
                <strong>Packaging + private-label sourcing team</strong>
                <p>Coverage across packaging, wellness, industrial, and apparel suppliers.</p>
              </article>
              <article class="verify-proof-card">
                <span>Current stage</span>
                <strong>${selectedStage}</strong>
                <p>${selected ? `${selected.name} is the active supplier under review.` : "Select a supplier to open the active review."}</p>
              </article>
            </div>
          </div>
          <div class="verify-rail-card">
            <p class="verify-block-label">Registry adapters</p>
            <p class="verify-note">
              DGFT and GeM sync directly into this workspace. Udyam and MCA stay on the official government rails: run the live verify flow when available, or import copied official certificate / Find CIN / master-data output and keep the structured evidence here.
            </p>
            <div class="auth-source-grid">${registryCards}</div>
            <div class="verify-card-actions">
              <button
                type="button"
                class="verify-inline-button"
                data-sync-verify-sources
                ${state.session?.signedIn ? "" : "disabled"}
              >
                ${state.syncingSources ? "Refreshing…" : "Refresh adapters"}
              </button>
            </div>
          </div>
          ${filtersPanel}
        </aside>
      `;

    const stageMarkup = activeView === "queue"
      ? queueViewMarkup
      : activeView === "suppliers"
        ? suppliersViewMarkup
        : activeView === "comparisons"
          ? comparisonsViewMarkup
          : detailViewMarkup;

    root.innerHTML = `
      <div class="verify-app-shell verify-app-shell--${activeView}">
        ${railMarkup}
        <div class="verify-stage">
          ${stageMarkup}
        </div>
      </div>
    `;
  }

  root.addEventListener("input", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement) && !(target instanceof HTMLTextAreaElement)) {
      return;
    }

    if (target instanceof HTMLInputElement && target.name === "udyamRegistrationNumber") {
      state.udyam.registrationNumber = target.value.toUpperCase();
      state.udyam.error = "";
      persistState();
      render();
      return;
    }

    if (target instanceof HTMLInputElement && target.name === "udyamCaptcha") {
      state.udyam.captcha = target.value.toUpperCase();
      state.udyam.error = "";
      persistState();
      render();
      return;
    }

    if (target instanceof HTMLTextAreaElement && target.name === "udyamCertificateText") {
      state.udyam.certificateText = target.value;
      state.udyam.error = "";
      persistState();
      render();
      return;
    }

    if (target instanceof HTMLTextAreaElement && target.name === "mcaFindCinText") {
      state.mca.findCinText = target.value;
      state.mca.error = "";
      persistState();
      render();
      return;
    }

    if (target instanceof HTMLTextAreaElement && target.name === "mcaSourceText") {
      state.mca.sourceText = target.value;
      state.mca.error = "";
      persistState();
      render();
      return;
    }

    if (target.name === "caseOwner" || target.name === "caseDueDate" || target.name === "caseApproval" || target.name === "caseBlocker" || target.name === "caseNextAction" || target.name === "caseInternalNote" || target.name === "caseSampleStatus" || target.name === "caseCommercialStatus") {
      if (!state.selectedSupplierId) {
        return;
      }

      updateSupplierCase(state, state.selectedSupplierId, (currentCase) => ({
        ...currentCase,
        owner: target.name === "caseOwner" ? target.value : currentCase.owner,
        dueDate: target.name === "caseDueDate" ? target.value : currentCase.dueDate,
        approval: target.name === "caseApproval" ? target.value : currentCase.approval,
        blocker: target.name === "caseBlocker" ? target.value : currentCase.blocker,
        nextAction: target.name === "caseNextAction" ? target.value : currentCase.nextAction,
        internalNote: target.name === "caseInternalNote" ? target.value : currentCase.internalNote,
        sampleStatus: target.name === "caseSampleStatus" ? target.value : currentCase.sampleStatus,
        commercialStatus: target.name === "caseCommercialStatus" ? target.value : currentCase.commercialStatus,
      }));
      persistState();
      render();
      return;
    }

    if (target.name === "intakeName" || target.name === "intakeSector" || target.name === "intakeState" || target.name === "intakeCity" || target.name === "intakeTags" || target.name === "intakeSummary") {
      state.intake = {
        ...state.intake,
        [target.name.replace("intake", "").replace(/^./, (char) => char.toLowerCase())]: target.value,
      };
      render();
      return;
    }

    if (!(target.name in state.filters)) {
      return;
    }

    state.filters = {
      ...state.filters,
      [target.name]: target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value,
    };

    persistState();
    track("verifysme_filter_changed", { field: target.name });
    refreshInsights(true);
    render();
  });

  root.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const presetButton = target.closest("[data-preset-id]");

    if (presetButton instanceof HTMLElement) {
      const presetId = presetButton.dataset.presetId;
      state.filters = buildFiltersFromPreset(presetId);
      track("verifysme_preset_selected", { presetId });
      refreshInsights(true);
      render();
      return;
    }

    const supplierActivator = target.closest("[data-open-supplier], [data-supplier-card]");

    if (supplierActivator instanceof HTMLElement) {
      const supplierId = supplierActivator.dataset.supplierId;

      if (supplierId) {
        state.selectedSupplierId = supplierId;
        persistState();
        track("verifysme_supplier_opened", { supplierId });
        render();
        return;
      }
    }

    const shortlistButton = target.closest("[data-toggle-shortlist]");

    if (shortlistButton instanceof HTMLElement) {
      const supplierId = shortlistButton.dataset.supplierId;

      if (!supplierId) {
        return;
      }

      const next = state.shortlistIds.includes(supplierId)
        ? state.shortlistIds.filter((id) => id !== supplierId)
        : [...state.shortlistIds, supplierId].slice(-4);

      updateShortlist(next);
      track("verifysme_shortlist_toggled", { supplierId, saved: next.includes(supplierId) });
      render();
      return;
    }

    const workflowButton = target.closest("[data-set-supplier-stage]");

    if (workflowButton instanceof HTMLElement) {
      const supplierId = workflowButton.dataset.supplierId;
      const nextStage = workflowButton.dataset.setSupplierStage;

      if (!supplierId || !nextStage) {
        return;
      }

      updateSupplierCase(state, supplierId, (currentCase) => ({
        ...currentCase,
        stage: nextStage,
        auditLog: appendCaseAudit(currentCase, `Stage moved to ${nextStage}.`),
      }));
      persistState();
      track("verifysme_stage_changed", { supplierId, nextStage });
      render();
      return;
    }

    if (target.closest("[data-open-compare]")) {
      track("verifysme_compare_opened");
      render();
      return;
    }

    if (target.closest("[data-add-supplier]")) {
      if (!state.intake.name.trim()) {
        return;
      }

      const nextSupplier = createWorkspaceSupplier(state.intake);
      state.workspaceSuppliers = [...state.workspaceSuppliers, nextSupplier];
      safeWrite(STORAGE_KEYS.suppliers, state.workspaceSuppliers);
      updateSupplierCase(state, nextSupplier.id, () =>
        createDefaultDiligenceCase(nextSupplier.id, {
          auditLog: [`${new Date().toLocaleDateString()} · Supplier added from manual intake.`],
        }),
      );
      state.selectedSupplierId = nextSupplier.id;
      state.intake = {
        name: "",
        sector: sectorOrder[0],
        state: stateOrder[0],
        city: "",
        tags: "",
        summary: "",
      };
      persistState();
      track("verifysme_supplier_added", { supplierId: nextSupplier.id });
      refreshInsights(true);
      render();
      return;
    }

    if (target.closest("[data-export-shortlist]")) {
      const shortlistProfiles = getAllSuppliers().filter((item) => state.shortlistIds.includes(item.id));

      if (!shortlistProfiles.length) {
        return;
      }

      triggerDownload("verifysme-shortlist.csv", buildShortlistExport(shortlistProfiles));
      track("verifysme_export_triggered", { count: shortlistProfiles.length });
      render();
      return;
    }

    if (target.closest("[data-sync-verify-sources]")) {
      if (!state.session?.signedIn) {
        return;
      }

      state.syncingSources = true;
      render();
      syncSources()
        .catch(() => null)
        .finally(() => {
          refreshInsights(true);
          state.syncingSources = false;
          render();
        });
      return;
    }

    if (target.closest("[data-load-udyam-challenge]")) {
      if (!state.session?.signedIn || state.udyam.loading) {
        return;
      }

      state.udyam.loading = true;
      state.udyam.error = "";
      render();
      createUdyamChallenge()
        .then((challenge) => {
          state.udyam.challenge = challenge;
          state.udyam.captcha = "";
          track("verifysme_udyam_challenge_loaded");
        })
        .catch((error) => {
          state.udyam.error = error.message;
        })
        .finally(() => {
          state.udyam.loading = false;
          persistState();
          render();
        });
      return;
    }

    if (target.closest("[data-submit-udyam-verify]")) {
      if (!state.session?.signedIn || state.udyam.loading || !state.udyam.challenge?.token) {
        return;
      }

      state.udyam.loading = true;
      state.udyam.error = "";
      render();
      verifyUdyamRegistration({
        token: state.udyam.challenge.token,
        registrationNumber: state.udyam.registrationNumber,
        captcha: state.udyam.captcha,
      })
        .then((result) => {
          state.udyam.result = result;
          state.udyam.challenge = result.nextChallenge || null;
          state.udyam.captcha = "";
          if (result.status === "verified" && state.selectedSupplierId) {
            bindEvidenceToSupplierCase(state, state.selectedSupplierId, "udyam", result);
          }
          track("verifysme_udyam_verified", { status: result.status });
          refreshInsights(true);
        })
        .catch((error) => {
          state.udyam.error = error.message;
        })
        .finally(() => {
          state.udyam.loading = false;
          persistState();
          render();
        });
      return;
    }

    if (target.closest("[data-submit-udyam-import]")) {
      if (!state.session?.signedIn || state.udyam.loading || !state.udyam.certificateText.trim()) {
        return;
      }

      state.udyam.loading = true;
      state.udyam.error = "";
      render();
      parseUdyamImportedRecord({ content: state.udyam.certificateText })
        .then((result) => {
          state.udyam.result = result;
          if (state.selectedSupplierId) {
            bindEvidenceToSupplierCase(state, state.selectedSupplierId, "udyam", result);
          }
          track("verifysme_udyam_imported", {
            confidence: result.confidence,
            matchedFieldCount: result.matchedFieldCount,
          });
          refreshInsights(true);
        })
        .catch((error) => {
          state.udyam.error = error.message;
        })
        .finally(() => {
          state.udyam.loading = false;
          persistState();
          render();
        });
      return;
    }

    const selectCinButton = target.closest("[data-select-mca-cin]");

    if (selectCinButton) {
      state.mca.selectedCin = selectCinButton.getAttribute("data-select-mca-cin") || "";
      state.mca.selectedCompanyName = selectCinButton.getAttribute("data-select-mca-name") || "";
      state.mca.error = "";
      track("verifysme_mca_cin_selected", { cin: state.mca.selectedCin });
      persistState();
      render();
      return;
    }

    if (target.closest("[data-submit-mca-find-cin-parse]")) {
      if (!state.session?.signedIn || state.mca.loading || !state.mca.findCinText.trim()) {
        return;
      }

      state.mca.loading = true;
      state.mca.error = "";
      render();
      parseMcaFindCinResults({ content: state.mca.findCinText })
        .then((result) => {
          state.mca.findCinResult = result;
          if (!state.mca.selectedCin && result.candidates?.[0]) {
            state.mca.selectedCin = result.candidates[0].cin;
            state.mca.selectedCompanyName = result.candidates[0].companyName;
          }
          track("verifysme_mca_find_cin_parsed", { candidateCount: result.candidateCount });
        })
        .catch((error) => {
          state.mca.error = error.message;
        })
        .finally(() => {
          state.mca.loading = false;
          persistState();
          render();
        });
      return;
    }

    if (target.closest("[data-submit-mca-parse]")) {
      if (!state.session?.signedIn || state.mca.loading || !state.mca.sourceText.trim()) {
        return;
      }

      state.mca.loading = true;
      state.mca.error = "";
      render();
      parseMcaMasterData({ content: state.mca.sourceText })
        .then((result) => {
          state.mca.result = result;
          if (result.cin) {
            state.mca.selectedCin = result.cin;
          }
          if (result.companyName) {
            state.mca.selectedCompanyName = result.companyName;
          }
          if (state.selectedSupplierId) {
            bindEvidenceToSupplierCase(state, state.selectedSupplierId, "mca", result);
          }
          track("verifysme_mca_parsed", {
            confidence: result.confidence,
            matchedFieldCount: result.matchedFieldCount,
          });
          refreshInsights(true);
        })
        .catch((error) => {
          state.mca.error = error.message;
        })
        .finally(() => {
          state.mca.loading = false;
          persistState();
          render();
        });
      return;
    }

    if (target.closest("[data-export-diligence-memo]")) {
      const selected = getAllSuppliers().find((item) => item.id === state.selectedSupplierId);

      if (!selected) {
        return;
      }

      const caseRecord = getSupplierCase(state.cases, selected.id, getWorkflowStage(selected.id, state.workflow));
      triggerDownload(
        `${selected.id}-diligence-memo.md`,
        buildDiligenceMemo({ ...selected, compositeScore: getCompositeScore(selected) }, caseRecord),
        "text/markdown;charset=utf-8",
      );
      track("verifysme_memo_exported", { supplierId: selected.id });
      render();
    }
  });

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
    version: STATE_VERSION,
    filters: state.filters,
    shortlistIds: state.shortlistIds,
    analytics: state.analytics,
    workflow: state.workflow,
    cases: state.cases,
    workspaceSuppliers: state.workspaceSuppliers,
    selectedSupplierId: state.selectedSupplierId,
    udyam: {
      registrationNumber: state.udyam.registrationNumber,
      certificateText: state.udyam.certificateText,
      result: state.udyam.result,
    },
    mca: {
      findCinText: state.mca.findCinText,
      findCinResult: state.mca.findCinResult,
      selectedCin: state.mca.selectedCin,
      selectedCompanyName: state.mca.selectedCompanyName,
      sourceText: state.mca.sourceText,
      result: state.mca.result,
    },
  })
    .then((persisted) => {
      if (persisted && typeof persisted === "object") {
        const persistedVersion = Number(persisted.version || 0);
        const persistedFilters =
          persisted.filters && typeof persisted.filters === "object"
            ? { ...createDefaultFilters(), ...persisted.filters }
            : createDefaultFilters();
        const migratedFilters =
          !hasExplicitQueryParam && persistedVersion < STATE_VERSION && isLegacyFoodPackagingDefault(persistedFilters)
            ? createDefaultFilters()
            : persistedFilters;

        state.filters = { ...migratedFilters, ...explicitFilterOverrides };
        state.shortlistIds = Array.isArray(persisted.shortlistIds) ? persisted.shortlistIds : state.shortlistIds;
        state.analytics = Array.isArray(persisted.analytics) ? persisted.analytics : state.analytics;
        state.workflow = persisted.workflow && typeof persisted.workflow === "object" ? persisted.workflow : state.workflow;
        state.cases = persisted.cases && typeof persisted.cases === "object" ? persisted.cases : state.cases;
        state.workspaceSuppliers = Array.isArray(persisted.workspaceSuppliers) ? persisted.workspaceSuppliers : state.workspaceSuppliers;
        state.selectedSupplierId = persisted.selectedSupplierId || state.selectedSupplierId;
        state.udyam = persisted.udyam && typeof persisted.udyam === "object"
          ? {
              ...state.udyam,
              registrationNumber:
                typeof persisted.udyam.registrationNumber === "string"
                  ? persisted.udyam.registrationNumber
                  : state.udyam.registrationNumber,
              certificateText:
                typeof persisted.udyam.certificateText === "string"
                  ? persisted.udyam.certificateText
                  : state.udyam.certificateText,
              result: persisted.udyam.result || state.udyam.result,
            }
          : state.udyam;
        state.mca = persisted.mca && typeof persisted.mca === "object"
          ? {
              ...state.mca,
              findCinText:
                typeof persisted.mca.findCinText === "string"
                  ? persisted.mca.findCinText
                  : state.mca.findCinText,
              findCinResult: persisted.mca.findCinResult || state.mca.findCinResult,
              selectedCin:
                typeof persisted.mca.selectedCin === "string"
                  ? persisted.mca.selectedCin
                  : state.mca.selectedCin,
              selectedCompanyName:
                typeof persisted.mca.selectedCompanyName === "string"
                  ? persisted.mca.selectedCompanyName
                  : state.mca.selectedCompanyName,
              sourceText:
                typeof persisted.mca.sourceText === "string"
                  ? persisted.mca.sourceText
                  : state.mca.sourceText,
              result: persisted.mca.result || state.mca.result,
            }
          : state.mca;
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

      if (!state.analytics.some((event) => event.name === "verifysme_viewed")) {
        track("verifysme_viewed");
      }

      return refreshInsights();
    })
    .catch(() => {
      state.hydrated = true;
      render();
    });

  render();
}
