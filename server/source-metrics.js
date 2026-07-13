import { nowIso } from "./persistence.js";
import { buildFiltersFromPreset, filterSuppliers, getCompositeScore, getKpis, getRiskSummary, getSectorSummary, getStateSummary, supplierProfiles } from "../apps/verifysme/index.js";
import { exportOpportunities, exportProfiles } from "../apps/exportpulse/data/catalog.js";
import { buildBlockerMix, buildExportOpportunityView, buildMarketMix, summarizeExportWorkspace } from "../lib/exportpulse.js";
import { tenderOpportunities, tenderProfiles } from "../apps/tenderradar/data/catalog.js";
import { buildRadarView, summarizeRadar } from "../lib/tenderradar.js";
import { buildLiveExportInventory, buildLiveSupplierInventory, buildLiveTenderInventory } from "../lib/live-tradegraph.js";

const METRIC_KEYS = {
  sourceHealth: "source_health",
  verify: "verifysme",
  tender: "tenderradar",
  export: "exportpulse",
};

const PRODUCT_DEFAULT_PROFILES = {
  verifysme: supplierProfiles[0]?.id || "",
  tenderradar: tenderProfiles[0]?.id || "",
  exportpulse: exportProfiles[0]?.id || "",
};

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function countBy(items, selector) {
  return items.reduce((accumulator, item) => {
    const key = selector(item);
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function getBand(score) {
  if (score >= 85) {
    return "High";
  }

  if (score >= 70) {
    return "Medium";
  }

  return "Low";
}

function summarizeSourceHealth(sources = []) {
  const items = sources.map((item) => ({
    key: item.key,
    label: item.label,
    status: item.status,
    checkedAt: item.checkedAt,
    itemCount: safeNumber(item.itemCount, 0),
    note: item.note || "",
    evidence: item.evidence || "",
  }));

  return {
    totalSources: items.length,
    liveCount: items.filter((item) => item.status === "live").length,
    restrictedCount: items.filter((item) => item.status === "restricted").length,
    errorCount: items.filter((item) => item.status === "error").length,
    totalItems: items.reduce((sum, item) => sum + item.itemCount, 0),
    sourceAgeBands: countBy(items, (item) => {
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(item.checkedAt).getTime()) / (1000 * 60 * 60 * 24)));

      if (!Number.isFinite(ageDays) || ageDays <= 2) {
        return "fresh";
      }

      if (ageDays <= 7) {
        return "recent";
      }

      return "stale";
    }),
    items,
  };
}

function buildVerifyMetricPayload(sources = []) {
  const filters = {
    searchTerm: "",
    sector: "",
    state: "",
    lowRiskOnly: false,
    exportReadyOnly: false,
    tenderReadyOnly: false,
  };
  const inventory = buildLiveSupplierInventory({
    sources,
    profiles: supplierProfiles,
    verifyState: {},
  });
  const filtered = filterSuppliers(inventory.items, filters);
  const kpis = getKpis(filtered, []);

  return {
    profileId: PRODUCT_DEFAULT_PROFILES.verifysme,
    dataMode: inventory.mode,
    supplierCount: kpis.supplierCount,
    averageTrust: kpis.averageTrust,
    exportReady: kpis.exportReady,
    tenderReady: kpis.tenderReady,
    shortlistCount: kpis.shortlistCount,
    lowRiskCount: inventory.items.filter((profile) => profile.riskBand === "Low").length,
    highConfidenceCount: inventory.items.filter((profile) => profile.dataConfidence === "High").length,
    sectorMix: Object.fromEntries(getSectorSummary(filtered).map((item) => [item.sector, item.average])),
    stateMix: Object.fromEntries(getStateSummary(filtered).map((item) => [item.state, item.count])),
    riskMix: Object.fromEntries(getRiskSummary(filtered).map((item) => [item.label, item.count])),
    trustBands: countBy(inventory.items, (profile) => getBand(getCompositeScore(profile))),
  };
}

function buildTenderMetricPayload(sources = []) {
  const profile = tenderProfiles.find((item) => item.id === PRODUCT_DEFAULT_PROFILES.tenderradar) || tenderProfiles[0];
  const liveInventory = buildLiveTenderInventory({ sources, fallback: tenderOpportunities });
  const visible = buildRadarView(liveInventory.items, profile);
  const summary = summarizeRadar(visible);
  const gapMix = countBy(
    visible.flatMap((item) => item.analysis.gaps).map((gap) => {
      const lower = gap.toLowerCase();
      if (lower.includes("turnover")) return "turnover";
      if (lower.includes("project")) return "project history";
      if (lower.includes("geograph")) return "geography";
      if (lower.includes("category") || lower.includes("scope")) return "scope fit";
      if (lower.includes("credential")) return "credentials";
      return "other";
    }),
    (value) => value,
  );

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    dataMode: liveInventory.mode,
    matchedCount: summary.counts.matched,
    highFit: summary.counts.highFit,
    closingSoon: summary.counts.closingSoon,
    shortlistReady: summary.counts.shortlistReady,
    averageValueCrore: summary.averageValueCrore,
    buyerMix: summary.buyerMix,
    sectorMix: summary.sectorMix,
    fitBands: countBy(visible, (item) => item.analysis.fitBand),
    urgencyMix: countBy(visible, (item) => item.analysis.urgency),
    gapMix,
  };
}

function buildExportMetricPayload(sources = []) {
  const profile = exportProfiles.find((item) => item.id === PRODUCT_DEFAULT_PROFILES.exportpulse) || exportProfiles[0];
  const supplier = supplierProfiles.find((item) => item.id === profile.supplierId) || supplierProfiles[0];
  const liveInventory = buildLiveExportInventory({
    sources,
    supplier,
    profile,
    fallback: exportOpportunities,
  });
  const visible = buildExportOpportunityView(liveInventory.items, supplier);
  const summary = summarizeExportWorkspace(visible);
  const blockerMix = countBy(
    visible.flatMap((item) => item.analysis.blockers).map((blocker) => {
      const lower = blocker.toLowerCase();
      if (lower.includes("sector")) return "sector fit";
      if (lower.includes("market")) return "market proof";
      if (lower.includes("credential")) return "credentials";
      if (lower.includes("readiness")) return "readiness";
      return "other";
    }),
    (value) => value,
  );

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    dataMode: liveInventory.mode,
    total: summary.total,
    readyNow: summary.readyNow,
    needsFixes: summary.needsFixes,
    highMargin: summary.highMargin,
    directMarketMatches: summary.directMarketMatches,
    averageScore: summary.averageScore,
    marketMix: buildMarketMix(visible),
    blockerMix: buildBlockerMix(visible),
    actionCount: visible.reduce((sum, item) => sum + item.nextActions.length, 0),
    blockerCategories: blockerMix,
    routeBands: countBy(visible, (item) => item.analysis.readinessBand),
  };
}

export function buildSyncArtifacts(snapshots, syncedAt = nowIso()) {
  const syncId = createId("sync");
  const day = syncedAt.slice(0, 10);
  const sourceHistory = snapshots.map((snapshot) => ({
    id: createId("source_history"),
    syncId,
    sourceKey: snapshot.key,
    label: snapshot.label,
    status: snapshot.status,
    checkedAt: snapshot.checkedAt,
    itemCount: safeNumber(snapshot.itemCount, 0),
    items: snapshot.items || [],
    note: snapshot.note || "",
    evidence: snapshot.evidence || "",
    createdAt: syncedAt,
  }));

  const dailyMetrics = [
    {
      id: createId("daily_metric"),
      metricKey: METRIC_KEYS.sourceHealth,
      day,
      scope: "suite",
      workspaceId: null,
      payload: summarizeSourceHealth(snapshots),
      createdAt: syncedAt,
      syncId,
    },
    {
      id: createId("daily_metric"),
      metricKey: METRIC_KEYS.verify,
      day,
      scope: "product",
      workspaceId: null,
      payload: buildVerifyMetricPayload(snapshots),
      createdAt: syncedAt,
      syncId,
    },
    {
      id: createId("daily_metric"),
      metricKey: METRIC_KEYS.tender,
      day,
      scope: "product",
      workspaceId: null,
      payload: buildTenderMetricPayload(snapshots),
      createdAt: syncedAt,
      syncId,
    },
    {
      id: createId("daily_metric"),
      metricKey: METRIC_KEYS.export,
      day,
      scope: "product",
      workspaceId: null,
      payload: buildExportMetricPayload(snapshots),
      createdAt: syncedAt,
      syncId,
    },
  ];

  return {
    syncId,
    syncedAt,
    sourceHistory,
    dailyMetrics,
  };
}
