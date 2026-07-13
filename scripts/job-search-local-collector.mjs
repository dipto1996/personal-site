#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { config as loadEnv } from "dotenv";
import { chromium } from "playwright-core";

import { buildLocalBrowserSearchPlan, QUERY_BUNDLES } from "../server/job-search/discovery.js";
import {
  WINDOWS_COLLECTOR_SOURCES,
  canonicalCollectorUrl,
  dedupeCollectorJobs,
  extractCanonicalApplyUrl,
  extractLinkedInJobsFromHtml,
  extractSearchResultsFromHtml,
  extractWellfoundJobsFromHtml,
  normalizeCollectorSources,
} from "../server/job-search/windows-collector.js";

loadEnv({ path: path.join(process.cwd(), ".env.local"), override: false, quiet: true });
loadEnv({ path: path.join(process.cwd(), ".env"), override: false, quiet: true });

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const item = [...args].find((argument) => argument.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
};

const headless = args.has("--headless");
const sources = normalizeCollectorSources(valueArg("--sources", WINDOWS_COLLECTOR_SOURCES.join(",")));
const maxQueries = Math.max(1, Math.min(12, Number(valueArg("--max-queries", "8")) || 8));
const maxPages = Math.max(1, Math.min(6, Number(valueArg("--max-pages", "3")) || 3));
const maxJobs = Math.max(10, Math.min(120, Number(valueArg("--max-jobs", "80")) || 80));
const endpoint = String(valueArg("--endpoint", process.env.JOBSEARCH_WORKER_BASE_URL || process.env.APP_URL || "")).replace(/\/$/, "");
const token = String(valueArg("--token", process.env.JOBSEARCH_WORKER_TOKEN || ""));
const profileDir = valueArg("--profile", path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  "DiptopalJobWorker",
  "collector-profile",
));
const chromePath = valueArg("--chrome", process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const runLabel = valueArg("--run-label", "Windows collector");
const collectorRunId = `jsrun_collector_${randomUUID().replaceAll("-", "")}`;

if (!endpoint || (!endpoint.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(endpoint))) {
  throw new Error("JOBSEARCH_WORKER_BASE_URL must use HTTPS (loopback HTTP is allowed only for local testing).");
}
if (token.length < 32) {
  throw new Error("JOBSEARCH_WORKER_TOKEN must contain at least 32 characters.");
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function googleSearchUrl(query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("num", "100");
  url.searchParams.set("hl", "en");
  url.searchParams.set("filter", "0");
  url.searchParams.set("tbs", "qdr:d");
  return url.toString();
}

function bingSearchUrl(query) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "50");
  return url.toString();
}

function linkedInSearchUrl(query, pageIndex) {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", query);
  url.searchParams.set("f_TPR", "r86400");
  url.searchParams.set("start", String(pageIndex * 25));
  return url.toString();
}

function wellfoundSearchUrl(query, pageIndex) {
  const url = new URL("https://wellfound.com/jobs");
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(pageIndex + 1));
  return url.toString();
}

async function maybeDismissConsent(page) {
  for (const label of ["Reject all", "Accept all", "I agree"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    if (await button.count().catch(() => 0)) {
      await button.first().click().catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function assertVisibleSearch(page, sourceId) {
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const url = page.url().toLowerCase();
  if (/captcha|not a robot|unusual traffic|detected unusual|sorry\/index|verify you are human/.test(`${body} ${url}`)) {
    const error = new Error(`${sourceId} presented a challenge. Complete it manually in the persistent browser profile and retry.`);
    error.code = "blocked";
    throw error;
  }
}

async function resolveCanonicalUrl(context, job) {
  if (!job?.url) return job;
  if (/(greenhouse|lever|ashbyhq|myworkdayjobs|smartrecruiters|workable|icims|bamboohr|jobvite|breezy)/i.test(job.url)) {
    return job;
  }
  const page = await context.newPage();
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(900);
    const html = await page.content();
    const resolved = extractCanonicalApplyUrl(html, page.url());
    return {
      ...job,
      url: canonicalCollectorUrl(resolved || job.url),
      canonicalUrl: canonicalCollectorUrl(resolved || job.url),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function collectSource(context, sourceId, queries) {
  const page = context.pages()[0] || await context.newPage();
  const sourceHealth = {
    sourceId,
    status: "live",
    pagesVisited: 0,
    resultCount: 0,
    jobCount: 0,
    blocked: false,
    errors: [],
    notes: "",
    sampleUrls: [],
  };
  const jobs = [];

  for (const querySpec of queries) {
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      try {
        let targetUrl = "";
        if (sourceId === "google") targetUrl = googleSearchUrl(querySpec.query);
        if (sourceId === "bing") targetUrl = bingSearchUrl(querySpec.query);
        if (sourceId === "linkedin") targetUrl = linkedInSearchUrl(querySpec.query, pageIndex);
        if (sourceId === "wellfound") targetUrl = wellfoundSearchUrl(querySpec.query, pageIndex);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await maybeDismissConsent(page);
        await assertVisibleSearch(page, sourceId);
        for (let scroll = 0; scroll < 3; scroll += 1) {
          await page.mouse.wheel(0, 2200).catch(() => undefined);
          await page.waitForTimeout(500);
        }
        const html = await page.content();
        let extracted = [];
        if (sourceId === "google" || sourceId === "bing") {
          extracted = extractSearchResultsFromHtml(html, { engine: sourceId, sourceQuery: querySpec.id });
        } else if (sourceId === "linkedin") {
          extracted = extractLinkedInJobsFromHtml(html, { sourceQuery: querySpec.id });
        } else if (sourceId === "wellfound") {
          extracted = extractWellfoundJobsFromHtml(html, { sourceQuery: querySpec.id });
        }
        jobs.push(...extracted);
        sourceHealth.pagesVisited += 1;
        sourceHealth.resultCount += extracted.length;
        extracted.slice(0, 2).forEach((item) => {
          if (item.url && sourceHealth.sampleUrls.length < 5) sourceHealth.sampleUrls.push(item.url);
        });
        if (!extracted.length && sourceId === "linkedin" && pageIndex > 0) break;
        if (!extracted.length && sourceId === "wellfound") break;
      } catch (error) {
        sourceHealth.status = error.code === "blocked" ? "blocked" : "partial";
        sourceHealth.blocked ||= error.code === "blocked";
        sourceHealth.errors.push(String(error.message || error).slice(0, 500));
        if (error.code === "blocked") break;
      }
      await sleep(800 + Math.floor(Math.random() * 800));
      if (jobs.length >= maxJobs) break;
    }
    if (sourceHealth.blocked || jobs.length >= maxJobs) break;
  }

  sourceHealth.jobCount = jobs.length;
  if (!jobs.length && sourceHealth.status === "live") sourceHealth.status = "empty";
  return { jobs, sourceHealth };
}

function buildLead(job) {
  return {
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location,
    postedAt: job.postedAt || null,
    postedAtRaw: job.postedAtRaw || "",
    sourceProvider: job.sourceProvider,
    sourceQuery: job.sourceQuery,
    snippet: job.description.slice(0, 1000),
    externalId: job.raw?.collector?.portalId || job.raw?.collector?.atsId || "",
    status: "extracted",
    ontology: {},
    raw: job.raw || {},
  };
}

async function submitCollectorBatch(batch) {
  const response = await fetch(`${endpoint}/api/job-search/worker/discovery-batch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Collector batch failed with ${response.status}: ${payload.error || "request failed"}`);
  }
  return payload;
}

await mkdir(profileDir, { recursive: true });
const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: chromePath,
  headless,
  viewport: { width: 1440, height: 1000 },
  locale: "en-US",
});

try {
  const searchQueries = buildLocalBrowserSearchPlan({ freshness: "day" }).slice(0, maxQueries);
  const portalQueries = QUERY_BUNDLES.slice(0, maxQueries);
  const selectedQueries = {
    linkedin: portalQueries,
    wellfound: portalQueries,
    google: searchQueries,
    bing: searchQueries,
  };

  const collectedJobs = [];
  const sourceHealth = [];
  for (const sourceId of sources) {
    const collected = await collectSource(context, sourceId, selectedQueries[sourceId] || []);
    sourceHealth.push(collected.sourceHealth);
    collectedJobs.push(...collected.jobs);
  }

  const resolved = [];
  for (const job of dedupeCollectorJobs(collectedJobs).slice(0, maxJobs)) {
    resolved.push(await resolveCanonicalUrl(context, job));
  }
  const jobs = dedupeCollectorJobs(resolved);
  const leads = jobs.map(buildLead);
  const batch = {
    operationKey: `collector_${randomUUID().replaceAll("-", "")}`,
    collectorRunId,
    collectorRunLabel: runLabel,
    final: true,
    selectedSources: sources,
    sourceHealth,
    leads,
    jobs,
    errors: sourceHealth.flatMap((source) => source.errors.map((error) => `${source.sourceId}: ${error}`)).slice(0, 30),
  };
  const result = await submitCollectorBatch(batch);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runId: result.runId,
    selectedSources: sources,
    leadCount: leads.length,
    jobCount: jobs.length,
    queuedCount: result.counts?.localQueued || 0,
    sourceHealth,
  })}\n`);
} finally {
  await context.close();
}
