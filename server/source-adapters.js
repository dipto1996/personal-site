import { nowIso, readDb, updateDb } from "./persistence.js";
import { buildSyncArtifacts } from "./source-metrics.js";
import {
  MCA_FIND_CIN_URL,
  MCA_MASTER_DATA_PORTAL_URL,
  MCA_OGD_CATALOG_URL,
  MCA_OGD_RESOURCE_URL,
  parseMcaCatalogMetrics,
} from "./mca.js";
import { probeUdyamService } from "./udyam.js";

const DEFAULT_TIMEOUT_MS = 20_000;

function withTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    headers: {
      "user-agent": "Mozilla/5.0 (TradeGraph India Source Sync)",
      accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      ...(options.headers || {}),
    },
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
  });
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#47;/g, "/");
}

function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function absoluteUrl(base, value) {
  return new URL(value, base).toString();
}

export function parseGemBidPlusResponse(payload) {
  const raw = typeof payload === "string" ? JSON.parse(payload) : payload;
  const docs = raw?.response?.response?.docs || [];

  return docs.map((item) => ({
    externalId: String(item.b_id?.[0] || item.id || ""),
    bidNumber: item.b_bid_number?.[0] || "",
    ministry: item.ba_official_details_minName?.[0] || "",
    department: item.ba_official_details_deptName?.[0] || "",
    category: item.b_category_name?.[0] || "",
    documentUrl: absoluteUrl(
      "https://bidplus-global.gem.gov.in/",
      `showbidDocument/${item.b_id?.[0] || item.id}/${item.qtr_dir?.[0] || ""}/${item.b_is_new_upload?.[0] || 0}`,
    ),
  }));
}

export function parseCpppByDateHtml(html) {
  const rowPattern =
    /<tr class="(?:even|odd)"[^>]*>[\s\S]*?<td align="center">\s*(\d+)\.\s*<\/td>[\s\S]*?<td align="center">\s*([^<]+?)\s*<\/td>[\s\S]*?<td align="center">\s*([^<]+?)\s*<\/td>[\s\S]*?<td align="center">\s*([^<]+?)\s*<\/td>[\s\S]*?<td align="center">\s*<a[^>]+href="([^"]+)"[^>]*>\[([^\]]+)\]<\/a>\s*\[([^\]]+)\]\[([^\]]+)\]\s*<\/td>[\s\S]*?<td align="center">\s*([^<]+?)\s*<\/td>/g;

  const results = [];
  let match = rowPattern.exec(html);

  while (match) {
    results.push({
      serial: Number(match[1]),
      publishedAt: cleanText(match[2]),
      closingAt: cleanText(match[3]),
      openingAt: cleanText(match[4]),
      detailUrl: absoluteUrl("https://www.eprocure.gov.in/epublish/app", decodeEntities(match[5])),
      title: cleanText(match[6]),
      referenceNumber: cleanText(match[7]),
      tenderId: cleanText(match[8]),
      organization: cleanText(match[9]),
    });
    match = rowPattern.exec(html);
  }

  return results;
}

export function parseDgftTradeNoticeHtml(html) {
  const rowPattern =
    /<tr>\s*<td>\s*\d+\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>[\s\S]*?<a title="Download"[^>]+href="([^"]+)"[^>]*>/g;

  const results = [];
  let match = rowPattern.exec(html);

  while (match) {
    results.push({
      noticeNumber: cleanText(match[1]),
      noticeYear: cleanText(match[2]),
      title: cleanText(match[3]),
      noticeDate: cleanText(match[4]),
      pdfUrl: decodeEntities(match[5]),
    });
    match = rowPattern.exec(html);
  }

  return results;
}

async function fetchGemBidPlus() {
  const response = await withTimeout("https://bidplus-global.gem.gov.in/all-bids-data", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify({
      searchBy: "all",
      bidStatus: "ongoing_bids",
      page: 1,
      size: 12,
      sort: "Bid-End-Date-Latest",
      searchType: "fullText",
      searchText: "",
    }),
  });

  const text = await response.text();
  const items = parseGemBidPlusResponse(text);

  return {
    key: "gem",
    label: "GeM BidPlus",
    status: "live",
    checkedAt: nowIso(),
    itemCount: items.length,
    items,
    note: "Live global-bid feed from GeM BidPlus.",
  };
}

async function fetchCpppByDate() {
  const response = await withTimeout(
    "https://www.eprocure.gov.in/epublish/app?page=FrontEndListTendersbyDate&service=page",
  );
  const html = await response.text();
  const items = parseCpppByDateHtml(html).slice(0, 15);

  return {
    key: "cppp",
    label: "CPPP ePublishing",
    status: "live",
    checkedAt: nowIso(),
    itemCount: items.length,
    items,
    note: "Live tender-by-date feed from the public ePublishing system.",
  };
}

async function fetchDgftTradeNotices() {
  const response = await withTimeout("https://www.dgft.gov.in/CP/?opt=trade-notice");
  const html = await response.text();
  const items = parseDgftTradeNoticeHtml(html).slice(0, 15);

  return {
    key: "dgft",
    label: "DGFT Trade Notices",
    status: "live",
    checkedAt: nowIso(),
    itemCount: items.length,
    items,
    note: "Live trade-notice feed from DGFT public notices.",
  };
}

async function fetchUdyamStatus() {
  try {
    const probe = await probeUdyamService();

    return {
      key: "udyam",
      label: "Udyam Registration",
      status: probe.status || "live",
      checkedAt: nowIso(),
      itemCount: 1,
      items: [
        {
          title: probe.title,
          url: "https://udyamregistration.gov.in/Udyam_Verify.aspx",
        },
      ],
      note:
        probe.status === "maintenance"
          ? `${probe.note} VerifySME still supports official certificate and QR-result imports while the live portal is unavailable.`
          : "Official captcha-assisted verification is live. TradeGraph can load the government captcha, keep the ASP.NET session alive, and submit a manual verification request inside VerifySME.",
      evidence:
        probe.status === "maintenance"
          ? probe.note
          : `${probe.title} · ${probe.fieldNames.registrationNumber} · ${probe.captchaPath}`,
    };
  } catch (error) {
    return {
      key: "udyam",
      label: "Udyam Registration",
      status: "restricted",
      checkedAt: nowIso(),
      itemCount: 1,
      items: [
        {
          title: "Udyam registration portal",
          url: "https://udyamregistration.gov.in/",
        },
      ],
      note:
        "TradeGraph could not initialize the official Udyam verification flow from this environment.",
      evidence: error.message,
    };
  }
}

async function fetchMcaStatus() {
  const response = await withTimeout(MCA_OGD_CATALOG_URL);
  const html = await response.text();
  const metrics = parseMcaCatalogMetrics(html);
  const services = [
    {
      url: MCA_MASTER_DATA_PORTAL_URL,
      title: "Official MCA master data",
    },
    {
      url: MCA_FIND_CIN_URL,
      title: "Official Find CIN",
    },
    {
      url: MCA_OGD_CATALOG_URL,
      title: "Official MCA company catalog",
    },
    {
      url: MCA_OGD_RESOURCE_URL,
      title: "Official OGD resource preview",
    },
  ];
  const evidence = [
    metrics.totalRecords ? `${metrics.totalRecords.toLocaleString("en-US")} OGD records` : "",
    metrics.updatedLabel ? `updated ${metrics.updatedLabel}` : "",
    metrics.fileFormat || "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    key: "mca",
    label: "MCA Master Data",
    status: "live",
    checkedAt: nowIso(),
    itemCount: services.length,
    items: services,
    note:
      "Official MCA automation is bot-protected, but the public OGD company catalog is live and VerifySME now supports a human-captcha-assisted MCA workflow: open the official portal, complete the lookup, paste the result, and TradeGraph structures it inside the workspace.",
    evidence,
  };
}

fetchGemBidPlus.adapterKey = "gem";
fetchCpppByDate.adapterKey = "cppp";
fetchDgftTradeNotices.adapterKey = "dgft";
fetchUdyamStatus.adapterKey = "udyam";
fetchMcaStatus.adapterKey = "mca";

const ADAPTERS = [fetchGemBidPlus, fetchCpppByDate, fetchDgftTradeNotices, fetchUdyamStatus, fetchMcaStatus];

export async function syncAllSources({ adapters = ADAPTERS } = {}) {
  const snapshots = [];

  for (const adapter of adapters) {
    try {
      snapshots.push(await adapter());
    } catch (error) {
      snapshots.push({
        key: adapter.adapterKey || adapter.name.replace(/^fetch/, "").toLowerCase(),
        label: adapter.name,
        status: "error",
        checkedAt: nowIso(),
        itemCount: 0,
        items: [],
        note: error.message,
      });
    }
  }

  const { sourceHistory, dailyMetrics } = buildSyncArtifacts(snapshots);

  await updateDb((db) => {
    db.sources = snapshots;
    db.sourceHistory = [...(db.sourceHistory || []), ...sourceHistory];
    db.dailyMetrics = [...(db.dailyMetrics || []), ...dailyMetrics];
    return db;
  });

  return snapshots;
}

export async function listSourceSnapshots({ autoSync = true } = {}) {
  const db = await readDb();
  const existing = db.sources || [];

  if (!autoSync) {
    return existing;
  }

  const latest = existing.reduce((current, item) => {
    if (!current || new Date(item.checkedAt).getTime() > new Date(current.checkedAt).getTime()) {
      return item;
    }
    return current;
  }, null);

  if (!latest || Date.now() - new Date(latest.checkedAt).getTime() > 1000 * 60 * 60 * 12) {
    return syncAllSources();
  }

  return existing;
}

export function buildSourceSummary(snapshots) {
  return snapshots.map((item) => ({
    key: item.key,
    label: item.label,
    status: item.status,
    checkedAt: item.checkedAt,
    itemCount: item.itemCount,
    note: item.note,
  }));
}
