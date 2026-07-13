import crypto from "node:crypto";

export function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

export function normalizeString(value, fallback = "") {
  return String(value || "").trim() || fallback;
}

export function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function compact(value, maxLength = 4000) {
  return normalizeString(value).replace(/\s+/g, " ").slice(0, maxLength);
}

export function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseCsv(value) {
  return normalizeString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sourceHash(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => normalizeString(part)).join("|"))
    .digest("hex")
    .slice(0, 24);
}

export function stripHtml(value) {
  return normalizeString(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];

  items.forEach((item) => {
    const key = normalizeString(keyFn(item));
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(item);
  });

  return result;
}

export function googleSearchUrl(query, params = {}) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

export async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.JOBSEARCH_FETCH_TIMEOUT_MS || 12000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json, text/html;q=0.9, text/plain;q=0.8",
        "user-agent": "DiptopalRoyJobSearchBot/1.0 (+https://tradegraph-india-site.vercel.app)",
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
