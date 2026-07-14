const ONTOLOGY_VERSION = "2026-07-14.analytics-first-v3";

const PHRASE_NORMALIZATIONS = [
  [/\bartificial intelligence\b/g, "ai"],
  [/\bgenerative ai\b|\bgen ai\b/g, "genai"],
  [/\bmachine learning\b/g, "ml"],
  [/\bbusiness intelligence\b/g, "bi"],
  [/\bvice president\b/g, "vp"],
  [/\bsenior vice president\b/g, "svp"],
  [/\bexecutive vice president\b/g, "evp"],
];

const TOKEN_NORMALIZATIONS = new Map([
  ["analyses", "analysis"],
  ["analyst", "analytics"],
  ["analysts", "analytics"],
  ["analytic", "analytics"],
  ["analytics", "analytics"],
  ["scientist", "science"],
  ["scientists", "science"],
  ["strategic", "strategy"],
  ["strategies", "strategy"],
  ["engineer", "engineering"],
  ["engineers", "engineering"],
  ["architect", "architecture"],
  ["architects", "architecture"],
  ["products", "product"],
  ["managerial", "manager"],
  ["management", "manager"],
  ["mgr", "manager"],
  ["sr", "senior"],
  ["snr", "senior"],
  ["directors", "director"],
  ["leaders", "lead"],
  ["leading", "lead"],
  ["operations", "ops"],
  ["operational", "ops"],
  ["governance", "governance"],
  ["responsible", "responsible"],
]);

export function normalizeIntelligenceTitle(value) {
  let normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, replacement] of PHRASE_NORMALIZATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((token) => TOKEN_NORMALIZATIONS.get(token) || token)
    .join(" ");
}

function phrase(...values) {
  return values.map(normalizeIntelligenceTitle);
}

export const FUNCTION_CONCEPTS = [
  {
    id: "analytics_insights",
    familyId: "analytics_leadership",
    phrases: phrase(
      "analytics", "data analytics", "data analysis", "advanced analytics",
      "decision analytics", "risk analytics", "product analytics", "marketing analytics",
      "business intelligence", "decision intelligence", "data insights", "insights and analytics",
      "measurement science", "quantitative analytics", "customer analytics", "commercial analytics",
      "strategy analytics", "performance analytics", "growth analytics", "digital analytics",
      "revenue analytics", "sales analytics", "operations analytics", "business insights",
      "customer insights", "commercial insights", "marketing insights", "decision support",
    ),
  },
  {
    id: "data_decision_science",
    familyId: "product_decision_science",
    phrases: phrase(
      "data science", "decision science", "applied science", "product science",
      "behavioral science", "experimentation science", "advanced analytic",
      "statistical science", "machine learning science", "causal inference", "marketing science",
      "customer science", "growth data science", "marketing data science", "measurement",
      "experimentation", "ab testing", "multivariate testing", "conversion optimization",
    ),
  },
  {
    id: "ai_data_product",
    familyId: "ai_product_platform",
    phrases: phrase(
      "ai product", "genai product", "ml product", "data product", "data products",
      "ai platform", "ml platform", "intelligence product", "decision product",
      "technical product manager", "platform product manager", "decisioning product manager",
      "product experimentation", "product insights", "product data science", "analytics product",
      "data capabilities", "decisioning product", "insights product",
    ),
  },
  {
    id: "data_ai_strategy",
    familyId: "data_ai_strategy",
    phrases: phrase(
      "data strategy", "ai strategy", "analytics strategy", "digital strategy",
      "ai transformation", "data transformation", "digital transformation",
      "decision strategy", "credit strategy", "risk strategy", "data commercialization",
      "ai commercialization", "data and ai", "analytics and strategy", "strategy and analytics",
      "commercial strategy", "customer strategy", "marketing strategy", "acquisition strategy",
      "retention strategy", "lifecycle strategy", "growth strategy",
    ),
  },
  {
    id: "governance_model_risk",
    familyId: "ai_governance_model_risk",
    phrases: phrase(
      "ai governance", "responsible ai", "model risk", "model governance",
      "data governance", "data risk", "ai risk", "algorithmic risk",
      "model validation", "model oversight", "ai compliance", "data ethics",
    ),
  },
  {
    id: "data_platform_architecture",
    familyId: "data_ai_strategy",
    phrases: phrase(
      "data architecture", "analytics architecture", "ai architecture", "enterprise data",
      "data platform", "analytics platform",
      "data engineering", "analytics engineering", "machine learning engineering",
      "data management", "business systems", "decision systems", "data ecosystem",
      "modern data stack", "data enablement", "analytics enablement",
    ),
  },
  {
    id: "business_strategy_operations",
    familyId: "business_strategy_management",
    phrases: phrase(
      "strategy and operations", "business strategy", "business analytics", "business analysis",
      "business operations", "product operations", "ai operations", "data operations",
      "chief of staff", "founder office", "founders office", "decision support",
      "revenue strategy", "growth strategy", "operating strategy", "bizops",
      "strategic planning", "performance management", "organizational improvement",
    ),
  },
  {
    id: "ai_operator_context",
    familyId: "ai_operator_context",
    phrases: phrase(
      "ai operator", "context engineering", "llm evaluation", "model evaluation",
      "ai workflow", "agent operations", "ai enablement", "prompt engineering",
      "ai adoption", "ai solutions", "rag", "retrieval augmented generation",
    ),
  },
  {
    id: "finserv_decisioning",
    familyId: "fintech_finserv_leadership",
    phrases: phrase(
      "credit decisioning", "risk decisioning", "fraud strategy", "fraud analytics",
      "underwriting analytics", "payments analytics", "banking analytics",
      "financial services analytics", "portfolio analytics", "lending strategy",
      "pricing analytics", "capital markets analytics",
    ),
  },
];

export const SENIORITY_CONCEPTS = [
  { id: "manager", phrases: phrase("manager", "senior manager", "group manager") },
  { id: "director", phrases: phrase("director", "senior director", "executive director", "managing director", "associate director") },
  { id: "head", phrases: phrase("head", "global head", "functional head") },
  { id: "executive", phrases: phrase("vp", "svp", "evp", "chief", "general manager", "gm") },
  { id: "lead", phrases: phrase("lead", "global lead", "practice lead", "portfolio lead", "program lead") },
  { id: "senior_ic", phrases: phrase("senior", "principal", "senior principal", "staff", "senior staff", "fellow", "advisor", "consultant") },
  { id: "operator", phrases: phrase("owner", "operator", "founder in residence", "executive in residence") },
];

const EXCLUDED_PRIMARY_FUNCTIONS = [
  {
    id: "software_engineering",
    phrases: phrase(
      "software engineer", "backend engineer", "frontend engineer", "full stack engineer",
      "infrastructure engineer", "site reliability engineer", "developer", "devops engineer",
    ),
  },
  {
    id: "data_engineering_ic",
    phrases: phrase(
      "data engineer", "analytics engineer", "machine learning engineer", "ml engineer",
      "data platform engineer", "business intelligence developer",
    ),
  },
];

const SPECIALIST_EXCEPTIONS = [
  { familyId: "product_decision_science", phrases: phrase("product scientist", "decision scientist", "product data scientist") },
  { familyId: "ai_operator_context", phrases: phrase("context engineer", "ai operator", "llm evaluator", "ai evaluator") },
  { familyId: "business_strategy_management", phrases: phrase("business manager", "chief of staff") },
];

function containsPhrase(normalizedTitle, candidate) {
  return ` ${normalizedTitle} `.includes(` ${candidate} `);
}

function conceptMatches(normalizedTitle, concepts) {
  return concepts.flatMap((concept) => {
    const matchedPhrases = concept.phrases.filter((candidate) => containsPhrase(normalizedTitle, candidate));
    return matchedPhrases.length ? [{ ...concept, matchedPhrases }] : [];
  });
}

function chooseFamily(functionMatches) {
  const counts = new Map();
  for (const match of functionMatches) {
    counts.set(match.familyId, (counts.get(match.familyId) || 0) + match.matchedPhrases.length);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "exploratory";
}

export function classifyCandidateTitle(title) {
  const normalizedTitle = normalizeIntelligenceTitle(title);
  const functionMatches = conceptMatches(normalizedTitle, FUNCTION_CONCEPTS);
  const seniorityMatches = conceptMatches(normalizedTitle, SENIORITY_CONCEPTS);
  const excludedMatches = conceptMatches(normalizedTitle, EXCLUDED_PRIMARY_FUNCTIONS);
  const specialist = SPECIALIST_EXCEPTIONS.find((item) => (
    item.phrases.some((candidate) => containsPhrase(normalizedTitle, candidate))
  ));
  const distinctFunctionConcepts = new Set(functionMatches.map((item) => item.id)).size;
  const leadershipOverride = seniorityMatches.some((item) => ["manager", "director", "head", "executive"].includes(item.id))
    && functionMatches.some((item) => ["analytics_insights", "data_decision_science", "ai_data_product", "data_ai_strategy", "data_platform_architecture"].includes(item.id));
  const excludedPrimaryFunction = excludedMatches.length > 0 && !leadershipOverride;
  const standardMatch = !excludedPrimaryFunction && functionMatches.length > 0 && seniorityMatches.length > 0;
  const exploratoryMatch = !excludedPrimaryFunction && distinctFunctionConcepts >= 2;
  const eligible = Boolean(standardMatch || specialist || exploratoryMatch);
  const familyId = standardMatch ? chooseFamily(functionMatches) : specialist?.familyId || chooseFamily(functionMatches);

  return {
    ontologyVersion: ONTOLOGY_VERSION,
    title: String(title || ""),
    normalizedTitle,
    eligible,
    lane: standardMatch ? "function_and_seniority" : specialist ? "specialist_exception" : exploratoryMatch ? "multi_function_exploratory" : "not_candidate",
    familyId,
    functionConcepts: functionMatches.map((item) => ({ id: item.id, familyId: item.familyId, phrases: item.matchedPhrases })),
    seniorityConcepts: seniorityMatches.map((item) => ({ id: item.id, phrases: item.matchedPhrases })),
    excludedConcepts: excludedMatches.map((item) => ({ id: item.id, phrases: item.matchedPhrases })),
    reason: eligible
      ? standardMatch ? "Matched both target function and seniority." : specialist ? "Explicit target-role exception." : "Matched multiple target functions."
      : excludedPrimaryFunction
        ? "Primary title is an excluded engineering implementation function."
        : "Did not match both a target function and a target seniority concept.",
  };
}

export function buildBroadSearchShards() {
  const seniority = "(manager OR director OR head OR lead OR principal OR senior OR vp OR chief)";
  return [
    {
      id: "analytics",
      query: `((analytics OR "data analysis" OR "business intelligence" OR "business insights" OR "customer insights" OR "decision support") ${seniority})`,
    },
    {
      id: "science",
      query: `((("data science" OR "decision science" OR "applied science" OR "marketing science" OR "measurement science") ${seniority}) OR "Product Scientist" OR "Decision Scientist" OR "Product Data Scientist")`,
    },
    {
      id: "product-experimentation",
      query: `(("product analytics" OR experimentation OR measurement OR "causal inference" OR "conversion optimization" OR "growth analytics") ${seniority})`,
    },
    {
      id: "marketing-customer",
      query: `(("marketing analytics" OR "customer analytics" OR "commercial analytics" OR "customer insights" OR "retention analytics" OR "acquisition analytics" OR "lifecycle analytics") ${seniority})`,
    },
    {
      id: "data-product",
      query: `(("data product" OR "analytics product" OR "data strategy" OR "data platform" OR "data engineering" OR "data management" OR "data architecture") ${seniority})`,
    },
    {
      id: "strategy",
      query: `((("strategy and analytics" OR "strategy analytics" OR "analytics strategy" OR "business analytics" OR "performance analytics" OR "performance management" OR bizops) ${seniority}) OR "Business Manager" OR "Chief of Staff")`,
    },
    {
      id: "ai-product-operator",
      query: `((("AI product" OR "AI strategy" OR "AI enablement" OR "AI governance" OR "Responsible AI" OR "LLM evaluation" OR "technical product manager" OR "platform product manager" OR "decisioning product manager") ${seniority}) OR "AI Operator" OR "Context Engineer")`,
    },
    {
      id: "finserv",
      query: `((fintech OR payments OR credit OR banking OR insurance OR lending) (analytics OR "data science" OR "decision science" OR strategy OR "data product" OR decisioning) ${seniority})`,
    },
  ];
}

export { ONTOLOGY_VERSION };
