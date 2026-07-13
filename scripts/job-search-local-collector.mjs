#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";

import { config as loadEnv } from "dotenv";
import { chromium } from "playwright-core";

loadEnv({ path: path.join(process.cwd(), ".env.local"), override: false, quiet: true });
loadEnv({ path: path.join(process.cwd(), ".env"), override: false, quiet: true });

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const item = [...args].find((argument) => argument.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
};
const headless = args.has("--headless");
const skipGoogle = args.has("--skip-google");
const skipPortals = args.has("--skip-portals");
const freshness = valueArg("--freshness", "day");
const maxQueries = Number(valueArg("--max-queries", "8"));
const extractLimit = Number(valueArg("--extract-limit", "200"));
const profileDir = valueArg("--profile", path.join(os.homedir(), ".diptopal-job-search", "chrome-profile"));
const chromePath = valueArg("--chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Run `vercel env pull .env.local` before starting the collector.");
}

const [
  { ATS_SOURCES, JOB_PORTALS, buildLocalBrowserSearchPlan },
  { classifyCandidateTitle },
  { createRun, recordDiscoveryLeads, updateRun },
  { detectAtsFromUrl, fetchJobsFromUrls },
  { extractJobFromHtml },
  { persistExtractedJobs },
] = await Promise.all([
  import("../server/job-search/discovery.js"),
  import("../server/job-search/title-ontology.js"),
  import("../server/job-search/repository.js"),
  import("../server/job-search/ats.js"),
  import("../server/job-search/providers.js"),
  import("../server/job-search/workflow.js"),
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalUrl(value) {
  try {
    const url = new URL(value, "https://www.google.com");
    if (url.hostname.endsWith("google.com") && url.pathname === "/url") {
      return canonicalUrl(url.searchParams.get("q") || url.searchParams.get("url") || "");
    }
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId"].forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function sourceForUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    const portal = JOB_PORTALS.find((item) => host === item.host || host.endsWith(`.${item.host}`));
    if (portal) return portal.id;
    const ats = ATS_SOURCES.find((item) => host === item.host || host.endsWith(`.${item.host}`));
    return ats?.id || host;
  } catch {
    return "unknown";
  }
}

function externalIdForUrl(value) {
  try {
    const url = new URL(value);
    const linkedInId = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/)?.[1];
    if (linkedInId) return linkedInId;
    return url.pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {
    return "";
  }
}

function acceptedSource(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return [...JOB_PORTALS, ...ATS_SOURCES].some((item) => host === item.host || host.endsWith(`.${item.host}`));
  } catch {
    return false;
  }
}

async function dismissGoogleConsent(page) {
  for (const label of ["Reject all", "Accept all", "I agree"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    if (await button.count()) {
      await button.first().click().catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function assertSearchAvailable(page) {
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (/unusual traffic|not a robot|our systems have detected|recaptcha|sorry\/index/.test(body + page.url().toLowerCase())) {
    const error = new Error("Google presented an interstitial. Search stopped; complete it manually in the persistent Chrome profile before retrying.");
    error.code = "blocked_interstitial";
    throw error;
  }
}

async function googleResults(page, item) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", item.query);
  url.searchParams.set("num", "100");
  url.searchParams.set("hl", "en");
  url.searchParams.set("filter", "0");
  url.searchParams.set("tbs", freshness === "week" ? "qdr:w" : freshness === "month" ? "qdr:m" : "qdr:d");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
  await dismissGoogleConsent(page);
  await assertSearchAvailable(page);
  await page.waitForTimeout(1200);
  const results = await page.locator("a:has(h3)").evaluateAll((anchors) => anchors.map((anchor) => ({
    url: anchor.href,
    title: anchor.querySelector("h3")?.textContent?.trim() || "",
    snippet: anchor.parentElement?.parentElement?.innerText?.trim() || "",
  })));
  return results.map((result) => ({ ...result, url: canonicalUrl(result.url) })).filter((result) => result.url && acceptedSource(result.url));
}

async function portalResults(page, portal) {
  await page.goto(portal.entryUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  for (let index = 0; index < 3; index += 1) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(700);
  }
  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
    url: anchor.href,
    title: anchor.querySelector("h1,h2,h3,h4")?.textContent?.trim()
      || anchor.getAttribute("aria-label")
      || anchor.textContent?.trim()
      || "",
    snippet: anchor.parentElement?.innerText?.trim() || "",
  })));
  return links
    .map((result) => ({ ...result, url: canonicalUrl(result.url), title: result.title.replace(/\s+/g, " ").slice(0, 300) }))
    .filter((result) => result.url && acceptedSource(result.url) && new URL(result.url).pathname.includes(portal.pathHint));
}

function asLead(result, sourceQuery) {
  const ontology = classifyCandidateTitle(result.title);
  return {
    externalId: externalIdForUrl(result.url),
    url: result.url,
    title: result.title,
    sourceProvider: sourceForUrl(result.url),
    sourceQuery,
    snippet: result.snippet || "",
    status: result.title ? ontology.eligible ? "extraction_pending" : "filtered_title" : "metadata_pending",
    ontology,
    raw: { localCollector: true, collectedAt: new Date().toISOString() },
  };
}

async function extractLead(context, lead) {
  const descriptor = detectAtsFromUrl(lead.url);
  if (!["generic", "invalid"].includes(descriptor.provider)) {
    return (await fetchJobsFromUrls([lead.url])).jobs;
  }
  const page = await context.newPage();
  try {
    await page.goto(lead.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1000);
    const html = await page.content();
    const job = extractJobFromHtml(html, lead.url);
    return job.title && job.company && job.description.length >= 200 ? [job] : [];
  } finally {
    await page.close();
  }
}

await mkdir(profileDir, { recursive: true });
const run = await createRun({ trigger: "local-browser", status: "running", phase: "discovery" });
const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: chromePath,
  headless,
  viewport: { width: 1440, height: 1000 },
  locale: "en-US",
});

const leads = [];
const errors = [];
let blocked = false;
try {
  const searchPage = context.pages()[0] || await context.newPage();
  const searchPlan = skipGoogle ? [] : buildLocalBrowserSearchPlan({ freshness }).slice(0, maxQueries);
  for (const [index, query] of searchPlan.entries()) {
    try {
      const results = await googleResults(searchPage, query);
      leads.push(...results.map((result) => asLead(result, `google:${query.id}`)));
    } catch (error) {
      errors.push({ stage: "google", query: query.id, message: error.message });
      if (error.code === "blocked_interstitial") {
        blocked = true;
        break;
      }
    }
    if (index < searchPlan.length - 1) await sleep(8000 + Math.floor(Math.random() * 7000));
  }

  for (const portal of (skipPortals ? [] : JOB_PORTALS.filter((item) => item.entryUrl))) {
    const page = await context.newPage();
    try {
      const results = await portalResults(page, portal);
      leads.push(...results.map((result) => asLead(result, `portal:${portal.id}`)));
    } catch (error) {
      errors.push({ stage: "portal", portal: portal.id, message: error.message });
    } finally {
      await page.close();
    }
  }

  const recorded = await recordDiscoveryLeads(leads.map((lead) => ({ ...lead, runId: run.id })));
  const candidates = recorded.filter((lead) => lead.ontology?.eligible).slice(0, extractLimit);
  let extracted = 0;
  let changed = 0;
  for (const lead of candidates) {
    try {
      const jobs = await extractLead(context, lead);
      extracted += jobs.length;
      changed += (await persistExtractedJobs(jobs)).length;
    } catch (error) {
      errors.push({ stage: "extraction", url: lead.url, message: error.message });
    }
  }

  await updateRun(run.id, {
    status: blocked ? "blocked" : errors.length ? "partial" : "completed",
    phase: "complete",
    stats: { rawLeads: recorded.length, candidates: candidates.length, extracted, changed },
    providers: { localChrome: { status: blocked ? "blocked_interstitial" : "live", headless, queries: Math.min(maxQueries, 8) } },
    errors,
  });
  process.stdout.write(`${JSON.stringify({ runId: run.id, rawLeads: recorded.length, candidates: candidates.length, extracted, changed, blocked, errors: errors.length })}\n`);
} catch (error) {
  await updateRun(run.id, { status: "failed", phase: "failed", errors: [...errors, { stage: "collector", message: error.message }] });
  throw error;
} finally {
  await context.close();
}
