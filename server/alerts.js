import crypto from "node:crypto";

import { Resend } from "resend";

import {
  assertAlertCapacity,
  getPlanDefinition,
  getWorkspaceSubscription,
} from "./billing.js";
import { nowIso, readDb, updateDb } from "./persistence.js";

const ALERT_NAMESPACE_PREFIX = "alerts.delivery.";
const PRODUCT_SOURCE_DEFAULTS = {
  tenderradar: ["gem", "cppp"],
  exportpulse: ["dgft"],
  verifysme: ["mca", "udyam", "dgft", "gem"],
};

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function unique(values) {
  return [...new Set(values)];
}

function getDefaultRecipients() {
  return String(process.env.ALERT_DEFAULT_RECIPIENTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeRecipients(recipients = [], fallbackEmail = "") {
  const values = Array.isArray(recipients) ? recipients : String(recipients || "").split(",");
  return unique(
    values
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
      .concat(getDefaultRecipients())
      .concat(fallbackEmail ? [fallbackEmail.trim().toLowerCase()] : []),
  );
}

function normalizeKeywords(filters = {}) {
  const raw = Array.isArray(filters.keywords)
    ? filters.keywords
    : String(filters.query || "")
        .split(",")
        .map((item) => item.trim());

  return unique(raw.map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function normalizeSourceKeys(filters = {}, product = "tenderradar") {
  const selected = Array.isArray(filters.sourceKeys)
    ? filters.sourceKeys.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];
  return selected.length ? unique(selected) : PRODUCT_SOURCE_DEFAULTS[product] || ["gem", "cppp", "dgft"];
}

function buildItemSearchText(source, item) {
  return [
    source.key,
    source.label,
    item.externalId,
    item.bidNumber,
    item.title,
    item.category,
    item.ministry,
    item.department,
    item.organization,
    item.referenceNumber,
    item.tenderId,
    item.noticeDate,
    item.publishedAt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildItemTitle(item) {
  return item.title || item.category || item.bidNumber || item.referenceNumber || "Untitled item";
}

function buildItemMeta(item) {
  return [
    item.organization || item.ministry || null,
    item.department || null,
    item.noticeDate || item.publishedAt || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildItemUrl(item) {
  return item.detailUrl || item.documentUrl || item.pdfUrl || null;
}

function buildMatchKey(source, item) {
  return [
    source.key,
    item.externalId || item.bidNumber || item.tenderId || item.detailUrl || item.documentUrl || item.pdfUrl || item.title,
  ]
    .filter(Boolean)
    .join(":");
}

export function buildAlertMatches(rule, snapshots) {
  const keywords = normalizeKeywords(rule.filters);
  const sourceKeys = normalizeSourceKeys(rule.filters, rule.product);

  const matched = snapshots
    .filter((source) => sourceKeys.includes(String(source.key || "").toLowerCase()))
    .flatMap((source) =>
      (source.items || []).map((item) => {
        const text = buildItemSearchText(source, item);
        const keywordHits = keywords.length
          ? keywords.filter((keyword) => text.includes(keyword))
          : [String(rule.product || "workspace")];

        if (!keywordHits.length) {
          return null;
        }

        return {
          key: buildMatchKey(source, item),
          title: buildItemTitle(item),
          meta: buildItemMeta(item),
          url: buildItemUrl(item),
          sourceKey: source.key,
          sourceLabel: source.label,
          keywordHits,
        };
      }),
    )
    .filter(Boolean)
    .sort((left, right) => right.keywordHits.length - left.keywordHits.length || left.title.localeCompare(right.title));

  return matched.slice(0, 10);
}

function buildDeliveryFingerprint(matches) {
  return matches.map((item) => item.key).join("|");
}

function buildAlertSubject(rule, matches) {
  const noun =
    rule.product === "exportpulse"
      ? "trade notice"
      : rule.product === "verifysme"
        ? "registry signal"
        : "tender";
  return `[TradeGraph] ${rule.label} · ${matches.length} matching ${noun}${matches.length === 1 ? "" : "s"}`;
}

function buildAlertHtml(rule, matches, mode = "delivery") {
  const intro =
    mode === "test"
      ? "This is a test send for your saved TradeGraph alert."
      : "TradeGraph found new matches for your saved alert.";

  const rows = matches
    .map(
      (match) => `
        <li style="margin-bottom: 12px;">
          <strong>${match.title}</strong><br />
          <span style="color:#5e5e6b;">${match.sourceLabel}${match.meta ? ` · ${match.meta}` : ""}</span><br />
          ${
            match.url
              ? `<a href="${match.url}" style="color:#2457d6; text-decoration:none;">Open source</a>`
              : `<span style="color:#5e5e6b;">No direct source link available</span>`
          }
        </li>
      `,
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#171728;line-height:1.5;">
      <h2 style="margin-bottom:8px;">${rule.label}</h2>
      <p style="margin-top:0;">${intro}</p>
      <ul style="padding-left:18px;">${rows}</ul>
    </div>
  `;
}

async function sendEmail({ recipients, subject, html }) {
  const from = process.env.ALERT_FROM_EMAIL || process.env.LEAD_FROM_EMAIL || "";
  const apiKey = process.env.RESEND_API_KEY || "";

  if (!apiKey || !from || !recipients.length) {
    return {
      mode: "preview",
      delivered: false,
    };
  }

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to: recipients,
    subject,
    html,
  });

  return {
    mode: "email",
    delivered: true,
  };
}

export async function listAlertRules(workspaceId) {
  const db = await readDb();
  return db.alertRules
    .filter((item) => item.workspaceId === workspaceId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function createAlertRule({
  workspaceId,
  product,
  label,
  filters,
  recipients,
  fallbackEmail,
}) {
  const normalizedProduct = String(product || "tenderradar").trim().toLowerCase();
  const normalizedLabel = String(label || "").trim();
  const normalizedFilters = {
    query: String(filters?.query || "").trim(),
    keywords: normalizeKeywords(filters),
    sourceKeys: normalizeSourceKeys(filters, normalizedProduct),
  };

  if (!normalizedLabel) {
    throw new Error("Alert label is required.");
  }

  if (!normalizedFilters.keywords.length) {
    throw new Error("Add at least one keyword to create an alert.");
  }

  await assertAlertCapacity(workspaceId);
  const normalizedRecipients = normalizeRecipients(recipients, fallbackEmail);

  const db = await updateDb((draft) => {
    draft.alertRules.push({
      id: createId("alert"),
      workspaceId,
      product: normalizedProduct,
      ruleType: "keyword_digest",
      label: normalizedLabel,
      recipients: normalizedRecipients,
      filters: normalizedFilters,
      enabled: true,
      lastTestedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    return draft;
  });

  return db.alertRules.find((item) => item.workspaceId === workspaceId && item.label === normalizedLabel);
}

export async function updateAlertRule(workspaceId, alertId, patch = {}) {
  const db = await updateDb((draft) => {
    const rule = draft.alertRules.find((item) => item.workspaceId === workspaceId && item.id === alertId);

    if (!rule) {
      throw new Error("Alert rule not found.");
    }

    if (patch.enabled !== undefined) {
      rule.enabled = Boolean(patch.enabled);
    }

    if (patch.recipients) {
      rule.recipients = normalizeRecipients(patch.recipients);
    }

    rule.updatedAt = nowIso();
    return draft;
  });

  return db.alertRules.find((item) => item.workspaceId === workspaceId && item.id === alertId) || null;
}

export async function deleteAlertRule(workspaceId, alertId) {
  await updateDb((draft) => {
    const before = draft.alertRules.length;
    draft.alertRules = draft.alertRules.filter((item) => !(item.workspaceId === workspaceId && item.id === alertId));

    if (draft.alertRules.length === before) {
      throw new Error("Alert rule not found.");
    }

    draft.state = draft.state.filter(
      (item) => !(item.workspaceId === workspaceId && item.namespace === `${ALERT_NAMESPACE_PREFIX}${alertId}`),
    );
    return draft;
  });
}

export async function testAlertRule(workspaceId, alertId, snapshots) {
  const db = await readDb();
  const rule = db.alertRules.find((item) => item.workspaceId === workspaceId && item.id === alertId);

  if (!rule) {
    throw new Error("Alert rule not found.");
  }

  const matches = buildAlertMatches(rule, snapshots);
  const subject = buildAlertSubject(rule, matches);
  const html = buildAlertHtml(rule, matches, "test");
  const delivery = await sendEmail({
    recipients: rule.recipients,
    subject,
    html,
  });

  await updateDb((draft) => {
    const target = draft.alertRules.find((item) => item.workspaceId === workspaceId && item.id === alertId);
    if (target) {
      target.lastTestedAt = nowIso();
      target.updatedAt = nowIso();
    }
    return draft;
  });

  return {
    deliveryMode: delivery.mode,
    delivered: delivery.delivered,
    subject,
    matches,
    previewHtml: html,
  };
}

async function readDeliveryState(workspaceId, alertId) {
  const db = await readDb();
  const namespace = `${ALERT_NAMESPACE_PREFIX}${alertId}`;
  return db.state.find((item) => item.workspaceId === workspaceId && item.namespace === namespace)?.value || null;
}

async function writeDeliveryState(workspaceId, alertId, value) {
  await updateDb((draft) => {
    const namespace = `${ALERT_NAMESPACE_PREFIX}${alertId}`;
    const existing = draft.state.find((item) => item.workspaceId === workspaceId && item.namespace === namespace);

    if (existing) {
      existing.value = value;
      existing.updatedAt = nowIso();
    } else {
      draft.state.push({
        workspaceId,
        namespace,
        value,
        updatedAt: nowIso(),
      });
    }
    return draft;
  });
}

export async function deliverScheduledAlerts(snapshots) {
  const db = await readDb();
  const deliveries = [];

  for (const rule of db.alertRules.filter((item) => item.enabled)) {
    const subscription = await getWorkspaceSubscription(rule.workspaceId);
    const plan = getPlanDefinition(subscription.planKey);

    if (!plan.automatedAlerts) {
      deliveries.push({
        alertId: rule.id,
        workspaceId: rule.workspaceId,
        status: "skipped_plan",
      });
      continue;
    }

    const matches = buildAlertMatches(rule, snapshots);

    if (!matches.length) {
      deliveries.push({
        alertId: rule.id,
        workspaceId: rule.workspaceId,
        status: "no_match",
      });
      continue;
    }

    const fingerprint = buildDeliveryFingerprint(matches);
    const existing = await readDeliveryState(rule.workspaceId, rule.id);

    if (existing?.fingerprint === fingerprint) {
      deliveries.push({
        alertId: rule.id,
        workspaceId: rule.workspaceId,
        status: "unchanged",
      });
      continue;
    }

    const subject = buildAlertSubject(rule, matches);
    const html = buildAlertHtml(rule, matches, "delivery");
    const delivery = await sendEmail({
      recipients: rule.recipients,
      subject,
      html,
    });

    await writeDeliveryState(rule.workspaceId, rule.id, {
      fingerprint,
      deliveredAt: nowIso(),
      mode: delivery.mode,
    });
    await updateDb((draft) => {
      const target = draft.alertRules.find((item) => item.workspaceId === rule.workspaceId && item.id === rule.id);
      if (target) {
        target.lastTestedAt = nowIso();
        target.updatedAt = nowIso();
      }
      return draft;
    });

    deliveries.push({
      alertId: rule.id,
      workspaceId: rule.workspaceId,
      status: delivery.mode === "email" ? "delivered" : "preview_only",
      matchCount: matches.length,
    });
  }

  return deliveries;
}
