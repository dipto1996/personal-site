const ONTOLOGY_VERSION = "2026-07-11.v1";

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
      "measurement science", "quantitative analytics",
    ),
  },
  {
    id: "data_decision_science",
    familyId: "product_decision_science",
    phrases: phrase(
      "data science", "decision science", "applied science", "product science",
      "behavioral science", "experimentation science", "advanced analytic",
      "statistical science", "machine learning science", "causal inference",
    ),
  },
  {
    id: "ai_data_product",
    familyId: "ai_product_platform",
    phrases: phrase(
      "ai product", "genai product", "ml product", "data product", "data products",
      "ai platform", "ml platform", "intelligence product", "decision product",
      "product experimentation", "product insights", "product data science",
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
      "data platform", "analytics platform", "data engineering", "analytics engineering",
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
      "revenue strategy", "growth strategy", "operating strategy",
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
  { id: "strategic_ic", phrases: phrase("principal", "senior principal", "staff", "senior staff", "fellow") },
  { id: "operator", phrases: phrase("owner", "operator", "founder in residence", "executive in residence") },
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
  const specialist = SPECIALIST_EXCEPTIONS.find((item) => (
    item.phrases.some((candidate) => containsPhrase(normalizedTitle, candidate))
  ));
  const distinctFunctionConcepts = new Set(functionMatches.map((item) => item.id)).size;
  const standardMatch = functionMatches.length > 0 && seniorityMatches.length > 0;
  const exploratoryMatch = distinctFunctionConcepts >= 2;
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
    reason: eligible
      ? standardMatch ? "Matched both target function and seniority." : specialist ? "Explicit target-role exception." : "Matched multiple target functions."
      : "Did not match both a target function and a target seniority concept.",
  };
}

export function buildBroadSearchShards() {
  return [
    { id: "analytics", query: '("analytics" OR "data analysis" OR "business intelligence" OR "decision intelligence" OR "insights")' },
    { id: "science", query: '("data science" OR "decision science" OR "applied science" OR "product scientist" OR "causal inference")' },
    { id: "ai-data-product", query: '("AI product" OR "GenAI product" OR "ML product" OR "data product" OR "AI platform")' },
    { id: "strategy", query: '("data strategy" OR "AI strategy" OR "analytics strategy" OR "AI transformation" OR "digital transformation")' },
    { id: "governance-risk", query: '("AI governance" OR "responsible AI" OR "model risk" OR "data governance" OR "AI risk")' },
    { id: "architecture-platform", query: '("data architecture" OR "data platform" OR "data engineering" OR "analytics engineering" OR "data management")' },
    { id: "business-operator", query: '("strategy and operations" OR "business analytics" OR "chief of staff" OR "AI operator" OR "context engineer")' },
    { id: "finserv", query: '("credit decisioning" OR "risk analytics" OR "fraud strategy" OR "payments analytics" OR "underwriting analytics")' },
  ];
}

export { ONTOLOGY_VERSION };
