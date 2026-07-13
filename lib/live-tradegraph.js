import { buildExportOpportunityView } from "./exportpulse.js";
import { buildRadarView } from "./tenderradar.js";

const STATE_NAMES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Puducherry",
  "Chandigarh",
];

const MARKET_REGION_MAP = new Map([
  ["uae", "GCC"],
  ["saudi arabia", "GCC"],
  ["qatar", "GCC"],
  ["oman", "GCC"],
  ["kuwait", "GCC"],
  ["bahrain", "GCC"],
  ["germany", "EU"],
  ["poland", "EU"],
  ["france", "EU"],
  ["netherlands", "EU"],
  ["italy", "EU"],
  ["spain", "EU"],
  ["united kingdom", "Europe"],
  ["uk", "Europe"],
  ["singapore", "APAC"],
  ["malaysia", "APAC"],
  ["thailand", "APAC"],
  ["indonesia", "APAC"],
  ["vietnam", "APAC"],
  ["kenya", "Africa"],
  ["south africa", "Africa"],
  ["usa", "North America"],
  ["united states", "North America"],
  ["canada", "North America"],
]);

const TENDER_SECTOR_RULES = [
  {
    sector: "Water infrastructure",
    keywords: ["pump", "pumping", "water", "pipeline", "phed", "sewer", "irrigation", "water supply"],
    credentials: ["ISO 9001", "OEM Authorization", "GST"],
    valueCrore: 3.6,
    minProjects: 2,
  },
  {
    sector: "Healthcare procurement",
    keywords: ["hospital", "diagnostic", "medical", "lab", "reagent", "consumable", "health", "icmr"],
    credentials: ["ISO 13485", "Authorized Distributor", "GST"],
    valueCrore: 4.8,
    minProjects: 3,
  },
  {
    sector: "Energy transition",
    keywords: ["solar", "substation", "battery", "epc", "power", "metering", "scada"],
    credentials: ["ISO 9001", "Electrical License", "GST"],
    valueCrore: 9.8,
    minProjects: 3,
  },
  {
    sector: "Cybersecurity",
    keywords: ["cloud", "security", "soc", "noc", "cyber", "data center", "managed services"],
    credentials: ["ISO 27001", "GST"],
    valueCrore: 6.8,
    minProjects: 2,
  },
  {
    sector: "Packaging",
    keywords: ["packaging", "laminate", "pouch", "label", "carton", "food grade"],
    credentials: ["ISO 22000", "BRCGS", "GST"],
    valueCrore: 2.9,
    minProjects: 2,
  },
  {
    sector: "Industrial components",
    keywords: ["casting", "machining", "component", "rolling stock", "industrial", "maintenance"],
    credentials: ["ISO 9001", "GST"],
    valueCrore: 5.6,
    minProjects: 2,
  },
  {
    sector: "Apparel",
    keywords: ["apparel", "uniform", "workwear", "garment", "fabric", "stitched"],
    credentials: ["GST", "SEDEX", "WRAP"],
    valueCrore: 2.4,
    minProjects: 2,
  },
  {
    sector: "Facility operations",
    keywords: ["housekeeping", "cleaning", "maintenance", "painting", "repair", "amc"],
    credentials: ["GST", "MSME/Udyam"],
    valueCrore: 1.2,
    minProjects: 1,
  },
  {
    sector: "Research and lab procurement",
    keywords: ["research", "biotech", "satellite", "lab", "mmic", "equipment", "science"],
    credentials: ["GST", "Authorized Distributor"],
    valueCrore: 2.2,
    minProjects: 1,
  },
];

const EXPORT_THEME_RULES = [
  {
    key: "ecommerce",
    label: "Cross-border e-commerce lane",
    match: ["e-commerce"],
    requiredCredentials: ["IEC", "GST"],
    recommendedDocuments: ["Marketplace readiness note", "Returns and fulfilment SOP", "Product data sheet"],
    complianceFocus: ["Platform policy compliance", "Fulfilment SLAs", "Catalog documentation"],
    riskNotes: ["Marketplace rules can change quickly", "Returns handling can erode contribution margin"],
    nextActions: ["Map first marketplace lane into {market}", "Confirm fulfilment partner for {market}", "Build exporter SKU pack"],
    thresholdDelta: -8,
    channelModel: "Cross-border e-commerce",
    marginBand: "Medium",
  },
  {
    key: "compliance",
    label: "TRACE compliance push",
    match: ["trace", "accreditation", "compliance", "regulations"],
    requiredCredentials: ["IEC", "GST"],
    recommendedDocuments: ["Compliance matrix", "Certification register", "Label / declaration pack"],
    complianceFocus: ["Accreditation trace", "Label discipline", "Regulatory response speed"],
    riskNotes: ["Documentation gaps slow first-order conversion", "Certification drift weakens buyer confidence"],
    nextActions: ["Build compliance matrix for {market}", "Audit documentation gaps", "Prepare regulator-facing declaration pack"],
    thresholdDelta: 6,
    channelModel: "",
    marginBand: "High",
  },
  {
    key: "logistics",
    label: "FLOW logistics route",
    match: ["flow", "warehousing", "fulfilment", "freight", "lift", "supply chain resilience"],
    requiredCredentials: ["IEC", "GST"],
    recommendedDocuments: ["Freight lane model", "Warehouse option memo", "Transit packing SOP"],
    complianceFocus: ["Warehousing readiness", "Freight economics", "Damage / fill-rate control"],
    riskNotes: ["Freight volatility can wipe out weak-margin routes", "Warehousing missteps create working-capital drag"],
    nextActions: ["Model freight economics for {market}", "Identify warehouse or distributor coverage", "Stress-test damage and fulfilment assumptions"],
    thresholdDelta: -2,
    channelModel: "",
    marginBand: "Medium",
  },
  {
    key: "finance",
    label: "Credit and cash-cycle route",
    match: ["interest subvention", "credit assistance", "bank account validation"],
    requiredCredentials: ["IEC", "GST"],
    recommendedDocuments: ["Banking readiness note", "Cash-cycle model", "Invoice and remittance checklist"],
    complianceFocus: ["Bank validation", "Credit support", "Cash-cycle planning"],
    riskNotes: ["Poor cash-cycle planning will stall otherwise attractive export lanes", "Banking workflow delays hurt shipment readiness"],
    nextActions: ["Validate export banking stack", "Map trade-credit support for {market}", "Build remittance and invoice checklist"],
    thresholdDelta: -5,
    channelModel: "",
    marginBand: "Medium",
  },
  {
    key: "market-entry",
    label: "Emerging market-entry brief",
    match: ["emerging export opportunities", "insight", "alternative trade instruments", "digital trade facilitation"],
    requiredCredentials: ["IEC", "GST"],
    recommendedDocuments: ["Go-to-market brief", "Distributor / buyer longlist", "Commercial thesis note"],
    complianceFocus: ["Market-entry fit", "Buyer discovery", "Offer packaging"],
    riskNotes: ["Weak channel assumptions lead to wasted outreach", "Route selection should precede broad buyer outreach"],
    nextActions: ["Assemble first buyer / distributor longlist for {market}", "Package market-entry thesis", "Validate route economics and lead times"],
    thresholdDelta: 0,
    channelModel: "",
    marginBand: "High",
  },
];

const SECTOR_DEFAULT_MARKETS = {
  packaging: ["UAE", "Saudi Arabia", "Kenya"],
  industrial: ["Germany", "Poland", "UAE"],
  wellness: ["Singapore", "UAE", "Saudi Arabia"],
  apparel: ["United Kingdom", "Germany", "UAE"],
  electronics: ["UAE", "Sri Lanka", "Saudi Arabia"],
  beauty: ["UAE", "Nepal", "Saudi Arabia"],
  distribution: ["UAE", "Kenya"],
};

const SECTOR_PREFERRED_BUYERS = {
  packaging: ["PSU", "State government", "Large enterprise"],
  industrial: ["PSU", "Central government", "Large enterprise"],
  wellness: ["Large enterprise", "Hospital"],
  apparel: ["Central government", "PSU", "Large enterprise"],
  electronics: ["Central government", "PSU", "Hospital"],
  beauty: ["Large enterprise"],
  distribution: ["State government", "PSU"],
};

const CAPACITY_TURNOVER_MAP = {
  "small-batch": 8,
  "mid-scale": 22,
  "high-volume": 36,
  "project-based": 28,
  "network-based": 14,
  unknown: 12,
};

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function ageInDays(isoValue) {
  const time = new Date(isoValue || "").getTime();
  if (!Number.isFinite(time)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24)));
}

function daysFrom(isoValue, days, fallback = new Date()) {
  const date = isoValue ? new Date(isoValue) : new Date(fallback);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parsePortalDate(value, fallbackIso = new Date().toISOString()) {
  const input = String(value || "").trim();

  if (!input) {
    return fallbackIso.slice(0, 10);
  }

  const native = new Date(input);
  if (!Number.isNaN(native.getTime())) {
    return native.toISOString().slice(0, 10);
  }

  const shortMonth = input.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (shortMonth) {
    const [_, day, month, year] = shortMonth;
    const parsed = new Date(`${day} ${month} ${year} 00:00:00 UTC`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const slash = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [_, day, month, year] = slash;
    const parsed = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return fallbackIso.slice(0, 10);
}

function inferIndianState(text, fallback = "Pan-India") {
  const normalized = normalize(text);

  for (const state of STATE_NAMES) {
    if (normalized.includes(normalize(state))) {
      return state;
    }
  }

  if (normalized.includes("embassy of india") || normalized.includes("ministry of external affairs")) {
    return "Delhi";
  }

  return fallback;
}

function inferBuyerType(text) {
  const normalized = normalize(text);

  if (normalized.includes("hospital") || normalized.includes("medical college") || normalized.includes("health")) {
    return "Hospital";
  }

  if (normalized.includes("municipal") || normalized.includes("urban local body") || normalized.includes("smart city")) {
    return "Urban local body";
  }

  if (normalized.includes("corporation") || normalized.includes("limited") || normalized.includes("psu") || normalized.includes("authority") || normalized.includes("board")) {
    return "PSU";
  }

  if (normalized.includes("ministry of") || normalized.includes("department of") || normalized.includes("embassy of india")) {
    return normalized.includes("state") ? "State government" : "Central government";
  }

  if (normalized.includes("state")) {
    return "State government";
  }

  return "Public sector";
}

function inferTenderRule(text) {
  const normalized = normalize(text);
  let winner = null;

  for (const rule of TENDER_SECTOR_RULES) {
    const hits = rule.keywords.filter((keyword) => normalized.includes(normalize(keyword))).length;
    if (!winner || hits > winner.hits) {
      winner = { rule, hits };
    }
  }

  if (winner && winner.hits > 0) {
    return winner.rule;
  }

  return {
    sector: "General procurement",
    keywords: ["procurement", "supply", "services"],
    credentials: ["GST", "MSME/Udyam"],
    valueCrore: 2.4,
    minProjects: 1,
  };
}

function inferTenderValueCrore(text, sourceKey) {
  const normalized = normalize(text);
  const rule = inferTenderRule(text);
  let value = rule.valueCrore;

  if (normalized.includes("global")) {
    value += 2.8;
  }

  if (normalized.includes("annual") || normalized.includes("rate contract")) {
    value += 0.8;
  }

  if (normalized.includes("repair") || normalized.includes("housekeeping") || normalized.includes("cleaning")) {
    value = Math.max(0.6, value - 1.4);
  }

  if (sourceKey === "gem") {
    value += 0.9;
  }

  return Number(value.toFixed(1));
}

function inferTenderTurnoverCrore(estimatedValueCrore, buyerType) {
  const multiplier = buyerType === "Central government" || buyerType === "PSU" ? 2.4 : 1.8;
  return Number(Math.max(1, estimatedValueCrore * multiplier).toFixed(1));
}

function inferTenderKeywords(text) {
  const baseWords = normalize(text)
    .split(" ")
    .filter((word) => word.length > 3)
    .slice(0, 8);
  const rule = inferTenderRule(text);
  return unique([...rule.keywords, ...baseWords]).slice(0, 8);
}

function inferTenderCredentials(text) {
  const rule = inferTenderRule(text);
  return unique(rule.credentials);
}

function buildTenderRiskNotes({ sourceKey, closingDate, inferredFields = [] }) {
  const notes = [];
  const daysLeft = Math.ceil((new Date(`${closingDate}T00:00:00.000Z`).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 7) {
    notes.push("Closing window is tight; document prep needs immediate review.");
  }

  if (sourceKey === "gem") {
    notes.push("GeM public listing omits some qualification fields, so commercial thresholds are partially inferred.");
  }

  if (inferredFields.length) {
    notes.push(`Inferred fields: ${inferredFields.join(", ")}.`);
  }

  return unique(notes);
}

function enrichTenderFromCppp(item, snapshot) {
  const text = [item.title, item.organization, item.referenceNumber].filter(Boolean).join(" ");
  const estimatedValueCrore = inferTenderValueCrore(text, "cppp");
  const buyerType = inferBuyerType(item.organization || item.title);
  const closingDate = parsePortalDate(item.closingAt, snapshot.checkedAt);
  const requiredCredentials = inferTenderCredentials(text);
  const inferredFields = [];

  return {
    id: `live-tr-${slugify(item.tenderId || item.referenceNumber || item.title || item.id || item.serial)}`,
    sourceEntityId: item.tenderId || item.referenceNumber || item.title || item.id || item.serial,
    title: item.title || "Untitled public tender",
    buyer: item.organization || "Public buyer",
    buyerType,
    sector: inferTenderRule(text).sector,
    state: inferIndianState(text),
    source: "CPPP",
    sourceKey: "cppp",
    sourceUrl: item.detailUrl || "https://www.eprocure.gov.in/epublish/app",
    closingDate,
    estimatedValueCrore,
    emdLakh: Number(Math.max(0.2, estimatedValueCrore * 2.5).toFixed(1)),
    keywords: inferTenderKeywords(text),
    requiredCredentials,
    minTurnoverCrore: inferTenderTurnoverCrore(estimatedValueCrore, buyerType),
    minPastProjects: inferTenderRule(text).minProjects,
    scopeSummary: `${item.title}. Source buyer: ${item.organization}. Reference ${item.referenceNumber}.`,
    riskNotes: buildTenderRiskNotes({ sourceKey: "cppp", closingDate, inferredFields }),
    provenance: {
      confidence: "High",
      checkedAt: snapshot.checkedAt,
      label: snapshot.label,
      referenceNumber: item.referenceNumber || "",
      tenderId: item.tenderId || "",
      publishedAt: item.publishedAt || "",
      closingAt: item.closingAt || "",
      inferredFields,
    },
  };
}

function enrichTenderFromGem(item, snapshot) {
  const text = [item.department, item.ministry, item.category, item.bidNumber].filter(Boolean).join(" ");
  const estimatedValueCrore = inferTenderValueCrore(text, "gem");
  const buyerLabel = item.department || item.ministry || "GeM buyer";
  const buyerType = inferBuyerType([item.department, item.ministry].join(" "));
  const inferredFields = ["title", "closingDate", "estimatedValueCrore", "minTurnoverCrore"];
  const closingDate = daysFrom(snapshot.checkedAt, 14);

  return {
    id: `live-tr-${slugify(item.bidNumber || item.externalId || item.id)}`,
    sourceEntityId: item.externalId || item.bidNumber || item.id,
    title: `${inferTenderRule(text).sector} procurement via GeM`,
    buyer: buyerLabel,
    buyerType,
    sector: inferTenderRule(text).sector,
    state: inferIndianState([item.department, item.ministry].join(" "), "Pan-India"),
    source: "GeM",
    sourceKey: "gem",
    sourceUrl: item.documentUrl || "https://gem.gov.in/",
    closingDate,
    estimatedValueCrore,
    emdLakh: Number(Math.max(0.5, estimatedValueCrore * 2.1).toFixed(1)),
    keywords: inferTenderKeywords(text),
    requiredCredentials: inferTenderCredentials(text),
    minTurnoverCrore: inferTenderTurnoverCrore(estimatedValueCrore, buyerType),
    minPastProjects: Math.max(1, inferTenderRule(text).minProjects - 1),
    scopeSummary: `${buyerLabel} surfaced a live GeM procurement listing. Public BidPlus payload is limited, so category fit is inferred from ministry / department signals.`,
    riskNotes: buildTenderRiskNotes({ sourceKey: "gem", closingDate, inferredFields }),
    provenance: {
      confidence: "Medium",
      checkedAt: snapshot.checkedAt,
      label: snapshot.label,
      bidNumber: item.bidNumber || "",
      ministry: item.ministry || "",
      department: item.department || "",
      inferredFields,
    },
  };
}

function dedupeBy(items, selector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = selector(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildLiveTenderInventory({ sources = [], fallback = [] } = {}) {
  const records = [];
  const gemSnapshot = sources.find((item) => item.key === "gem");
  const cpppSnapshot = sources.find((item) => item.key === "cppp");

  if (cpppSnapshot?.status === "live") {
    records.push(...(cpppSnapshot.items || []).map((item) => enrichTenderFromCppp(item, cpppSnapshot)));
  }

  if (gemSnapshot?.status === "live") {
    records.push(...(gemSnapshot.items || []).map((item) => enrichTenderFromGem(item, gemSnapshot)));
  }

  const deduped = dedupeBy(records, (item) => item.sourceEntityId || `${item.title}:${item.buyer}`)
    .sort((left, right) => new Date(left.closingDate).getTime() - new Date(right.closingDate).getTime());

  if (deduped.length) {
    return {
      items: deduped,
      mode: "source-derived",
      sourcesUsed: unique(deduped.map((item) => item.sourceKey)),
    };
  }

  return {
    items: fallback,
    mode: "catalog-fallback",
    sourcesUsed: [],
  };
}

function getSectorKey(value) {
  return normalize(value || "").split(" ")[0] || normalize(value || "");
}

function deriveTenderProfileFromSupplier(profile) {
  const sectorKey = getSectorKey(profile.sector);
  const capacityKey = normalize(profile.capacityBand || "unknown");
  const annualTurnoverCrore = Math.max(
    CAPACITY_TURNOVER_MAP[capacityKey] || CAPACITY_TURNOVER_MAP.unknown,
    Math.round(((profile.trustScore || 60) + (profile.evidenceScore || 50)) / 4),
  );
  const averageTenderValueCrore = Number(Math.max(1.2, annualTurnoverCrore * 0.22).toFixed(1));
  const pastProjectsCount = Math.max(1, Math.round(((profile.tenderFit || 50) + (profile.evidenceScore || 50)) / 34));

  return {
    id: `live-tender-${profile.id}`,
    label: profile.name,
    companySize: profile.capacityBand || "SME supplier",
    annualTurnoverCrore,
    averageTenderValueCrore,
    pastProjectsCount,
    states: unique([profile.state, "Pan-India"]),
    categories: unique([profile.sector, ...(profile.tags || []).slice(0, 3)]),
    keywords: unique([...(profile.tags || []), profile.sector, ...(profile.exportMarkets || [])]).slice(0, 8),
    credentials: unique([...(profile.certifications || []), "GST", profile.udyamStatus?.includes("Verified") ? "MSME/Udyam" : ""]).slice(0, 8),
    preferredBuyerTypes: SECTOR_PREFERRED_BUYERS[sectorKey] || ["PSU", "State government"],
  };
}

function deriveExportProfileFromSupplier(profile) {
  const sectorKey = getSectorKey(profile.sector);
  const targetMarkets = unique([
    ...((profile.exportMarkets || []).slice(0, 3)),
    ...((SECTOR_DEFAULT_MARKETS[sectorKey] || []).slice(0, 3)),
  ]).slice(0, 3);

  return {
    id: `live-export-${profile.id}`,
    label: `${profile.name} route model`,
    supplierId: profile.id,
    targetMarkets,
    focus: `${profile.sector} expansion`,
    channelModel:
      profile.sector === "Apparel"
        ? "Retail buyer + sourcing office"
        : profile.sector === "Packaging"
          ? "Distributor + private-label brand"
          : profile.sector === "Industrial"
            ? "OEM + distributor"
            : "Distributor",
  };
}

function getOfficialEvidenceRows(profile, evidenceContext) {
  const rows = [];

  if (evidenceContext?.hasMca) {
    rows.push({
      source: "MCA",
      artifact: `${profile.name} legal entity and status record`,
      checked: ageInDays(evidenceContext.mca?.checkedAt) === null ? "Manual import" : `${ageInDays(evidenceContext.mca?.checkedAt)} days ago`,
      confidence: evidenceContext.mca?.confidence || "Official import",
      url: "https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html",
    });
  }

  if (evidenceContext?.hasUdyam) {
    rows.push({
      source: "Udyam",
      artifact: `${profile.name} MSME registration proof`,
      checked: ageInDays(evidenceContext.udyam?.checkedAt) === null ? "Manual import" : `${ageInDays(evidenceContext.udyam?.checkedAt)} days ago`,
      confidence: evidenceContext.udyam?.confidence || "Official import",
      url: "https://udyamregistration.gov.in/",
    });
  }

  return rows;
}

function deriveConfidence({ officialEvidenceCount, sourceKeys, liveTenderMatches, liveRouteMatches }) {
  if (officialEvidenceCount >= 2 && sourceKeys.length >= 2) {
    return "High";
  }

  if (officialEvidenceCount >= 1 || liveTenderMatches.length >= 1 || liveRouteMatches.length >= 1) {
    return "Medium";
  }

  return "Low";
}

function deriveRiskBand({ trustScore, evidenceScore, confidence }) {
  if (trustScore >= 86 && evidenceScore >= 78 && confidence === "High") {
    return "Low";
  }

  if (trustScore >= 72 && evidenceScore >= 60) {
    return "Medium";
  }

  return "Elevated";
}

export function buildLiveSupplierInventory({ sources = [], profiles = [], verifyState = {} } = {}) {
  const tenderInventory = buildLiveTenderInventory({ sources, fallback: [] });
  const hasLiveSources = sources.some((item) => item.status === "live");

  const items = profiles.map((profile) => {
    const evidenceContext = buildSupplierEvidenceContext(verifyState, profile.id);
    const tenderProfile = deriveTenderProfileFromSupplier(profile);
    const tenderView = buildRadarView(tenderInventory.items, tenderProfile)
      .map((item) => ({
        ...item,
        analysis: applyCompanyEvidenceToTenderScore(item, item.analysis, evidenceContext),
      }))
      .sort((left, right) => {
        if (right.analysis.totalScore !== left.analysis.totalScore) {
          return right.analysis.totalScore - left.analysis.totalScore;
        }

        return left.analysis.daysLeft - right.analysis.daysLeft;
      });
    const liveTenderMatches = tenderView.filter((item) => item.analysis.fitBand !== "Low fit").slice(0, 3);

    const exportProfile = deriveExportProfileFromSupplier(profile);
    const exportInventory = buildLiveExportInventory({
      sources,
      supplier: profile,
      profile: exportProfile,
      fallback: [],
    });
    const routeView = buildExportOpportunityView(exportInventory.items, profile)
      .map((item) => ({
        ...item,
        analysis: applyCompanyEvidenceToRouteScore(item, item.analysis, evidenceContext),
      }))
      .sort((left, right) => right.analysis.totalScore - left.analysis.totalScore);
    const liveRouteMatches = routeView.filter((item) => item.analysis.readinessBand !== "Needs deeper work").slice(0, 4);

    const officialEvidenceRows = getOfficialEvidenceRows(profile, evidenceContext);
    const officialEvidenceCount = officialEvidenceRows.length;
    const sourceKeys = unique([
      ...(liveTenderMatches.length ? tenderInventory.sourcesUsed : []),
      ...(liveRouteMatches.length ? exportInventory.sourcesUsed : []),
      ...(evidenceContext.hasMca ? ["mca"] : []),
      ...(evidenceContext.hasUdyam ? ["udyam"] : []),
    ]);
    const checkedAtValues = unique([
      ...officialEvidenceRows.map((item) => item.checked),
      ...liveTenderMatches.map((item) => item.provenance?.checkedAt),
      ...liveRouteMatches.map((item) => item.provenance?.checkedAt),
    ].filter((value) => String(value || "").includes("T")));
    const latestCheckedAt = checkedAtValues.sort().at(-1) || null;
    const freshnessDays = ageInDays(latestCheckedAt) ?? Math.max(0, Math.min(profile.freshnessDays ?? 30, 30));

    const topTender = liveTenderMatches[0] || tenderView[0] || null;
    const topRoute = liveRouteMatches[0] || routeView[0] || null;
    const trustScore = clamp(
      Math.round(
        (profile.trustScore || 60) * 0.55
          + officialEvidenceCount * 13
          + Math.min(liveTenderMatches.length, 3) * 4
          + Math.min(liveRouteMatches.length, 3) * 3
          + (freshnessDays <= 7 ? 6 : freshnessDays <= 14 ? 3 : 0),
      ),
      25,
      98,
    );
    const evidenceScore = clamp(
      Math.round(
        (profile.evidenceScore || 50) * 0.45
          + officialEvidenceCount * 17
          + Math.min(sourceKeys.length, 4) * 8
          + Math.min(liveTenderMatches.length + liveRouteMatches.length, 6) * 3,
      ),
      18,
      96,
    );
    const tenderFit = topTender ? topTender.analysis.totalScore : Math.round((profile.tenderFit || 40) * 0.8);
    const exportReadiness = topRoute ? topRoute.analysis.totalScore : Math.round((profile.exportReadiness || 40) * 0.8);
    const dataConfidence = deriveConfidence({
      officialEvidenceCount,
      sourceKeys,
      liveTenderMatches,
      liveRouteMatches,
    });
    const riskBand = deriveRiskBand({
      trustScore,
      evidenceScore,
      confidence: dataConfidence,
    });

    const evidence = unique([
      ...(profile.evidence || []),
      ...officialEvidenceRows.map((item) => `${item.source} official proof`),
      ...(liveTenderMatches.length ? [`${liveTenderMatches.length} live tender matches`] : []),
      ...(liveRouteMatches.length ? [`${liveRouteMatches.length} live route briefs`] : []),
    ]).slice(0, 10);
    const concerns = unique([
      ...(officialEvidenceCount === 0 ? ["No official MCA/Udyam proof is bound to this supplier yet."] : []),
      ...(liveTenderMatches.length === 0 ? ["No strong live tender fit surfaced in the current public feed."] : []),
      ...(liveRouteMatches.length === 0 ? ["No strong live DGFT-backed route brief surfaced for this supplier yet."] : []),
      ...(profile.concerns || []),
    ]).slice(0, 4);

    return {
      ...profile,
      trustScore,
      evidenceScore,
      tenderFit,
      exportReadiness,
      dataConfidence,
      riskBand,
      freshnessDays,
      summary: hasLiveSources
        ? `${profile.name} is now scored against live public-source evidence, with ${officialEvidenceCount} official proof${officialEvidenceCount === 1 ? "" : "s"}, ${liveTenderMatches.length} tender match${liveTenderMatches.length === 1 ? "" : "es"}, and ${liveRouteMatches.length} export route brief${liveRouteMatches.length === 1 ? "" : "s"}.`
        : profile.summary,
      gemStatus: liveTenderMatches.some((item) => item.sourceKey === "gem") ? "Live opportunity footprint" : profile.gemStatus,
      iecStatus: liveRouteMatches.length ? "Route-backed" : profile.iecStatus,
      evidence,
      concerns,
      sourceInventoryMode: hasLiveSources ? "source-derived" : "catalog-fallback",
      sourceKeys,
      officialEvidenceCount,
      liveTenderMatches: liveTenderMatches.map((item) => ({
        id: item.id,
        title: item.title,
        source: item.source,
        fitBand: item.analysis.fitBand,
        score: item.analysis.totalScore,
      })),
      liveRouteMatches: liveRouteMatches.map((item) => ({
        id: item.id,
        routeTitle: item.routeTitle || item.market,
        market: item.market,
        readinessBand: item.analysis.readinessBand,
        score: item.analysis.totalScore,
      })),
      evidenceArtifacts: unique([
        ...officialEvidenceRows,
        ...(topTender
          ? [
              {
                source: topTender.source,
                artifact: `${topTender.title}`,
                checked: ageInDays(topTender.provenance?.checkedAt) === null ? "Recently synced" : `${ageInDays(topTender.provenance?.checkedAt)} days ago`,
                confidence: topTender.provenance?.confidence || "Public source",
                url: topTender.sourceUrl || "",
              },
            ]
          : []),
        ...(topRoute
          ? [
              {
                source: "DGFT",
                artifact: `${topRoute.routeTitle || topRoute.market}`,
                checked: ageInDays(topRoute.provenance?.checkedAt) === null ? "Recently synced" : `${ageInDays(topRoute.provenance?.checkedAt)} days ago`,
                confidence: topRoute.provenance?.confidence || "Public source",
                url: topRoute.provenance?.pdfUrl || "",
              },
            ]
          : []),
      ]).slice(0, 4),
      evidenceLadder: [
        { label: "Official identity", value: officialEvidenceCount ? `${officialEvidenceCount} proof${officialEvidenceCount === 1 ? "" : "s"} bound` : "Awaiting official proof" },
        { label: "Tender demand trace", value: liveTenderMatches.length ? `${liveTenderMatches.length} live matched opportunities` : "No strong public tender fit yet" },
        { label: "Export route trace", value: liveRouteMatches.length ? `${liveRouteMatches.length} live route briefs` : "No strong DGFT-backed route yet" },
        { label: "Freshness", value: `${freshnessDays} days` },
        { label: "Sources", value: sourceKeys.length ? sourceKeys.map((item) => item.toUpperCase()).join(", ") : "Catalog fallback" },
      ],
    };
  });

  return {
    items,
    mode: hasLiveSources ? "source-derived" : "catalog-fallback",
    sourcesUsed: unique(items.flatMap((item) => item.sourceKeys || [])),
  };
}

function canonicalizeMarket(value) {
  const normalized = normalize(value);
  if (normalized === "uk") {
    return "united kingdom";
  }

  if (normalized === "uae") {
    return "united arab emirates";
  }

  if (normalized === "ksa") {
    return "saudi arabia";
  }

  return normalized;
}

function getRegionForMarket(market) {
  return MARKET_REGION_MAP.get(canonicalizeMarket(market)) || "Trade corridor";
}

function inferMarginBand(market, supplier) {
  const region = getRegionForMarket(market);

  if (region === "EU" || region === "Europe") {
    return "High";
  }

  if (region === "APAC" && normalize(supplier.sector).includes("wellness")) {
    return "High";
  }

  if (region === "GCC") {
    return "Medium";
  }

  return "Medium";
}

function pickNoticeTheme(notice) {
  const text = normalize([notice.title, notice.noticeNumber].filter(Boolean).join(" "));
  let winner = null;

  for (const theme of EXPORT_THEME_RULES) {
    const hits = theme.match.filter((keyword) => text.includes(normalize(keyword))).length;
    if (!winner || hits > winner.hits) {
      winner = { theme, hits };
    }
  }

  return winner?.hits ? winner.theme : EXPORT_THEME_RULES[EXPORT_THEME_RULES.length - 1];
}

function buildBaseExportCredentials(supplier) {
  return unique(
    ["IEC", "GST", ...((supplier.certifications || []).filter((item) => normalize(item) !== "udyam"))].slice(0, 6),
  );
}

function buildRouteFromNotice({ notice, snapshot, supplier, profile, market, sequence }) {
  const theme = pickNoticeTheme(notice);
  const baseCredentials = buildBaseExportCredentials(supplier);
  const requiredCredentials = unique([...baseCredentials, ...theme.requiredCredentials]).slice(0, 6);
  const thresholdBase = Math.max(64, Math.min(88, Math.round((supplier.exportReadiness || 70) + theme.thresholdDelta)));
  const channelModel = theme.channelModel || profile.channelModel || "Distributor";
  const routeTitle = `${market} · ${theme.label}`;

  return {
    id: `live-ep-${slugify(profile.id)}-${slugify(market)}-${slugify(theme.key)}-${sequence}`,
    routeTitle,
    market,
    region: getRegionForMarket(market),
    sector: supplier.sector,
    channelModel,
    marginBand: inferMarginBand(market, supplier),
    readinessThreshold: thresholdBase,
    demandSignal: `${notice.title} creates a live policy-backed route brief for ${market} in ${supplier.sector.toLowerCase()}.`,
    requiredCredentials,
    recommendedDocuments: unique([...theme.recommendedDocuments, `${titleCase(supplier.sector)} capability pack`]).slice(0, 5),
    complianceFocus: unique([...theme.complianceFocus, `${market} buyer-response discipline`]).slice(0, 4),
    riskNotes: unique([...theme.riskNotes, `Policy support still needs fast execution once ${market} outreach starts.`]).slice(0, 4),
    nextActions: theme.nextActions.map((item) => item.replaceAll("{market}", market)).slice(0, 4),
    sourceSignals: unique([notice.title, `DGFT ${notice.noticeNumber}`, theme.label]).slice(0, 4),
    matchSupplierIds: [supplier.id],
    sourceNotices: [
      {
        noticeNumber: notice.noticeNumber,
        title: notice.title,
        noticeDate: notice.noticeDate,
        pdfUrl: notice.pdfUrl,
      },
    ],
    provenance: {
      confidence: "High",
      checkedAt: snapshot.checkedAt,
      label: snapshot.label,
      noticeNumber: notice.noticeNumber,
      noticeDate: notice.noticeDate,
      pdfUrl: notice.pdfUrl,
      theme: theme.label,
    },
  };
}

export function buildLiveExportInventory({ sources = [], supplier, profile, fallback = [] } = {}) {
  const dgftSnapshot = sources.find((item) => item.key === "dgft");

  if (!supplier || !profile) {
    return {
      items: fallback,
      mode: "catalog-fallback",
      sourcesUsed: [],
    };
  }

  const targetMarkets = unique([...(profile.targetMarkets || []), ...((supplier.exportMarkets || []).slice(0, 2))]).slice(0, 3);
  const markets = targetMarkets.length ? targetMarkets : ["Global route"];

  if (dgftSnapshot?.status === "live" && Array.isArray(dgftSnapshot.items) && dgftSnapshot.items.length) {
    const notices = dgftSnapshot.items.slice(0, 4);
    const routes = [];

    markets.forEach((market) => {
      notices.forEach((notice, index) => {
        routes.push(buildRouteFromNotice({ notice, snapshot: dgftSnapshot, supplier, profile, market, sequence: index + 1 }));
      });
    });

    return {
      items: routes,
      mode: "source-derived",
      sourcesUsed: ["dgft"],
    };
  }

  return {
    items: fallback.filter((item) => !profile.targetMarkets.length || profile.targetMarkets.includes(item.market)),
    mode: "catalog-fallback",
    sourcesUsed: [],
  };
}

export function buildSupplierEvidenceContext(verifyState = {}, supplierId = "") {
  const caseRecord = verifyState?.cases?.[supplierId] || null;
  const evidence = caseRecord?.evidence || {};

  return {
    hasUdyam: Boolean(evidence.udyam),
    hasMca: Boolean(evidence.mca),
    udyam: evidence.udyam || null,
    mca: evidence.mca || null,
  };
}

export function applyCompanyEvidenceToTenderScore(opportunity, analysis, evidenceContext) {
  if (!evidenceContext?.hasMca && !evidenceContext?.hasUdyam) {
    return analysis;
  }

  const bonus = (evidenceContext.hasUdyam ? 4 : 0) + (evidenceContext.hasMca ? 4 : 0);
  const nextScore = Math.min(100, analysis.totalScore + bonus);
  const nextReasons = [...analysis.reasons];

  if (evidenceContext.hasUdyam) {
    nextReasons.push("official Udyam evidence is bound in the workspace");
  }

  if (evidenceContext.hasMca) {
    nextReasons.push("official MCA identity evidence is bound in the workspace");
  }

  return {
    ...analysis,
    totalScore: nextScore,
    fitBand:
      nextScore >= 78 && analysis.soloBidEligible
        ? "High fit"
        : nextScore >= 56 && (analysis.soloBidEligible || analysis.turnoverEligible)
          ? "Medium fit"
          : "Low fit",
    reasons: nextReasons,
    companyEvidence: {
      hasUdyam: evidenceContext.hasUdyam,
      hasMca: evidenceContext.hasMca,
    },
    companyConfidenceBonus: bonus,
  };
}

export function applyCompanyEvidenceToRouteScore(opportunity, analysis, evidenceContext) {
  if (!evidenceContext?.hasMca && !evidenceContext?.hasUdyam) {
    return analysis;
  }

  const bonus = (evidenceContext.hasUdyam ? 3 : 0) + (evidenceContext.hasMca ? 5 : 0);
  const nextScore = Math.min(99, analysis.totalScore + bonus);
  const nextReasons = [...analysis.reasons];

  if (evidenceContext.hasMca) {
    nextReasons.push("official MCA identity proof improves route confidence");
  }

  if (evidenceContext.hasUdyam) {
    nextReasons.push("official Udyam evidence supports exporter identity completeness");
  }

  return {
    ...analysis,
    totalScore: nextScore,
    readinessBand:
      nextScore >= 82 && analysis.readinessBand !== "Needs deeper work"
        ? "Ready now"
        : nextScore >= 68
          ? "Needs 1-2 fixes"
          : "Needs deeper work",
    reasons: nextReasons,
    companyEvidence: {
      hasUdyam: evidenceContext.hasUdyam,
      hasMca: evidenceContext.hasMca,
    },
    companyConfidenceBonus: bonus,
  };
}
