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

function relativeTimestampMs(quantity, unit) {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const normalizedUnit = String(unit || "").toLowerCase();
  const unitMs = {
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    hr: 3_600_000,
    hrs: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
    day: 86_400_000,
    days: 86_400_000,
    week: 604_800_000,
    weeks: 604_800_000,
  };
  return unitMs[normalizedUnit] ? amount * unitMs[normalizedUnit] : null;
}

export function normalizeTimestampInput(value, { now = new Date() } = {}) {
  const raw = normalizeString(value);
  if (!raw) {
    return { iso: null, raw: "" };
  }

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return { iso: direct.toISOString(), raw };
  }

  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (["today", "just now", "just posted", "new"].includes(normalized)) {
    return { iso: now.toISOString(), raw };
  }
  if (normalized === "yesterday") {
    return { iso: new Date(now.getTime() - 86_400_000).toISOString(), raw };
  }

  const relative = normalized.match(
    /^(?:posted\s+|reposted\s+)?(?:(\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks)\s+ago|(a|an)\s+(minute|hour|day|week)\s+ago)$/,
  );
  if (relative) {
    const quantity = relative[1] ? Number(relative[1]) : 1;
    const unit = relative[2] || relative[4];
    const deltaMs = relativeTimestampMs(quantity, unit);
    if (deltaMs !== null) {
      return { iso: new Date(now.getTime() - deltaMs).toISOString(), raw };
    }
  }

  return { iso: null, raw };
}

export function parseTimestamp(value) {
  return normalizeTimestampInput(value).iso;
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
