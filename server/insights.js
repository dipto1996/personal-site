import crypto from "node:crypto";

import { buildControlCenterInsightResponse } from "./analytics.js";
import { nowIso, readDb } from "./persistence.js";
import { buildSourceSummary } from "./source-adapters.js";
import {
  filterSuppliers,
  getCompositeScore,
  getKpis,
  mergeSupplierCatalog,
  getRiskSummary,
  getSectorSummary,
  getStateSummary,
  supplierProfiles,
} from "../apps/verifysme/index.js";
import { exportOpportunities, exportProfiles } from "../apps/exportpulse/data/catalog.js";
import {
  buildBlockerMix,
  buildExportOpportunityView,
  buildMarketMix,
  getTopEntries as getExportTopEntries,
  summarizeExportWorkspace,
} from "../lib/exportpulse.js";
import { tenderOpportunities, tenderProfiles } from "../apps/tenderradar/data/catalog.js";
import {
  buildRadarView,
  getTopEntries as getTenderTopEntries,
  summarizeRadar,
} from "../lib/tenderradar.js";
import {
  applyCompanyEvidenceToRouteScore,
  applyCompanyEvidenceToTenderScore,
  buildLiveExportInventory,
  buildLiveSupplierInventory,
  buildLiveTenderInventory,
  buildSupplierEvidenceContext,
} from "../lib/live-tradegraph.js";

const METRIC_KEYS = {
  sourceHealth: "source_health",
  verify: "verifysme",
  tender: "tenderradar",
  export: "exportpulse",
};

const PRODUCT_NAMESPACES = {
  verifysme: "verifysme.workspace",
  tenderradar: "tenderradar.workspace",
  exportpulse: "exportpulse.workspace",
};

const PRODUCT_DEFAULT_PROFILES = {
  verifysme: supplierProfiles[0]?.id || "",
  tenderradar: tenderProfiles[0]?.id || "",
  exportpulse: exportProfiles[0]?.id || "",
};

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeFilterValue(value) {
  return String(value || "").trim();
}

function normalizeBooleanParam(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeFilterValue(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizeDateRange(value) {
  const input = normalizeFilterValue(value).toLowerCase();

  if (!input || input === "30d") {
    return { label: "30d", start: daysAgo(30), end: nowIso() };
  }

  if (input === "all") {
    return { label: "all", start: null, end: null };
  }

  const relativeMatch = input.match(/^(\d+)\s*d$/);
  if (relativeMatch) {
    return { label: input, start: daysAgo(Number(relativeMatch[1])), end: nowIso() };
  }

  const rangeMatch = input.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    return {
      label: input,
      start: `${rangeMatch[1]}T00:00:00.000Z`,
      end: `${rangeMatch[2]}T23:59:59.999Z`,
    };
  }

  return { label: input, start: daysAgo(30), end: nowIso() };
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function isWithinRange(isoValue, range) {
  if (!range.start && !range.end) {
    return true;
  }

  const time = new Date(isoValue).getTime();
  const startTime = range.start ? new Date(range.start).getTime() : Number.NEGATIVE_INFINITY;
  const endTime = range.end ? new Date(range.end).getTime() : Number.POSITIVE_INFINITY;

  return time >= startTime && time <= endTime;
}

function getWorkspaceId(sessionContext, requestedWorkspaceId) {
  if (!sessionContext) {
    return "";
  }

  const allowedIds = new Set((sessionContext.workspaces || []).map((workspace) => workspace.id));

  if (requestedWorkspaceId && allowedIds.has(requestedWorkspaceId)) {
    return requestedWorkspaceId;
  }

  return sessionContext.workspace?.id || "";
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

function mapTopEntries(mapObject, limit = 4) {
  return Object.entries(mapObject)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function ageInDays(isoValue) {
  const time = new Date(isoValue).getTime();
  if (!Number.isFinite(time)) {
    return null;
  }

  const diff = Date.now() - time;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
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

function normalizeInsightSignal(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNormalizedSignalSet(values = []) {
  return new Set(values.map((value) => normalizeInsightSignal(value)).filter(Boolean));
}

function countSignalMatches(left = [], right = []) {
  const leftSet = toNormalizedSignalSet(left);
  const rightSet = toNormalizedSignalSet(right);
  let matches = 0;

  rightSet.forEach((value) => {
    if (leftSet.has(value)) {
      matches += 1;
    }
  });

  return matches;
}

function humanizeDataMode(value) {
  if (value === "source-derived") {
    return "Live public-source mode";
  }

  if (value === "persisted-fallback") {
    return "Persisted fallback mode";
  }

  if (value === "catalog-fallback" || value === "fallback") {
    return "Catalog fallback mode";
  }

  return value || "Unknown mode";
}

function formatFreshnessValue(days) {
  if (days === null || days === undefined) {
    return "Not synced";
  }

  return `${days} day${days === 1 ? "" : "s"}`;
}

function describeFreshness(days) {
  if (days === null || days === undefined) {
    return "No source-backed freshness timestamp is available yet.";
  }

  if (days <= 3) {
    return "Evidence is fresh enough for active operator review.";
  }

  if (days <= 7) {
    return "Evidence is recent and still suitable for near-term decisions.";
  }

  if (days <= 14) {
    return "Evidence is aging; refresh before customer-facing escalation.";
  }

  return "Refresh the source trail before relying on this view for execution.";
}

function createFactor(label, contribution, value, detail) {
  return {
    label,
    contribution,
    value,
    detail,
    direction: contribution > 0 ? "positive" : contribution < 0 ? "negative" : "neutral",
  };
}

function dedupeActions(actions = [], limit = 3) {
  const seen = new Set();

  return actions
    .filter((action) => action && action.label && action.detail)
    .filter((action) => {
      const key = `${action.label}::${action.detail}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function getLatestCheckedAt(items = []) {
  const timestamps = items
    .map((item) => item?.checkedAt || item?.createdAt || null)
    .filter(Boolean)
    .sort();

  return timestamps.at(-1) || null;
}

function buildTrendSeries(records, keys) {
  const byDay = new Map();

  records.forEach((record) => {
    const day = record.day || String(record.createdAt || "").slice(0, 10);

    if (!day) {
      return;
    }

    const existing = byDay.get(day);

    if (!existing || new Date(record.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      byDay.set(day, record);
    }
  });

  return [...byDay.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([day, record]) => {
      const point = { day };

      keys.forEach((key) => {
        point[key] = safeNumber(record.payload?.[key], 0);
      });

      return point;
    });
}

function buildMetricTimeline(records, valueKey, detailBuilder) {
  return records.map((record) => ({
    day: record.day,
    value: safeNumber(record.payload?.[valueKey], 0),
    detail: typeof detailBuilder === "function" ? detailBuilder(record.payload || {}, record) : "",
  }));
}

function summarizeSourceHealth(sources = []) {
  const items = sources.map((item) => ({
    key: item.key,
    label: item.label,
    status: item.status,
    checkedAt: item.checkedAt,
    ageDays: ageInDays(item.checkedAt),
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
      if (item.ageDays === null || item.ageDays <= 2) {
        return "fresh";
      }

      if (item.ageDays <= 7) {
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
  const trustFunnel = [
    { stage: "Identified", value: inventory.items.length },
    { stage: "Registry-matched", value: inventory.items.filter((profile) => (profile.officialEvidenceCount || 0) > 0).length },
    { stage: "Compliance-complete", value: inventory.items.filter((profile) => profile.evidenceScore >= 75).length },
    { stage: "Tender-ready", value: inventory.items.filter((profile) => profile.tenderFit >= 75).length },
    { stage: "Export-ready", value: inventory.items.filter((profile) => profile.exportReadiness >= 75).length },
  ];
  const freshnessBuckets = countBy(inventory.items, (profile) => {
    if (profile.freshnessDays <= 7) {
      return "0-7 days";
    }

    if (profile.freshnessDays <= 14) {
      return "8-14 days";
    }

    if (profile.freshnessDays <= 30) {
      return "15-30 days";
    }

    return "30+ days";
  });
  const confidenceMix = countBy(inventory.items, (profile) => profile.dataConfidence);

  return {
    profileId: PRODUCT_DEFAULT_PROFILES.verifysme,
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
    confidenceMix,
    trustFunnel,
    freshnessBuckets,
    dataMode: inventory.mode,
  };
}

function getActiveTenderProfile(profileId = PRODUCT_DEFAULT_PROFILES.tenderradar) {
  return tenderProfiles.find((profile) => profile.id === profileId) || tenderProfiles[0];
}

function getActiveExportProfile(profileId = PRODUCT_DEFAULT_PROFILES.exportpulse) {
  return exportProfiles.find((profile) => profile.id === profileId) || exportProfiles[0];
}

function findLinkedSupplierForTenderProfile(profile) {
  if (!profile) {
    return null;
  }

  const profileLabel = String(profile.label || "").toLowerCase();
  return (
    supplierProfiles.find((item) => profileLabel.includes(String(item.name || "").toLowerCase()))
    || null
  );
}

function scoreTenderInventory({ sources, profile, filters, verifyState }) {
  const evidenceContext = buildSupplierEvidenceContext(verifyState, findLinkedSupplierForTenderProfile(profile)?.id);
  const inventory = buildLiveTenderInventory({ sources, fallback: tenderOpportunities });
  const scored = buildRadarView(inventory.items, profile)
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
  const sectorFilter = normalizeFilterValue(filters?.sector);
  const stateFilter = normalizeFilterValue(filters?.state);
  const fitFilter = normalizeFilterValue(filters?.fitBand);

  return {
    mode: inventory.mode,
    sourcesUsed: inventory.sourcesUsed || [],
    evidenceContext,
    allItems: scored,
    items: scored.filter((item) => {
      if (sectorFilter && item.sector !== sectorFilter) {
        return false;
      }

      if (stateFilter && item.state !== stateFilter) {
        return false;
      }

      if (fitFilter && item.analysis.fitBand !== fitFilter) {
        return false;
      }

      return true;
    }),
  };
}

function scoreExportInventory({ sources, supplier, profile, filters, verifyState }) {
  const evidenceContext = buildSupplierEvidenceContext(verifyState, supplier?.id);
  const inventory = buildLiveExportInventory({
    sources,
    supplier,
    profile,
    fallback: exportOpportunities,
  });
  const base = buildExportOpportunityView(inventory.items, supplier)
    .map((item) => ({
      ...item,
      analysis: applyCompanyEvidenceToRouteScore(item, item.analysis, evidenceContext),
    }))
    .sort((left, right) => right.analysis.totalScore - left.analysis.totalScore);
  const readinessFilter = normalizeFilterValue(filters?.readinessBand);
  const sectorFilter = normalizeFilterValue(filters?.sector);
  const stateFilter = normalizeFilterValue(filters?.state);

  return {
    mode: inventory.mode,
    sourcesUsed: inventory.sourcesUsed || [],
    evidenceContext,
    allItems: base,
    items: base.filter((item) => {
      if (sectorFilter && item.sector !== sectorFilter) {
        return false;
      }

      if (stateFilter && item.region !== stateFilter && item.market !== stateFilter) {
        return false;
      }

      if (readinessFilter && item.analysis.readinessBand !== readinessFilter) {
        return false;
      }

      return true;
    }),
  };
}

function buildTenderMetricPayload() {
  const profile = getActiveTenderProfile();
  const visible = buildRadarView(tenderOpportunities, profile);
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

function buildExportMetricPayload() {
  const profile = getActiveExportProfile();
  const supplier = supplierProfiles.find((item) => item.id === profile.supplierId) || supplierProfiles[0];
  const visible = buildExportOpportunityView(exportOpportunities, supplier);
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
      payload: buildTenderMetricPayload(),
      createdAt: syncedAt,
      syncId,
    },
    {
      id: createId("daily_metric"),
      metricKey: METRIC_KEYS.export,
      day,
      scope: "product",
      workspaceId: null,
      payload: buildExportMetricPayload(),
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

function mergeFilters(base, overrides) {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides || {}).filter(([, value]) => value !== undefined && value !== null),
    ),
  };
}

function getDateRange(searchParams) {
  return normalizeDateRange(searchParams.get("dateRange"));
}

function selectLatestDailyMetrics(records, metricKey, range) {
  const filtered = records
    .filter((record) => record.metricKey === metricKey)
    .filter((record) => isWithinRange(record.createdAt, range))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  const latestByDay = new Map();

  filtered.forEach((record) => {
    const existing = latestByDay.get(record.day);

    if (!existing || new Date(record.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latestByDay.set(record.day, record);
    }
  });

  return [...latestByDay.values()].sort((left, right) => left.day.localeCompare(right.day));
}

function buildSourceReliabilityCharts(sources, sourceHistory) {
  const sourceItems = sources.length
    ? sources.map((item) => ({
        sourceKey: item.key,
        label: item.label,
        status: item.status,
        checkedAt: item.checkedAt,
        ageDays: ageInDays(item.checkedAt),
        itemCount: safeNumber(item.itemCount, 0),
        note: item.note || "",
        evidence: item.evidence || "",
      }))
    : [
        {
          sourceKey: "no-sources",
          label: "No synced sources yet",
          status: "unknown",
          checkedAt: nowIso(),
          ageDays: null,
          itemCount: 0,
          note: "Run source sync to load live evidence.",
          evidence: "",
        },
      ];

  const reliabilityCounts = countBy(sourceItems, (item) => item.status);
  const sourceReliability = [
    { label: "Live", value: reliabilityCounts.live || 0 },
    { label: "Restricted", value: reliabilityCounts.restricted || 0 },
    { label: "Error", value: reliabilityCounts.error || 0 },
    { label: "Unknown", value: reliabilityCounts.unknown || 0 },
  ].filter((item) => item.value > 0 || item.label === "Unknown");

  return {
    sourceItems,
    sourceReliability,
    historyBySource: sourceHistory.reduce((accumulator, item) => {
      if (!accumulator[item.sourceKey]) {
        accumulator[item.sourceKey] = [];
      }

      accumulator[item.sourceKey].push({
        checkedAt: item.checkedAt,
        status: item.status,
        itemCount: item.itemCount,
        createdAt: item.createdAt,
      });
      return accumulator;
    }, {}),
  };
}

function readWorkspaceStateFromDb(states = [], workspaceId, namespace) {
  if (!workspaceId) {
    return null;
  }

  return states.find((item) => item.workspaceId === workspaceId && item.namespace === namespace)?.value || null;
}

function buildVerifyInsightResponse({ sources, sourceHistory, dailyMetrics, workspaceState, filters, workspaceId }) {
  const state = workspaceState || {};
  const selectedProfileId = filters.profileId || state.selectedSupplierId || PRODUCT_DEFAULT_PROFILES.verifysme;
  const mergedFilters = mergeFilters({
    searchTerm: "",
    sector: "",
    state: "",
    lowRiskOnly: false,
    exportReadyOnly: false,
    tenderReadyOnly: false,
  }, {
    ...(state.filters || {}),
    searchTerm: filters.searchTerm ?? state.filters?.searchTerm,
    sector: filters.sector,
    state: filters.state,
    lowRiskOnly: filters.lowRiskOnly !== undefined ? normalizeBooleanParam(filters.lowRiskOnly) : state.filters?.lowRiskOnly,
    exportReadyOnly:
      filters.exportReadyOnly !== undefined
        ? normalizeBooleanParam(filters.exportReadyOnly)
        : state.filters?.exportReadyOnly,
    tenderReadyOnly:
      filters.tenderReadyOnly !== undefined
        ? normalizeBooleanParam(filters.tenderReadyOnly)
        : state.filters?.tenderReadyOnly,
  });
  const fitBand = normalizeFilterValue(filters.fitBand);
  const inventory = buildLiveSupplierInventory({
    sources,
    profiles: mergeSupplierCatalog(supplierProfiles, state.workspaceSuppliers || []),
    verifyState: state,
  });
  const rawFiltered = filterSuppliers(inventory.items, mergedFilters);
  const filtered =
    fitBand
      ? rawFiltered.filter((profile) => getBand(getCompositeScore(profile)) === fitBand)
      : rawFiltered;
  const selected = filtered.find((profile) => profile.id === selectedProfileId) || filtered[0] || inventory.items[0] || supplierProfiles[0];
  const shortlistProfiles = inventory.items.filter((profile) => (state.shortlistIds || []).includes(profile.id));
  const kpis = getKpis(filtered, state.shortlistIds || []);
  const sectorSummary = getSectorSummary(filtered);
  const stateSummary = getStateSummary(filtered);
  const riskSummary = getRiskSummary(filtered);
  const workflowSummary = countBy(shortlistProfiles, (profile) => state.workflow?.[profile.id] || "New candidate");
  const sourceCharts = buildSourceReliabilityCharts(sources, sourceHistory);
  const verifyHistory = selectLatestDailyMetrics(dailyMetrics, METRIC_KEYS.verify, getDateRange(filters.searchParams));
  const queueAgingTimeline = verifyHistory.length
    ? buildMetricTimeline(
        verifyHistory,
        "shortlistCount",
        (payload) => `${safeNumber(payload.averageTrust, 0)}/100 avg trust · ${safeNumber(payload.exportReady, 0)} export-ready`,
      )
    : [
        { bucket: "New candidate", count: workflowSummary["New candidate"] || 0 },
        { bucket: "Diligence", count: workflowSummary.Diligence || 0 },
        { bucket: "Sample check", count: workflowSummary["Sample check"] || 0 },
        { bucket: "Commercial review", count: workflowSummary["Commercial review"] || 0 },
      ];
  const selectedFactors = selected
    ? [
        createFactor(
          "Trust score",
          Math.round((safeNumber(selected.trustScore, 0) - 60) / 2),
          `${safeNumber(selected.trustScore, 0)}/100`,
          safeNumber(selected.trustScore, 0) >= 75
            ? "Trust score is strong enough for shortlist review."
            : "Trust score still needs strengthening before confident engagement.",
        ),
        createFactor(
          "Evidence depth",
          Math.round((safeNumber(selected.evidenceScore, 0) - 50) / 2),
          `${safeNumber(selected.evidenceScore, 0)}/100`,
          `${safeNumber(selected.officialEvidenceCount, 0)} official evidence points are currently bound.`,
        ),
        createFactor(
          "Tender readiness",
          Math.round((safeNumber(selected.tenderFit, 0) - 50) / 4),
          `${safeNumber(selected.tenderFit, 0)}/100`,
          "Downstream bid qualification strength from the same supplier record.",
        ),
        createFactor(
          "Export readiness",
          Math.round((safeNumber(selected.exportReadiness, 0) - 50) / 4),
          `${safeNumber(selected.exportReadiness, 0)}/100`,
          "Downstream route-readiness signal from the same supplier record.",
        ),
        createFactor(
          "Evidence freshness",
          selected.freshnessDays <= 7 ? 16 : selected.freshnessDays <= 14 ? 8 : -8,
          formatFreshnessValue(selected.freshnessDays),
          describeFreshness(selected.freshnessDays),
        ),
        createFactor(
          "Risk band",
          selected.riskBand === "Low" ? 18 : selected.riskBand === "Medium" ? 4 : -14,
          selected.riskBand,
          selected.riskBand === "Low"
            ? "Risk posture is supportive for procurement engagement."
            : "Risk posture still requires active diligence before engagement.",
        ),
      ]
    : [];
  const nextActions = dedupeActions(
    [
      !selected || safeNumber(selected.officialEvidenceCount, 0) === 0
        ? {
            label: "Bind official evidence",
            detail: `Use assisted MCA and Udyam workflows to move ${selected?.name || "the supplier"} into a defensible diligence state.`,
          }
        : null,
      selected && selected.freshnessDays > 14
        ? {
            label: "Refresh supplier evidence",
            detail: `Evidence for ${selected.name} is aging. Refresh the source trail before relying on it for buyer-facing decisions.`,
          }
        : null,
      selected && safeNumber(selected.tenderFit, 0) >= 75
        ? {
            label: "Open TenderRadar handoff",
            detail: `${selected.name} is strong enough to evaluate against live procurement opportunities next.`,
          }
        : null,
      selected && safeNumber(selected.exportReadiness, 0) >= 75
        ? {
            label: "Open ExportPulse handoff",
            detail: `${selected.name} is ready enough to test export route viability from the same record.`,
          }
        : null,
      selected && Array.isArray(selected.concerns) && selected.concerns[0]
        ? {
            label: "Resolve top diligence concern",
            detail: selected.concerns[0],
          }
        : null,
    ],
    4,
  );
  const highlightItems = [
    {
      label: "Suppliers in scope",
      value: kpis.supplierCount,
      detail: `${kpis.shortlistCount} shortlisted in this workspace`,
    },
    {
      label: "Average trust",
      value: `${kpis.averageTrust}/100`,
      detail: `${kpis.exportReady} export-ready, ${kpis.tenderReady} tender-ready`,
    },
    {
      label: "Low-risk suppliers",
      value: filtered.filter((profile) => profile.riskBand === "Low").length,
      detail: `${filtered.filter((profile) => profile.dataConfidence === "High").length} with high confidence`,
    },
    {
      label: "Source history",
      value: sourceHistory.length,
      detail: `${dailyMetrics.length} metric snapshots persisted`,
    },
  ];

  return {
    product: "verifysme",
    generatedAt: nowIso(),
    filters: {
      workspaceId: workspaceId || "",
      dateRange: filters.dateRange.label,
      sector: mergedFilters.sector || "",
      state: mergedFilters.state || "",
      profileId: selectedProfileId,
      fitBand: fitBand || "",
      readinessBand: "",
    },
    summary: {
      subject: selected?.name || "VerifySME supplier set",
      decision: selected ? `Can ${selected.name} be trusted enough to engage?` : "Which suppliers deserve deeper diligence first?",
      visibleCount: filtered.length,
      shortlistedCount: shortlistProfiles.length,
      dataMode: inventory.mode,
      dataModeLabel: humanizeDataMode(
        inventory.mode === "source-derived"
          ? "source-derived"
          : verifyHistory.length
            ? "persisted-fallback"
            : "fallback",
      ),
      confidence: selected?.dataConfidence || "Unknown",
      freshness: selected ? formatFreshnessValue(selected.freshnessDays) : "Not synced",
      latestCheckedAt: getLatestCheckedAt(sourceCharts.sourceItems),
    },
    highlights: highlightItems,
    charts: {
      trustFunnel: {
        type: "funnel",
        data: [
          { stage: "Identified", value: inventory.items.length },
          { stage: "Registry-matched", value: inventory.items.filter((profile) => (profile.officialEvidenceCount || 0) > 0).length },
          { stage: "Compliance-complete", value: inventory.items.filter((profile) => profile.evidenceScore >= 75).length },
          { stage: "Tender-ready", value: inventory.items.filter((profile) => profile.tenderFit >= 75).length },
          { stage: "Export-ready", value: inventory.items.filter((profile) => profile.exportReadiness >= 75).length },
        ],
      },
      evidenceFreshness: {
        type: "heatmap",
        data: sourceCharts.sourceItems.map((item) => ({
          sourceKey: item.sourceKey,
          label: item.label,
          status: item.status,
          ageDays: item.ageDays,
          itemCount: item.itemCount,
        })),
      },
      riskBySector: {
        type: "bar",
        data: sectorSummary,
      },
      queueAging: {
        type: verifyHistory.length ? "timeline" : "bar",
        data: queueAgingTimeline,
      },
      entityConfidence: {
        type: "donut",
        data: Object.entries(countBy(filtered, (profile) => profile.dataConfidence)).map(([label, value]) => ({
          label,
          value,
        })),
      },
      factorContributions: {
        type: "bar",
        data: selectedFactors.map((factor) => ({
          label: factor.label,
          value: Math.abs(factor.contribution),
          direction: factor.direction,
          detail: factor.detail,
          valueText: factor.value,
        })),
      },
    },
    tables: {
      selectedSupplier: selected
        ? {
            id: selected.id,
            name: selected.name,
            sector: selected.sector,
            state: selected.state,
            trustScore: selected.trustScore,
            exportReadiness: selected.exportReadiness,
            tenderFit: selected.tenderFit,
            freshnessDays: selected.freshnessDays,
          }
        : null,
      shortlist: shortlistProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        compositeScore: getCompositeScore(profile),
        riskBand: profile.riskBand,
      })),
    },
    entities: {
      mode: inventory.mode,
      sourcesUsed: inventory.sourcesUsed,
      inventory: inventory.items,
      visible: filtered,
      selected,
    },
    provenance: {
      sourceSummary: buildSourceSummary(sources),
      sourceHistoryCount: sourceHistory.length,
      metricCount: dailyMetrics.length,
      latestMetricAt: verifyHistory.at(-1)?.createdAt || null,
      dataMode:
        inventory.mode === "source-derived"
          ? "source-derived"
          : verifyHistory.length
            ? "persisted-fallback"
            : "fallback",
    },
    explainability: {
      headline: selected
        ? `Why ${selected.name} scores the way it does`
        : "Why the current VerifySME slice scores the way it does",
      factors: selectedFactors,
    },
    nextActions,
  };
}

function buildTenderInsightResponse({ sources, sourceHistory, dailyMetrics, workspaceState, verifyState, filters, workspaceId }) {
  const state = workspaceState || {};
  const selectedProfileId = filters.profileId || state.profileId || PRODUCT_DEFAULT_PROFILES.tenderradar;
  const profile = tenderProfiles.find((item) => item.id === selectedProfileId) || tenderProfiles[0];
  const sectorFilter = normalizeFilterValue(filters.sector);
  const stateFilter = normalizeFilterValue(filters.state);
  const fitFilter = normalizeFilterValue(filters.fitBand);
  const liveInventory = scoreTenderInventory({
    sources,
    profile,
    filters,
    verifyState,
  });
  const visible = liveInventory.items;
  const summary = summarizeRadar(visible);
  const shortlistIds = new Set(state.shortlistIds || []);
  const workflowMap = state.workflow || {};
  const gapSummary = countBy(
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
  const urgencyBuckets = countBy(visible, (item) => item.analysis.urgency);
  const ticketScatter = visible.map((item) => ({
    id: item.id,
    title: item.title,
    valueCrore: item.estimatedValueCrore,
    turnoverCrore: profile.annualTurnoverCrore,
    score: item.analysis.totalScore,
    fitBand: item.analysis.fitBand,
    soloBidEligible: item.analysis.soloBidEligible,
  }));
  const sourceCharts = buildSourceReliabilityCharts(sources, sourceHistory);
  const tenderHistory = selectLatestDailyMetrics(dailyMetrics, METRIC_KEYS.tender, getDateRange(filters.searchParams));
  const closingBuckets = tenderHistory.length
    ? buildMetricTimeline(
        tenderHistory,
        "closingSoon",
        (payload) => `${safeNumber(payload.matchedCount, 0)} matched · ${safeNumber(payload.highFit, 0)} high-fit`,
      )
    : [
        {
          bucket: "0-7 days",
          count: visible.filter((item) => item.analysis.daysLeft <= 7).length,
        },
        {
          bucket: "8-14 days",
          count: visible.filter((item) => item.analysis.daysLeft > 7 && item.analysis.daysLeft <= 14).length,
        },
        {
          bucket: "15-30 days",
          count: visible.filter((item) => item.analysis.daysLeft > 14 && item.analysis.daysLeft <= 30).length,
        },
        {
          bucket: "30+ days",
          count: visible.filter((item) => item.analysis.daysLeft > 30).length,
        },
      ];
  const selectedTender = visible[0] || liveInventory.allItems[0] || null;
  const scopeMatches = countSignalMatches(profile.categories || [], [selectedTender?.sector, selectedTender?.category]);
  const credentialMatches = countSignalMatches(profile.credentials || [], selectedTender?.requiredCredentials || []);
  const selectedFactors = selectedTender
    ? [
        createFactor(
          "Scope alignment",
          scopeMatches > 0 ? 18 : -10,
          scopeMatches ? `${scopeMatches} matched signal${scopeMatches === 1 ? "" : "s"}` : "No clear scope match",
          selectedTender.analysis.reasons[0] || "Compare the profile categories against the tender scope.",
        ),
        createFactor(
          "Turnover coverage",
          safeNumber(profile.annualTurnoverCrore, 0) >= safeNumber(selectedTender.minTurnoverCrore, 0) ? 16 : -14,
          `${safeNumber(profile.annualTurnoverCrore, 0)} Cr vs ${safeNumber(selectedTender.minTurnoverCrore, 0)} Cr`,
          safeNumber(profile.annualTurnoverCrore, 0) >= safeNumber(selectedTender.minTurnoverCrore, 0)
            ? "Visible turnover clears the published threshold."
            : "Visible turnover is below the published threshold.",
        ),
        createFactor(
          "Past-project fit",
          safeNumber(profile.pastProjectsCount, 0) >= safeNumber(selectedTender.minPastProjects, 0) ? 12 : -12,
          `${safeNumber(profile.pastProjectsCount, 0)} vs ${safeNumber(selectedTender.minPastProjects, 0)}`,
          safeNumber(profile.pastProjectsCount, 0) >= safeNumber(selectedTender.minPastProjects, 0)
            ? "Past-project count supports a solo bid posture."
            : "Project-history depth may force a partner path or a no-bid decision.",
        ),
        createFactor(
          "Credential overlap",
          credentialMatches > 0 ? 10 : -8,
          `${credentialMatches} matched credential${credentialMatches === 1 ? "" : "s"}`,
          selectedTender.requiredCredentials?.length
            ? `Required credentials: ${selectedTender.requiredCredentials.join(", ")}`
            : "No explicit credential list was parsed from the tender summary.",
        ),
        createFactor(
          "Deadline pressure",
          selectedTender.analysis.daysLeft <= 7 ? -10 : selectedTender.analysis.daysLeft <= 21 ? 4 : 10,
          `${selectedTender.analysis.daysLeft} days`,
          `Urgency is currently ${selectedTender.analysis.urgency}.`,
        ),
      ]
    : [];
  const nextActions = dedupeActions(
    [
      selectedTender && selectedTender.analysis.gaps[0]
        ? {
            label: "Resolve the top qualification gap",
            detail: selectedTender.analysis.gaps[0],
          }
        : null,
      selectedTender && selectedTender.analysis.daysLeft <= 7
        ? {
            label: "Prioritize deadline review",
            detail: `${selectedTender.title} is closing soon and needs immediate bid/no-bid clarity.`,
          }
        : null,
      selectedTender && !selectedTender.analysis.soloBidEligible
        ? {
            label: "Check partner path",
            detail: "The tender does not currently look solo-bid eligible, so partner coverage should be evaluated explicitly.",
          }
        : null,
      selectedTender
        ? {
            label: "Open supplier diligence",
            detail: "Use VerifySME if the supplier trust or documentation picture needs more depth before bidding.",
          }
        : null,
    ],
    4,
  );
  const highlightItems = [
    {
      label: "Eligible tenders",
      value: summary.counts.matched,
      detail: `${summary.counts.highFit} high-fit opportunities · ${liveInventory.mode === "source-derived" ? "live public feed" : "catalog fallback"}`,
    },
    {
      label: "Closing soon",
      value: summary.counts.closingSoon,
      detail: "Due in the next 7 days or less",
    },
    {
      label: "Average value",
      value: `${summary.averageValueCrore.toFixed(1)} Cr`,
      detail: `${summary.counts.shortlistReady} shortlist-ready`,
    },
    {
      label: "Saved shortlist",
      value: shortlistIds.size,
      detail: `${visible.filter((item) => shortlistIds.has(item.id)).length} match the current filter`,
    },
  ];

  return {
    product: "tenderradar",
    generatedAt: nowIso(),
    filters: {
      workspaceId: workspaceId || "",
      dateRange: filters.dateRange.label,
      sector: sectorFilter || "",
      state: stateFilter || "",
      profileId: profile.id,
      fitBand: fitFilter || "",
      readinessBand: "",
    },
    summary: {
      subject: profile.label,
      decision: selectedTender?.title || "Which tender deserves bid-desk time next?",
      visibleCount: visible.length,
      shortlistedCount: [...shortlistIds].filter((id) => visible.some((item) => item.id === id)).length,
      dataMode: liveInventory.mode,
      dataModeLabel: humanizeDataMode(
        liveInventory.mode === "source-derived" ? "source-derived" : tenderHistory.length ? "persisted-fallback" : "fallback",
      ),
      averageValue: `${summary.averageValueCrore.toFixed(1)} Cr`,
      latestCheckedAt: getLatestCheckedAt(sourceCharts.sourceItems),
    },
    highlights: highlightItems,
    charts: {
      qualificationFunnel: {
        type: "funnel",
        data: [
          { stage: "Discovered", value: liveInventory.allItems.length },
          { stage: "Eligible", value: liveInventory.allItems.filter((item) => item.analysis.fitBand !== "Low fit").length },
          { stage: "Shortlisted", value: [...shortlistIds].filter((id) => visible.some((item) => item.id === id)).length },
          { stage: "In bid review", value: countBy(Object.values(workflowMap), (value) => value)["Bid review"] || 0 },
          { stage: "Submitted", value: countBy(Object.values(workflowMap), (value) => value)["Bid pack"] || 0 },
        ],
      },
      closingBuckets: {
        type: tenderHistory.length ? "timeline" : "bar",
        data: closingBuckets,
      },
      eligibilityGaps: {
        type: "bar",
        data: mapTopEntries(gapSummary, 6),
      },
      valueVsCapacity: {
        type: "scatter",
        data: ticketScatter,
      },
      buyerConcentration: {
        type: "bar",
        data: mapTopEntries(summary.buyerMix, 4),
      },
      sourceReliability: {
        type: "bar",
        data: sourceCharts.sourceReliability,
      },
      urgencyMix: {
        type: "bar",
        data: Object.entries(urgencyBuckets).map(([label, value]) => ({ label, value })),
      },
      factorContributions: {
        type: "bar",
        data: selectedFactors.map((factor) => ({
          label: factor.label,
          value: Math.abs(factor.contribution),
          direction: factor.direction,
          detail: factor.detail,
          valueText: factor.value,
        })),
      },
    },
    tables: {
      topBids: visible.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        buyer: item.buyer,
        source: item.source,
        fitBand: item.analysis.fitBand,
        score: item.analysis.totalScore,
        daysLeft: item.analysis.daysLeft,
      })),
    },
    entities: {
      mode: liveInventory.mode,
      sourcesUsed: liveInventory.sourcesUsed,
      profile: {
        id: profile.id,
        label: profile.label,
        annualTurnoverCrore: profile.annualTurnoverCrore,
        credentials: profile.credentials,
        companySize: profile.companySize,
      },
      visible,
    },
    provenance: {
      sourceSummary: buildSourceSummary(sources),
      sourceHistoryCount: sourceHistory.length,
      metricCount: dailyMetrics.length,
      latestMetricAt: tenderHistory.at(-1)?.createdAt || null,
      dataMode: liveInventory.mode === "source-derived" ? "source-derived" : tenderHistory.length ? "persisted-fallback" : "fallback",
    },
    explainability: {
      headline: selectedTender
        ? `Why ${selectedTender.title} sits where it does`
        : "Why the current TenderRadar slice sits where it does",
      factors: selectedFactors,
    },
    nextActions,
  };
}

function buildExportInsightResponse({ sources, sourceHistory, dailyMetrics, workspaceState, verifyState, filters, workspaceId }) {
  const state = workspaceState || {};
  const selectedProfileId = filters.profileId || state.profileId || PRODUCT_DEFAULT_PROFILES.exportpulse;
  const profile = exportProfiles.find((item) => item.id === selectedProfileId) || exportProfiles[0];
  const supplier = supplierProfiles.find((item) => item.id === profile.supplierId) || supplierProfiles[0];
  const readinessFilter = normalizeFilterValue(filters.readinessBand);
  const sectorFilter = normalizeFilterValue(filters.sector);
  const stateFilter = normalizeFilterValue(filters.state);
  const liveInventory = scoreExportInventory({
    sources,
    supplier,
    profile,
    filters,
    verifyState,
  });
  const visible = liveInventory.items;
  const summary = summarizeExportWorkspace(visible);
  const shortlistIds = new Set(state.shortlistIds || []);
  const workflowMap = state.workflow || {};
  const blockerSummary = countBy(
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
  const marginRiskFrontier = visible.map((item) => ({
    id: item.id,
    market: item.market,
    marginBand: item.marginBand,
    score: item.analysis.totalScore,
    readinessBand: item.analysis.readinessBand,
    readinessThreshold: item.readinessThreshold,
  }));
  const sourceCharts = buildSourceReliabilityCharts(sources, sourceHistory);
  const exportHistory = selectLatestDailyMetrics(dailyMetrics, METRIC_KEYS.export, getDateRange(filters.searchParams));
  const noticeTimeline = visible
    .flatMap((item) => item.sourceNotices || [])
    .slice(0, 8)
    .map((notice) => ({
      noticeDate: notice.noticeDate,
      title: notice.title,
      pdfUrl: notice.pdfUrl,
      impactTag: profile.focus,
    }));
  const actionBurnup = exportHistory.length
    ? buildMetricTimeline(
        exportHistory,
        "actionCount",
        (payload) => `${safeNumber(payload.readyNow, 0)} ready now · ${safeNumber(payload.highMargin, 0)} high-margin`,
      )
    : [
        { label: "Route review", value: countBy(Object.values(workflowMap), (value) => value)["Route review"] || 0 },
        { label: "Docs fix", value: countBy(Object.values(workflowMap), (value) => value)["Docs fix"] || 0 },
        { label: "Buyer outreach", value: countBy(Object.values(workflowMap), (value) => value)["Buyer outreach"] || 0 },
        { label: "Pilot order", value: countBy(Object.values(workflowMap), (value) => value)["Pilot order"] || 0 },
        { label: "Action count", value: visible.reduce((sum, item) => sum + item.nextActions.length, 0) },
      ];
  const selectedRoute = visible[0] || liveInventory.allItems[0] || null;
  const thresholdGap = selectedRoute
    ? safeNumber(selectedRoute.analysis.totalScore, 0) - safeNumber(selectedRoute.readinessThreshold, 0)
    : 0;
  const selectedFactors = selectedRoute
    ? [
        createFactor(
          "Readiness score",
          thresholdGap >= 0 ? 18 : -10,
          `${safeNumber(selectedRoute.analysis.totalScore, 0)}/100`,
          thresholdGap >= 0
            ? "The route is at or above the stated readiness threshold."
            : "The route is still below the stated readiness threshold.",
        ),
        createFactor(
          "Direct market match",
          selectedRoute.analysis.directMatch ? 12 : -6,
          selectedRoute.analysis.directMatch ? "Direct match" : "No direct match",
          selectedRoute.analysis.directMatch
            ? "This supplier profile already points at the market directly."
            : "The market is plausible, but not a direct fit yet.",
        ),
        createFactor(
          "Margin band",
          selectedRoute.marginBand === "High" ? 12 : selectedRoute.marginBand === "Medium" ? 6 : -4,
          selectedRoute.marginBand,
          `${selectedRoute.channelModel} route with ${selectedRoute.marginBand.toLowerCase()} margin characteristics.`,
        ),
        createFactor(
          "Blocker pressure",
          selectedRoute.analysis.blockers.length === 0 ? 10 : -Math.min(selectedRoute.analysis.blockers.length * 5, 15),
          `${selectedRoute.analysis.blockers.length} blocker${selectedRoute.analysis.blockers.length === 1 ? "" : "s"}`,
          selectedRoute.analysis.blockers[0] || "No explicit blocker is visible in the current route record.",
        ),
        createFactor(
          "Supplier readiness",
          safeNumber(supplier.exportReadiness, 0) >= 75 ? 10 : -6,
          `${safeNumber(supplier.exportReadiness, 0)}/100`,
          "The upstream supplier profile still affects route viability and speed to launch.",
        ),
      ]
    : [];
  const nextActions = dedupeActions(
    [
      ...(selectedRoute?.nextActions || []).map((action) => ({
        label: "Route action",
        detail: action,
      })),
      selectedRoute?.analysis?.blockers?.[0]
        ? {
            label: "Resolve the top route blocker",
            detail: selectedRoute.analysis.blockers[0],
          }
        : null,
      selectedRoute && !selectedRoute.analysis.directMatch
        ? {
            label: "Validate market proof",
            detail: `The ${selectedRoute.market} route needs stronger proof before launch confidence improves.`,
          }
        : null,
    ],
    4,
  );
  const highlightItems = [
    {
      label: "Ready-now routes",
      value: summary.readyNow,
      detail: `${summary.total} routes assessed · ${liveInventory.mode === "source-derived" ? "live DGFT-derived route briefs" : "catalog fallback"}`,
    },
    {
      label: "High-margin routes",
      value: summary.highMargin,
      detail: `${summary.directMarketMatches} direct-market matches`,
    },
    {
      label: "Action items",
      value: visible.reduce((sum, item) => sum + item.nextActions.length, 0),
      detail: `${profile.label} profile selected`,
    },
    {
      label: "Source history",
      value: sourceHistory.length,
      detail: `${dailyMetrics.length} metric snapshots persisted`,
    },
  ];

  return {
    product: "exportpulse",
    generatedAt: nowIso(),
    filters: {
      workspaceId: workspaceId || "",
      dateRange: filters.dateRange.label,
      sector: sectorFilter || "",
      state: stateFilter || "",
      profileId: profile.id,
      fitBand: "",
      readinessBand: readinessFilter || "",
    },
    summary: {
      subject: profile.label,
      decision: selectedRoute?.market || "Which route can we actually launch next?",
      visibleCount: visible.length,
      shortlistedCount: [...shortlistIds].filter((id) => visible.some((item) => item.id === id)).length,
      dataMode: liveInventory.mode,
      dataModeLabel: humanizeDataMode(
        liveInventory.mode === "source-derived" ? "source-derived" : exportHistory.length ? "persisted-fallback" : "fallback",
      ),
      averageScore: `${summary.averageScore}/100`,
      latestCheckedAt: getLatestCheckedAt(sourceCharts.sourceItems),
    },
    highlights: highlightItems,
    charts: {
      readinessMatrix: {
        type: "matrix",
        data: visible.map((item) => ({
          id: item.id,
          market: item.market,
          region: item.region,
          readinessBand: item.analysis.readinessBand,
          score: item.analysis.totalScore,
          marginBand: item.marginBand,
          threshold: item.readinessThreshold,
          channelModel: item.channelModel,
        })),
      },
      blockerMix: {
        type: "bar",
        data: mapTopEntries(blockerSummary, 6),
      },
      noticeTimeline: {
        type: "timeline",
        data: noticeTimeline.length
          ? noticeTimeline
          : [
              {
                noticeDate: nowIso().slice(0, 10),
                title: "No DGFT notices synced yet",
                pdfUrl: "",
                impactTag: profile.focus,
              },
            ],
      },
      marginRiskFrontier: {
        type: "scatter",
        data: marginRiskFrontier,
      },
      actionBurnup: {
        type: exportHistory.length ? "timeline" : "bar",
        data: actionBurnup,
      },
      marketMix: {
        type: "bar",
        data: getExportTopEntries(buildMarketMix(visible), 4),
      },
      sourceReliability: {
        type: "bar",
        data: sourceCharts.sourceReliability,
      },
      factorContributions: {
        type: "bar",
        data: selectedFactors.map((factor) => ({
          label: factor.label,
          value: Math.abs(factor.contribution),
          direction: factor.direction,
          detail: factor.detail,
          valueText: factor.value,
        })),
      },
    },
    tables: {
      topRoutes: visible.slice(0, 5).map((item) => ({
        id: item.id,
        market: item.market,
        routeTitle: item.routeTitle || item.market,
        readinessBand: item.analysis.readinessBand,
        score: item.analysis.totalScore,
        directMatch: item.analysis.directMatch,
      })),
    },
    entities: {
      mode: liveInventory.mode,
      sourcesUsed: liveInventory.sourcesUsed,
      profile: {
        id: profile.id,
        label: profile.label,
        supplierId: profile.supplierId,
        channelModel: profile.channelModel,
        targetMarkets: profile.targetMarkets,
      },
      supplier: {
        id: supplier.id,
        name: supplier.name,
        sector: supplier.sector,
        exportReadiness: supplier.exportReadiness,
        certifications: supplier.certifications,
      },
      visible,
    },
    provenance: {
      sourceSummary: buildSourceSummary(sources),
      sourceHistoryCount: sourceHistory.length,
      metricCount: dailyMetrics.length,
      latestMetricAt: exportHistory.at(-1)?.createdAt || null,
      dataMode: liveInventory.mode === "source-derived" ? "source-derived" : exportHistory.length ? "persisted-fallback" : "fallback",
    },
    explainability: {
      headline: selectedRoute
        ? `Why ${selectedRoute.market} sits where it does`
        : "Why the current ExportPulse slice sits where it does",
      factors: selectedFactors,
    },
    nextActions,
  };
}

export async function buildProductInsightResponse(product, { sessionContext = null, searchParams = new URLSearchParams() } = {}) {
  if (product === "control-center") {
    return buildControlCenterInsightResponse({ sessionContext, searchParams });
  }

  const db = await readDb();
  const sources = db.sources || [];
  const sourceHistory = db.sourceHistory || [];
  const dailyMetrics = db.dailyMetrics || [];
  const requestedWorkspaceId = normalizeFilterValue(searchParams.get("workspaceId"));
  const workspaceId = getWorkspaceId(sessionContext, requestedWorkspaceId);
  const workspaceState = readWorkspaceStateFromDb(db.state || [], workspaceId, PRODUCT_NAMESPACES[product]);
  const verifyState = readWorkspaceStateFromDb(db.state || [], workspaceId, PRODUCT_NAMESPACES.verifysme);
  const filters = {
    workspaceId,
    dateRange: normalizeDateRange(searchParams.get("dateRange")),
    sector: normalizeFilterValue(searchParams.get("sector")),
    state: normalizeFilterValue(searchParams.get("state")),
    profileId: normalizeFilterValue(searchParams.get("profileId")),
    fitBand: normalizeFilterValue(searchParams.get("fitBand")),
    readinessBand: normalizeFilterValue(searchParams.get("readinessBand")),
    searchParams,
  };

  if (product === "verifysme") {
    return buildVerifyInsightResponse({
      sources,
      sourceHistory,
      dailyMetrics,
      workspaceState,
      filters,
      workspaceId,
    });
  }

  if (product === "tenderradar") {
    return buildTenderInsightResponse({
      sources,
      sourceHistory,
      dailyMetrics,
      workspaceState,
      verifyState,
      filters,
      workspaceId,
    });
  }

  if (product === "exportpulse") {
    return buildExportInsightResponse({
      sources,
      sourceHistory,
      dailyMetrics,
      workspaceState,
      verifyState,
      filters,
      workspaceId,
    });
  }

  const error = new Error(`Unknown insight product: ${product}`);
  error.statusCode = 404;
  throw error;
}
