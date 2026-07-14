import { parseCsv } from "./utils.js";

export const DEFAULT_OWNER_EMAILS = ["roydiptopal1996@gmail.com"];

export const TARGET_PROFILE = {
  version: "2026-07-14-analytics-first-v6",
  headline: "Analytics, experimentation, product analytics, and data science leader; AI product founder",
  baseline:
    process.env.JOBSEARCH_CANDIDATE_BASELINE
    || "Cornell Tech STEM MBA and analytics/data-science leader with 8 years across American Express and zero-to-one startups. At American Express, served as Manager, Data Science and led five data scientists for US commercial retention; owned churn, spend, forecasting, sentiment, marketing-treatment, gamer-suppression, and NPV modeling that drove $500M+ incremental billings and $12M annual profit. Previously led digital acquisition and product analytics, built an enterprise clickstream data product with 400+ behavioral indicators, ran conversion optimization and multivariate/A/B experimentation associated with $430M incremental acquisition revenue, and delivered forecasting, KPI/funnel dashboards, and executive decision support. The demonstrated core is analytics leadership, experimentation and causal measurement, product/growth/marketing/customer analytics, data-science management for marketing and customer models, strategy analytics, decision science, and data products. Founder/CTO work adds zero-to-one product management, AI-product strategy, RAG, agent workflows, governance, evaluations, data pipelines, and data architecture. Financial-services depth and AI-product experience are advantages, not prerequisites. Different industries, including public-sector work, are valid when the responsibilities match the demonstrated core. Avoid backend/software/data/ML-engineering IC work and hiring processes that require coding assessments.",
  coreExpertise: [
    "analytics leadership and executive decision support",
    "experimentation, A/B testing, multivariate testing, causal measurement, and conversion optimization",
    "product analytics, growth analytics, KPI/funnel analytics, and customer behavior analytics",
    "marketing, acquisition, retention, lifecycle, and commercial analytics",
    "data-science management for predictive marketing and customer models",
    "strategy analytics, business analytics, forecasting, and decision science",
    "data products, clickstream data capabilities, and analytics platforms",
    "cross-functional product strategy and zero-to-one product building",
  ],
  differentiators: [
    "financial-services, cards, payments, credit, acquisition, and retention domain depth",
    "AI/ML product strategy, RAG, agentic systems, evaluations, governance, and data architecture",
    "people leadership, executive stakeholder management, and large measured financial impact",
    "founder and operator experience across regulated technology and B2B ventures",
  ],
  targetGeography:
    "Prioritize US roles. Remote work is a minor convenience only, not a requirement and not a proxy for work authorization. Global remote roles that can employ the candidate are also acceptable.",
  compensation:
    "Required target is at least USD 170,000 annual base or clearly comparable guaranteed cash. USD 200,000+ base and additional equity are bonuses. Missing compensation requires research or manual review; it is never scored as zero merely because it is unknown.",
  workAuthorization:
    "Candidate is an F-1 STEM MBA graduate seeking employers that can employ F-1 OPT/STEM OPT talent and support future work authorization. F-1/OPT/CPT acceptance proves current compatibility only, not future sponsorship. Explicit no-current-or-future-sponsorship, citizenship, or clearance restrictions are blockers. Verified E-Verify participation and recent government H-1B/LCA history are positive employer-level evidence but do not override an explicit job-level restriction.",
  hardRequirements: {
    expertiseFit: "Primary responsibilities must substantially match the candidate's demonstrated analytics, experimentation, product analytics, marketing/customer data science, strategy analytics, data-product, or product-builder experience.",
    workAuthorization: "The role must be compatible with F-1 OPT/STEM OPT and credible future sponsorship. Explicit incompatibility is a blocker; missing evidence requires review.",
    compensation: "The listed or credibly researched annual base must reach USD 170,000. A confirmed maximum below USD 170,000 is a blocker; missing evidence requires review.",
    codingInterview: "The hiring process must not require software-engineering-style coding, algorithms, data structures, LeetCode, or role-specific SQL/Python coding assessments. Explicit coding rounds are blockers. Engineering and coding-bound scientist IC archetypes are treated as near-certain blockers unless role-specific contrary evidence exists. Product/decision-science and data-science-management roles have elevated but unconfirmed risk and require review; analytics/strategy leadership has lower inferred risk but remains unverified until the company process is established.",
  },
  evaluationPolicy: {
    rankingOrder: [
      "demonstrated expertise and responsibility fit",
      "F-1 OPT/STEM OPT compatibility and credible future sponsorship",
      "annual base compensation of at least USD 170,000",
      "no software-engineering-style or role-specific SQL/Python coding assessment",
      "leadership scope, company quality, interview velocity, AI/ML adjacency, financial-services advantage, and remote flexibility",
    ],
    directCoreMatches: [
      "analytics, insights, business intelligence, and executive decision support leadership",
      "experimentation, A/B testing, multivariate testing, causal measurement, and conversion optimization",
      "product, growth, funnel, KPI, customer-behavior, marketing, acquisition, retention, lifecycle, and commercial analytics",
      "data-science management for marketing, customer, churn, spend, forecasting, sentiment, treatment, suppression, and NPV models",
      "strategy analytics, decision science, business analytics, forecasting, and performance management",
      "data products, clickstream capabilities, analytics platforms, and cross-functional zero-to-one product building",
    ],
    roleFitScale: {
      5: "Direct match across several demonstrated core areas with comparable or greater ownership.",
      4: "Strong match to at least one major demonstrated core area with credible scope.",
      3: "Partial but substantive match that uses transferable demonstrated experience.",
      2: "Adjacent role with limited use of demonstrated core experience.",
      1: "Predominantly outside demonstrated expertise.",
      0: "Clearly incompatible primary function.",
    },
    neverPenalizeCoreFitFor: [
      "industry being outside financial services",
      "public-sector context",
      "lack of AI or generative-AI responsibilities",
      "US onsite or hybrid work",
      "lack of remote-from-India flexibility",
      "missing compensation, sponsorship, or interview-process evidence; these are separate unknown gates",
    ],
    triageRule: "Triage answers only whether the primary responsibilities plausibly match the demonstrated core. Eligibility, compensation, coding-interview risk, company prestige, industry, AI content, and remote flexibility cannot make a functionally relevant role irrelevant.",
  },
  rankingWeights: {
    expertiseFit: 35,
    workAuthorization: 20,
    compensation: 15,
    codingInterviewSafety: 10,
    leadershipScope: 5,
    companyQuality: 4,
    interviewVelocity: 3,
    aiMlProductAdjacency: 3,
    financialServicesAdvantage: 3,
    remoteFlexibility: 2,
  },
  desiredTitles: [
    "Analytics Manager",
    "Senior Analytics Manager",
    "Director of Analytics",
    "Head of Analytics",
    "Data Science Manager",
    "Manager of Data Science",
    "Senior Manager, Data Science",
    "Director of Data Science",
    "Product Analytics Manager",
    "Director of Product Analytics",
    "Marketing Analytics Manager",
    "Customer Analytics Manager",
    "Commercial Analytics Manager",
    "Experimentation Lead",
    "Experimentation Manager",
    "Decision Science Manager",
    "Product Scientist",
    "Data Product Manager",
    "Data Products Lead",
    "Strategy and Analytics Lead",
    "Business Manager",
    "AI Product Manager",
    "AI Product Lead",
    "GenAI Platform Lead",
    "AI Operator",
    "Context Engineer",
    "Data Strategy Director",
    "Head of Data",
    "AI Strategy Lead",
  ],
  avoid:
    "Backend, full-stack, front-end, data-engineering, analytics-engineering, or ML-engineering IC roles whose primary function is production implementation; software-engineering coding screens; LeetCode; algorithms and data structures interviews; daily pager-duty services ownership. Python, SQL, statistics, or model-building in an analytics/data-science role are not by themselves disqualifying.",
  outreachIdentity: "analytics and data-science leader and AI product founder",
};

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
