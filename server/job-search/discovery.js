import { createHash } from "node:crypto";

import { TITLE_FAMILIES } from "./taxonomy.js";
import { buildBroadSearchShards } from "./title-ontology.js";

export const JOB_PORTALS = [
  { id: "linkedin", label: "LinkedIn", host: "linkedin.com", pathHint: "/jobs/view/", mode: "google_xray" },
  { id: "wellfound", label: "Wellfound", host: "wellfound.com", pathHint: "/jobs/", mode: "portal_and_google", entryUrl: "https://wellfound.com/jobs" },
  { id: "yc", label: "YC Work at a Startup", host: "workatastartup.com", pathHint: "/jobs/", mode: "portal_and_google", entryUrl: "https://www.workatastartup.com/jobs" },
  { id: "builtin", label: "Built In", host: "builtin.com", pathHint: "/job/", mode: "portal_and_google", entryUrl: "https://builtin.com/jobs/data-analytics" },
  { id: "welcome", label: "Welcome to the Jungle", host: "welcometothejungle.com", pathHint: "/jobs/", mode: "portal_and_google", entryUrl: "https://www.welcometothejungle.com/en/pages/jobs-data-us?page=1" },
  { id: "ai-startup-jobs", label: "AI Startup Jobs", host: "aistartupjobs.com", pathHint: "/", mode: "portal_and_google", entryUrl: "https://www.aistartupjobs.com/" },
  { id: "dataaxy", label: "Dataaxy", host: "dataaxy.com", pathHint: "/", mode: "portal_and_google", entryUrl: "https://www.dataaxy.com/" },
  { id: "we-work-remotely", label: "We Work Remotely", host: "weworkremotely.com", pathHint: "/remote-jobs/", mode: "portal_and_google", entryUrl: "https://weworkremotely.com/categories/remote-data-jobs" },
  { id: "remote-ok", label: "Remote OK", host: "remoteok.com", pathHint: "/remote-jobs/", mode: "portal_and_google", entryUrl: "https://remoteok.com/remote-data-jobs" },
];

export const ATS_SOURCES = [
  { id: "greenhouse", host: "boards.greenhouse.io" },
  { id: "greenhouse-new", host: "job-boards.greenhouse.io" },
  { id: "lever", host: "jobs.lever.co" },
  { id: "ashby", host: "jobs.ashbyhq.com" },
  { id: "workday", host: "myworkdayjobs.com" },
  { id: "smartrecruiters", host: "jobs.smartrecruiters.com" },
  { id: "workable", host: "apply.workable.com" },
  { id: "icims", host: "careers.icims.com" },
  { id: "jobvite", host: "jobs.jobvite.com" },
  { id: "bamboohr", host: "bamboohr.com" },
  { id: "breezy", host: "breezy.hr" },
];

const SHARD_LABELS = {
  analytics: "Analytics and business-intelligence leadership",
  science: "Data-science and decision-science management",
  "product-experimentation": "Product analytics, experimentation, and measurement",
  "marketing-customer": "Marketing, customer, retention, and commercial analytics",
  "data-product": "Data products and data strategy",
  strategy: "Strategy, business management, and performance analytics",
  "ai-product-operator": "AI product, enablement, governance, and operating roles",
  finserv: "Financial-services analytics and decisioning",
};

export const QUERY_BUNDLES = buildBroadSearchShards().map((shard) => ({
  id: shard.id,
  label: SHARD_LABELS[shard.id],
  query: shard.query,
}));

export const EXPLORATORY_QUERIES = [
  '("conversion optimization" OR "lifecycle analytics" OR "retention analytics" OR "acquisition analytics") (manager OR lead OR director OR principal)',
  '("customer decisioning" OR "marketing science" OR "commercial insights" OR "growth measurement") (manager OR lead OR director OR principal)',
  '("experimentation" OR "measurement" OR "causal inference") (product OR growth OR marketplace) (manager OR lead OR director OR principal)',
  '("AI enablement" OR "AI operating model" OR "data commercialization") (manager OR lead OR director OR principal)',
];

const X_RAY_GROUPS = [
  {
    id: "major-startup-portals",
    sites: ["site:linkedin.com/jobs/view", "site:wellfound.com/jobs", "site:workatastartup.com/jobs"],
  },
  {
    id: "specialist-portals",
    sites: ["site:builtin.com/job", "site:welcometothejungle.com/en/companies", "site:aistartupjobs.com", "site:dataaxy.com"],
  },
  {
    id: "direct-ats-a",
    sites: ["site:boards.greenhouse.io", "site:job-boards.greenhouse.io", "site:jobs.lever.co", "site:jobs.ashbyhq.com"],
  },
  {
    id: "direct-ats-b",
    sites: ["site:myworkdayjobs.com", "site:jobs.smartrecruiters.com", "site:apply.workable.com", "site:careers.icims.com", "site:jobs.jobvite.com", "site:bamboohr.com", "site:breezy.hr"],
  },
  {
    id: "company-career-pages",
    sites: ["inurl:careers", "inurl:jobs", "inurl:open-positions", "inurl:opportunities"],
  },
];

export function buildLocalBrowserSearchPlan({ date = new Date(), freshness = "day" } = {}) {
  const dayIndex = Math.floor(date.getTime() / 86400000);
  return QUERY_BUNDLES.map((bundle, index) => {
    const sourceGroup = X_RAY_GROUPS[(dayIndex + index) % X_RAY_GROUPS.length];
    return {
      id: `${bundle.id}:${sourceGroup.id}`,
      label: `${bundle.label} on ${sourceGroup.id}`,
      query: `(${sourceGroup.sites.join(" OR ")}) ${bundle.query}`,
      shardId: bundle.id,
      sourceGroupId: sourceGroup.id,
      freshness,
    };
  });
}

export function buildSearchPlan({ date = new Date(), exploratoryCount = 2 } = {}) {
  const dayIndex = Math.floor(date.getTime() / 86400000);
  const exploratory = Array.from({ length: exploratoryCount }, (_, index) => (
    EXPLORATORY_QUERIES[(dayIndex + index) % EXPLORATORY_QUERIES.length]
  ));
  return {
    version: "analytics-first-2026-07-14.v4",
    generatedAt: date.toISOString(),
    titleFamilies: TITLE_FAMILIES.map(({ id, label }) => ({ id, label })),
    portals: JOB_PORTALS,
    atsSources: ATS_SOURCES,
    localBrowserQueries: buildLocalBrowserSearchPlan({ date }),
    serpQueries: QUERY_BUNDLES.map((item) => ({ ...item, freshness: "today" })),
    braveQueries: buildLocalBrowserSearchPlan({ date }).map((item) => ({
      ...item,
      query: `${item.query} (job OR career OR hiring)`,
    })),
    exploratoryQueries: exploratory.map((query, index) => ({
      id: `exploratory-${index + 1}`,
      label: "Exploratory responsibility search",
      query,
    })),
  };
}

export function getManualDiscoveryUrls(urls = []) {
  const envUrls = String(process.env.JOBSEARCH_DISCOVERY_URLS || "").split(",");
  return [...envUrls, ...urls].map((value) => String(value || "").trim()).filter(Boolean);
}

export function manualCandidatesFromUrls(urls = []) {
  return getManualDiscoveryUrls(urls).map((url) => ({
    sourceId: `manual_${createHash("sha256").update(url).digest("hex").slice(0, 18)}`,
    title: "Manual job URL",
    company: "Unknown until extraction",
    description: "",
    url,
    location: "",
    postedAt: null,
    sourceQuery: "manual_url",
    sourceProvider: "manual_url",
  }));
}
