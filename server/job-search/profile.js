import { parseCsv } from "./utils.js";

export const DEFAULT_OWNER_EMAILS = ["roydiptopal1996@gmail.com"];

export const TARGET_PROFILE = {
  version: "2026-07-10-fit-first-open-source",
  headline: "AI product founder, data science and analytics leader, fintech/finserv operator",
  baseline:
    process.env.JOBSEARCH_CANDIDATE_BASELINE
    || "Cornell Tech MBA and data/AI leader. Former American Express Manager, Data Science leading a five-person team and shipping decisioning, experimentation, and ML systems associated with $400M+ in financial impact, including $12M annual profit and a $430M experimentation program. AI product founder and operator with fintech and financial-services depth, production RAG, data architecture, model governance, 250+ deterministic rules, 32 agent workflows, and a 612-case evaluation suite. Targets AI product, product scientist, data/AI strategy, analytics leadership, business management, AI governance, AI operator, context engineering, and fintech/financial-services leadership. Avoids backend IC engineering and coding-interview-heavy tracks.",
  targetGeography:
    "US roles plus global remote roles that can be continued from India; remote-from-India evidence is a strong bonus.",
  compensation:
    "Prefer 120k+ USD cash or credible high-equity upside. 200k+ base is excellent, but not a hard reject below that.",
  desiredTitles: [
    "AI Product Manager",
    "AI Product Lead",
    "GenAI Platform Lead",
    "Product Scientist",
    "Business Manager",
    "AI Operator",
    "Context Engineer",
    "Analytics Manager",
    "Senior Analytics Manager",
    "Director of Analytics",
    "Data Strategy Director",
    "Head of Data",
    "AI Strategy Lead",
  ],
  avoid:
    "Backend IC engineering, full-stack/front-end IC engineering, coding screens, LeetCode, data structures and algorithms, daily pager-duty services ownership.",
  outreachIdentity: "AI product founder",
};

export const ROLE_FAMILIES = [
  {
    id: "ai_product",
    label: "AI product / GenAI platform",
    patterns: [
      /\bai product\b/i,
      /\bgenai\b/i,
      /\bllm\b/i,
      /\brag\b/i,
      /\bagentic\b/i,
      /\bai platform\b/i,
      /\bproduct lead\b/i,
    ],
  },
  {
    id: "product_science",
    label: "Product science / experimentation",
    patterns: [
      /\bproduct scientist\b/i,
      /\bexperimentation\b/i,
      /\bcausal\b/i,
      /\bmeasurement\b/i,
      /\bgrowth analytics\b/i,
    ],
  },
  {
    id: "analytics_strategy",
    label: "Analytics leadership / strategy",
    patterns: [
      /\banalytics manager\b/i,
      /\bdirector of analytics\b/i,
      /\bdata strategy\b/i,
      /\bbusiness manager\b/i,
      /\bstrategy\b/i,
      /\boperating model\b/i,
    ],
  },
  {
    id: "data_architecture",
    label: "Data architecture / governance",
    patterns: [
      /\bdata architecture\b/i,
      /\bdata platform\b/i,
      /\bgovernance\b/i,
      /\bmodel risk\b/i,
      /\bcontrols?\b/i,
      /\bcompliance\b/i,
    ],
  },
  {
    id: "ai_operator",
    label: "AI operator / startup operating role",
    patterns: [
      /\bai operator\b/i,
      /\bfounder.?operator\b/i,
      /\bchief of staff\b/i,
      /\bcontext engineer\b/i,
      /\bstartup\b/i,
      /\bseries [abc]\b/i,
    ],
  },
];

export function ownerEmails() {
  const configured = parseCsv(process.env.JOBSEARCH_OWNER_EMAILS)
    .map((email) => email.toLowerCase())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_OWNER_EMAILS;
}

export function getConfiguredAtsSources() {
  return {
    greenhouse: parseCsv(process.env.JOBSEARCH_GREENHOUSE_BOARDS),
    lever: parseCsv(process.env.JOBSEARCH_LEVER_COMPANIES),
    ashby: parseCsv(process.env.JOBSEARCH_ASHBY_COMPANIES),
    workday: parseCsv(process.env.JOBSEARCH_WORKDAY_SOURCES),
    smartrecruiters: parseCsv(process.env.JOBSEARCH_SMARTRECRUITERS_COMPANIES),
  };
}

function statusFor(value, configuredLabel = "configured", missingLabel = "missing") {
  return value ? configuredLabel : missingLabel;
}

export function getApiKeyChecklist() {
  const atsSources = getConfiguredAtsSources();

  return [
    {
      key: "DATABASE_URL",
      requiredFor: "Production persistence",
      usage: "Stores owner account, sessions, saved jobs, run history, evidence, and feedback.",
      status: statusFor(process.env.DATABASE_URL, "configured", "local-json fallback"),
    },
    {
      key: "CRON_SECRET",
      requiredFor: "Production scheduled ingest",
      usage: "Protects the Vercel cron endpoint so only the scheduler can trigger ingestion.",
      status: statusFor(process.env.CRON_SECRET),
    },
    {
      key: "JOBSEARCH_OWNER_EMAILS",
      requiredFor: "Access control",
      usage: "Allowlist for the login-gated private job-search dashboard.",
      status: statusFor(process.env.JOBSEARCH_OWNER_EMAILS || DEFAULT_OWNER_EMAILS.length),
    },
    { key: "SERPAPI_API_KEY", requiredFor: "Daily Google Jobs discovery", usage: "Runs eight date-filtered Google Jobs queries per day.", status: statusFor(process.env.SERPAPI_API_KEY) },
    { key: "BRAVE_SEARCH_API_KEY", requiredFor: "Long-tail discovery and evidence research", usage: "Finds unusual roles, eligibility evidence, company facts, and hiring contacts.", status: statusFor(process.env.BRAVE_SEARCH_API_KEY) },
    { key: "TAVILY_API_KEY", requiredFor: "Extraction fallback", usage: "Extracts job pages only after direct HTML and JSON-LD extraction fails.", status: statusFor(process.env.TAVILY_API_KEY) },
    { key: "ZAI_API_KEY", requiredFor: "GLM reasoning", usage: "Runs free GLM-4.7-Flash triage and drafting plus budgeted GLM-5.2 finalist evaluation.", status: statusFor(process.env.ZAI_API_KEY) },
    { key: "MOONSHOT_API_KEY", requiredFor: "Independent finalist criticism", usage: "Runs Kimi K2.5 on the strongest or most uncertain finalists.", status: statusFor(process.env.MOONSHOT_API_KEY) },
    { key: "INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY", requiredFor: "Durable workflows", usage: "Enqueues, authenticates, retries, and schedules the twice-daily pipeline.", status: statusFor(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY) },
    {
      key: "JOBSEARCH_* ATS SOURCES",
      requiredFor: "Optional direct ATS ingestion",
      usage: "Fetches Greenhouse, Lever, Ashby, Workday, and SmartRecruiters sources directly.",
      status: Object.values(atsSources).some((sources) => sources.length)
        ? "configured"
        : "not configured",
    },
  ];
}
