import { formatTradeGraphAnalyticsEventLabel } from "./analytics.js";

const PRODUCT_LABELS = {
  verifysme: "VerifySME",
  tenderradar: "TenderRadar",
  exportpulse: "ExportPulse",
  ops: "Ops",
  tradegraph: "TradeGraph",
};

function normalizeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function splitAuditEntry(entry) {
  const raw = String(entry || "").trim();
  const separatorIndex = raw.indexOf("·");

  if (separatorIndex === -1) {
    return {
      timestampLabel: "",
      message: raw,
    };
  }

  return {
    timestampLabel: raw.slice(0, separatorIndex).trim(),
    message: raw.slice(separatorIndex + 1).trim(),
  };
}

function toIsoTimestamp(timestampLabel, fallbackTimestamp = "", orderOffset = 0) {
  const fallbackMs = Date.parse(fallbackTimestamp) || Date.now();
  const fallbackDate = new Date(fallbackMs);
  const year = fallbackDate.getFullYear();
  const variants = String(timestampLabel || "").trim()
    ? [
        String(timestampLabel || "").trim(),
        `${String(timestampLabel || "").trim()} ${year}`,
        `${String(timestampLabel || "").trim()}, ${year}`,
      ]
    : [];

  for (const candidate of variants) {
    const parsed = Date.parse(candidate);

    if (Number.isFinite(parsed)) {
      return new Date(parsed + orderOffset).toISOString();
    }
  }

  return new Date(fallbackMs + orderOffset).toISOString();
}

function classifyCaseMessage(message) {
  const lower = String(message || "").toLowerCase();

  if (lower.includes("evidence bound")) {
    return {
      kind: "evidence",
      badge: "Evidence",
    };
  }

  if (lower.includes("stage moved")) {
    return {
      kind: "stage",
      badge: "Stage",
    };
  }

  if (lower.includes("added")) {
    return {
      kind: "intake",
      badge: "Intake",
    };
  }

  return {
    kind: "case",
    badge: "Case",
  };
}

function classifyWorkspaceEvent(name) {
  const normalized = String(name || "").toLowerCase();

  if (normalized.startsWith("workspace_")) {
    return {
      kind: "workspace",
      badge: "Workspace",
    };
  }

  if (normalized.includes("billing")) {
    return {
      kind: "billing",
      badge: "Billing",
    };
  }

  if (normalized.includes("alert")) {
    return {
      kind: "alert",
      badge: "Alert",
    };
  }

  if (normalized.includes("source_sync")) {
    return {
      kind: "source",
      badge: "Source",
    };
  }

  return {
    kind: "activity",
    badge: "Activity",
  };
}

function buildCaseEntries(productKey, caseMap, subjectLookup = {}) {
  return Object.entries(normalizeRecord(caseMap)).flatMap(([caseId, caseRecord]) => {
    const normalizedCase = normalizeRecord(caseRecord);
    const auditLog = Array.isArray(normalizedCase.auditLog) ? normalizedCase.auditLog : [];
    const subject = subjectLookup[caseId] || caseId;
    const fallbackTimestamp = normalizedCase.lastUpdated || new Date().toISOString();

    return auditLog.map((entry, index) => {
      const parsed = splitAuditEntry(entry);
      const classification = classifyCaseMessage(parsed.message);

      return {
        id: `${productKey}:${caseId}:${index}`,
        source: PRODUCT_LABELS[productKey] || productKey,
        subject,
        title: parsed.message,
        detail: `${PRODUCT_LABELS[productKey] || productKey} · ${subject}`,
        badge: classification.badge,
        kind: classification.kind,
        createdAt: toIsoTimestamp(parsed.timestampLabel, fallbackTimestamp, index),
        createdLabel: parsed.timestampLabel || new Date(fallbackTimestamp).toLocaleString(),
      };
    });
  });
}

function normalizeWorkspaceActivityEntry(entry, index) {
  const normalized = normalizeRecord(entry);
  const name = normalized.name || normalized.label || normalized.event || "";
  const timestamp = normalized.createdAt || normalized.timestamp || normalized.at || "";
  const classification = classifyWorkspaceEvent(name);
  const product = String(normalized.valueText || normalized.product || "tradegraph").toLowerCase();
  const productLabel = PRODUCT_LABELS[product] || product || "TradeGraph";

  return {
    id: normalized.id || `activity:${name || "event"}:${index}`,
    source: productLabel,
    subject: productLabel,
    title: formatTradeGraphAnalyticsEventLabel(name || normalized.label || "tradegraph_activity"),
    detail:
      normalized.detail
      || normalized.context?.path
      || normalized.path
      || (product === "ops" ? "Workspace-scoped activity" : "Product activity"),
    badge: classification.badge,
    kind: classification.kind,
    createdAt: timestamp || new Date(Date.now() + index).toISOString(),
    createdLabel:
      timestamp && Number.isFinite(Date.parse(timestamp))
        ? new Date(timestamp).toLocaleString()
        : normalized.createdLabel || "Recent activity",
  };
}

export function buildWorkspaceActivityEntries(activity = []) {
  return (Array.isArray(activity) ? activity : [])
    .map((entry, index) => normalizeWorkspaceActivityEntry(entry, index))
    .filter((entry) => entry.title);
}

export function buildUnifiedAuditTimeline({
  verifyState = {},
  tenderState = {},
  exportState = {},
  activity = [],
  lookups = {},
  limit = 16,
} = {}) {
  const verifyEntries = buildCaseEntries("verifysme", normalizeRecord(verifyState).cases, lookups.verifysme);
  const tenderEntries = buildCaseEntries("tenderradar", normalizeRecord(tenderState).cases, lookups.tenderradar);
  const exportEntries = buildCaseEntries("exportpulse", normalizeRecord(exportState).cases, lookups.exportpulse);
  const activityEntries = buildWorkspaceActivityEntries(activity);

  return [...activityEntries, ...verifyEntries, ...tenderEntries, ...exportEntries]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, Math.max(Number(limit) || 0, 0));
}

export function summarizeUnifiedAudit(entries = []) {
  const timeline = Array.isArray(entries) ? entries : [];

  return {
    total: timeline.length,
    workspaceEvents: timeline.filter((entry) =>
      ["workspace", "alert", "billing", "source", "activity"].includes(entry.kind),
    ).length,
    caseEvents: timeline.filter((entry) =>
      ["case", "stage", "evidence", "intake"].includes(entry.kind),
    ).length,
    stageChanges: timeline.filter((entry) => entry.kind === "stage").length,
    evidenceBindings: timeline.filter((entry) => entry.kind === "evidence").length,
  };
}
