import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import { detectAtsFromUrl } from "./ats.js";
import { compact, normalizeString, normalizeTimestampInput, sourceHash, stripHtml } from "./utils.js";

export const WINDOWS_COLLECTOR_SOURCES = ["linkedin", "wellfound", "google", "bing"];
const KNOWN_ENGINES = new Set(["google", "bing"]);

function hashId(prefix, ...parts) {
  return `${prefix}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;
}

export function normalizeCollectorSources(input, fallback = WINDOWS_COLLECTOR_SOURCES) {
  const values = Array.isArray(input)
    ? input
    : String(input || "")
      .split(",")
      .map((item) => item.trim());
  const selected = [...new Set(values
    .map((value) => value.toLowerCase())
    .filter((value) => WINDOWS_COLLECTOR_SOURCES.includes(value)))];
  return selected.length ? selected : [...fallback];
}

export function canonicalCollectorUrl(value) {
  try {
    const url = new URL(value, "https://www.google.com");
    if (url.hostname.endsWith("google.com") && url.pathname === "/url") {
      return canonicalCollectorUrl(url.searchParams.get("q") || url.searchParams.get("url") || "");
    }
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "ref", "refId"].forEach((key) => {
      url.searchParams.delete(key);
    });
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return normalizeString(value);
  }
}

function linkedinPortalId(value) {
  return String(value || "").match(/linkedin\.com\/jobs\/view\/(?:[^/]+-)?(\d+)/i)?.[1] || "";
}

function wellfoundPortalId(value) {
  return String(value || "").match(/wellfound\.com\/jobs\/(\d+)/i)?.[1] || "";
}

export function portalIdFromUrl(value) {
  return linkedinPortalId(value) || wellfoundPortalId(value) || "";
}

export function atsIdFromUrl(value) {
  const descriptor = detectAtsFromUrl(value);
  if (descriptor.provider === "greenhouse") return descriptor.jobId || descriptor.boardToken || "";
  if (descriptor.provider === "lever") return descriptor.jobId || descriptor.company || "";
  if (descriptor.provider === "ashby") return descriptor.jobId || descriptor.company || "";
  if (descriptor.provider === "smartrecruiters") return descriptor.jobId || descriptor.company || "";
  if (descriptor.provider === "workday") return descriptor.jobPath || descriptor.tenant || "";
  return "";
}

function descriptionFallback(title, company, snippet) {
  const parts = [title, company, snippet].filter(Boolean);
  return compact(parts.join(" | "), 4000);
}

export function normalizeCollectorJob(input = {}, { sourceProvider = "collector", sourceQuery = "", resolvedUrl = "" } = {}) {
  const url = canonicalCollectorUrl(resolvedUrl || input.canonicalUrl || input.url || "");
  const normalizedTimestamp = normalizeTimestampInput(input.postedAt || input.postedAtRaw || "");
  const description = compact(stripHtml(input.description || input.snippet || ""), 24000)
    || descriptionFallback(input.title, input.company, input.snippet);
  const portalId = input.portalId || portalIdFromUrl(url);
  const atsId = input.atsId || atsIdFromUrl(url);
  return {
    sourceId: input.sourceId || hashId("collector", portalId || atsId || sourceHash(url, input.title, input.company)),
    title: normalizeString(input.title, "Untitled role").slice(0, 300),
    company: normalizeString(input.company, "Unknown company").slice(0, 300),
    description,
    url,
    canonicalUrl: url,
    location: normalizeString(input.location).slice(0, 300),
    postedAt: normalizedTimestamp.iso,
    postedAtRaw: normalizedTimestamp.raw && !normalizedTimestamp.iso ? normalizedTimestamp.raw : normalizeString(input.postedAtRaw),
    sourceQuery: normalizeString(sourceQuery || input.sourceQuery).slice(0, 200),
    sourceProvider: normalizeString(sourceProvider || input.sourceProvider, "collector").slice(0, 120),
    raw: {
      collector: {
        portalId,
        atsId,
        sourceProvider: normalizeString(sourceProvider || input.sourceProvider, "collector"),
        rawDateText: normalizeString(input.postedAtRaw || input.postedAt || normalizedTimestamp.raw).slice(0, 120),
      },
      ...(input.raw || {}),
    },
  };
}

export function dedupeCollectorJobs(records = []) {
  const byKey = new Map();
  const score = (item) => (
    (item.description?.length || 0)
    + (item.company ? 500 : 0)
    + (item.location ? 250 : 0)
    + (item.postedAt ? 100 : 0)
    + (item.postedAtRaw ? 50 : 0)
  );
  for (const record of records) {
    if (!record?.url || !record?.title) continue;
    const key = [
      record.raw?.collector?.portalId || "",
      record.raw?.collector?.atsId || "",
      record.canonicalUrl || record.url,
    ].join("|");
    const existing = byKey.get(key);
    if (!existing || score(record) > score(existing)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function textFrom(element, selector) {
  const value = cheerio.load(element)(selector).first().text();
  return normalizeString(value);
}

function attributeFrom($element, selector, attribute) {
  return normalizeString($element.find(selector).first().attr(attribute));
}

export function extractSearchResultsFromHtml(html, { engine = "google", sourceQuery = "" } = {}) {
  if (!KNOWN_ENGINES.has(engine)) throw new Error(`Unsupported search engine: ${engine}`);
  const $ = cheerio.load(html);
  const anchors = $("a[href]").toArray();
  return anchors.map((anchor) => {
    const $anchor = $(anchor);
    const title = normalizeString($anchor.find("h3,h2").first().text() || $anchor.attr("aria-label") || $anchor.text());
    const url = canonicalCollectorUrl($anchor.attr("href"));
    const snippet = compact($anchor.parent().text(), 1200);
    const provider = /linkedin\.com\/jobs\/view/i.test(url)
      ? "linkedin"
      : /wellfound\.com\/jobs\//i.test(url)
        ? "wellfound"
        : engine;
    return normalizeCollectorJob({
      title,
      company: "",
      description: snippet,
      snippet,
      url,
      postedAtRaw: "",
    }, {
      sourceProvider: `${engine}_xray`,
      sourceQuery,
    });
  }).filter((item) => item.url && item.title && /(linkedin\.com\/jobs\/view|wellfound\.com\/jobs\/|greenhouse|lever|ashby|workday|smartrecruiters)/i.test(item.url));
}

export function extractLinkedInJobsFromHtml(html, { sourceQuery = "" } = {}) {
  const $ = cheerio.load(html);
  const cards = $(".jobs-search__results-list li, .job-search-card, [data-entity-urn*='jobPosting']").toArray();
  return cards.map((card) => {
    const $card = $(card);
    const link = attributeFrom($card, "a[href*='/jobs/view/']", "href");
    const title = textFrom(card, "h3, .base-search-card__title, [data-test-job-title]");
    const company = textFrom(card, "h4, .base-search-card__subtitle, [data-test-company-name]");
    const location = textFrom(card, ".job-search-card__location, .base-search-card__metadata, [data-test-job-location]");
    const postedAtRaw = textFrom(card, "time, .job-search-card__listdate, [data-test-posted-date]");
    const snippet = compact($card.text(), 1600);
    return normalizeCollectorJob({
      title,
      company,
      location,
      description: snippet,
      snippet,
      url: link,
      portalId: linkedinPortalId(link),
      postedAtRaw,
    }, {
      sourceProvider: "linkedin",
      sourceQuery,
    });
  }).filter((item) => item.url && item.title);
}

export function extractWellfoundJobsFromHtml(html, { sourceQuery = "" } = {}) {
  const $ = cheerio.load(html);
  const cards = $("a[href*='/jobs/'], [data-test='JobListingRow']").toArray();
  const rows = [];
  for (const card of cards) {
    const $card = $(card);
    const link = canonicalCollectorUrl($card.attr("href") || attributeFrom($card, "a[href*='/jobs/']", "href"));
    if (!/wellfound\.com\/jobs\//i.test(link)) continue;
    const title = textFrom(card, "h2, h3, [data-test='JobTitle']");
    const company = textFrom(card, "[data-test='StartupName'], .styles_startupName");
    const location = textFrom(card, "[data-test='Location'], .styles_location");
    const postedAtRaw = textFrom(card, "time, [data-test='PostedAt'], .styles_metadata");
    const snippet = compact($card.text(), 1800);
    rows.push(normalizeCollectorJob({
      title,
      company,
      location,
      description: snippet,
      snippet,
      url: link,
      portalId: wellfoundPortalId(link),
      postedAtRaw,
    }, {
      sourceProvider: "wellfound",
      sourceQuery,
    }));
  }
  return rows.filter((item) => item.url && item.title);
}

export function extractCanonicalApplyUrl(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = $("a[href]").toArray().map((anchor) => canonicalCollectorUrl($(anchor).attr("href")));
  const preferred = links.find((link) => /(greenhouse|lever|ashbyhq|myworkdayjobs|smartrecruiters|workable|icims|bamboohr|jobvite|breezy)/i.test(link));
  return preferred || canonicalCollectorUrl(attributeFrom($("head"), "link[rel='canonical']", "href")) || canonicalCollectorUrl(baseUrl);
}
