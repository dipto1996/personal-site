import { createHash } from "node:crypto";

export const TITLE_FAMILIES = [
  {
    id: "analytics_leadership",
    label: "Analytics, insights, and measurement leadership",
    aliases: [
      "analytics manager",
      "senior analytics manager",
      "manager analytics",
      "director of analytics",
      "director analytics",
      "head of analytics",
      "analytics lead",
      "analytics strategy lead",
      "strategy and analytics lead",
      "strategic analytics lead",
      "product analytics manager",
      "director product analytics",
      "marketing analytics manager",
      "director marketing analytics",
      "customer analytics manager",
      "commercial analytics manager",
      "business intelligence manager",
      "insights manager",
      "director of insights",
      "measurement lead",
      "performance analytics manager",
    ],
  },
  {
    id: "product_decision_science",
    label: "Data science, product analytics, and experimentation",
    aliases: [
      "data science manager",
      "manager of data science",
      "senior manager data science",
      "director of data science",
      "director data science",
      "product scientist",
      "decision scientist",
      "product data scientist",
      "senior product data scientist",
      "applied scientist product",
      "experimentation lead",
      "experimentation manager",
      "decision science manager",
      "measurement science lead",
      "growth data science lead",
      "marketing science lead",
    ],
  },
  {
    id: "ai_product_platform",
    label: "AI product / platform",
    aliases: [
      "ai product manager",
      "ai product lead",
      "genai product manager",
      "genai platform lead",
      "machine learning product manager",
      "director ai product",
      "head of ai product",
    ],
  },
  {
    id: "data_ai_strategy",
    label: "Data / AI strategy",
    aliases: [
      "data strategy director",
      "director data strategy",
      "ai strategy lead",
      "director ai strategy",
      "head of data strategy",
      "ai transformation lead",
      "data products lead",
      "data product manager",
      "senior data product manager",
      "director data products",
      "analytics product manager",
      "decision products lead",
    ],
  },
  {
    id: "business_strategy_management",
    label: "Business / strategy management",
    aliases: [
      "business manager",
      "strategy manager",
      "senior strategy manager",
      "business strategy lead",
      "chief of staff ai",
      "strategy and operations lead",
      "business analytics manager",
      "strategy and analytics manager",
      "bizops and analytics manager",
      "commercial strategy manager",
    ],
  },
  {
    id: "ai_governance_model_risk",
    label: "AI governance / model risk",
    aliases: [
      "ai governance lead",
      "responsible ai lead",
      "model risk director",
      "ai risk manager",
      "data governance director",
      "ai compliance lead",
    ],
  },
  {
    id: "ai_operator_context",
    label: "AI operator / context engineering",
    aliases: [
      "ai operator",
      "context engineer",
      "llm evaluation lead",
      "ai operations lead",
      "ai workflow lead",
      "founder office ai",
    ],
  },
  {
    id: "fintech_finserv_leadership",
    label: "Fintech / financial-services leadership",
    aliases: [
      "fintech strategy lead",
      "financial services analytics director",
      "credit strategy manager",
      "payments analytics director",
      "risk analytics director",
      "banking data strategy lead",
    ],
  },
];

export function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\b(sr|sr\.|sen)\b/g, "senior")
    .replace(/\b(vp)\b/g, "vice president")
    .replace(/\s+/g, " ")
    .trim();
}

function stableId(...parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 18);
}

export function seedTitlePatterns() {
  const createdAt = new Date(0).toISOString();
  return TITLE_FAMILIES.flatMap((family) => family.aliases.map((alias) => ({
    id: `pattern_${stableId(family.id, alias)}`,
    familyId: family.id,
    familyLabel: family.label,
    matchType: "exact",
    expression: normalizeTitle(alias),
    status: "active",
    source: "seed",
    version: 1,
    supportCount: 1,
    metrics: { seeded: true, positiveRegressions: 0 },
    createdAt,
    updatedAt: createdAt,
  })));
}

export function compilePattern(pattern) {
  const expression = normalizeTitle(pattern?.expression);
  if (!expression) {
    return () => false;
  }

  if (pattern.matchType === "prefix") {
    return (title) => normalizeTitle(title).startsWith(expression);
  }

  if (pattern.matchType === "token_set") {
    const required = new Set(expression.split(" ").filter(Boolean));
    return (title) => {
      const tokens = new Set(normalizeTitle(title).split(" ").filter(Boolean));
      return [...required].every((token) => tokens.has(token));
    };
  }

  return (title) => normalizeTitle(title) === expression;
}

export function classifyTitle(title, patterns = seedTitlePatterns()) {
  const normalizedTitle = normalizeTitle(title);
  const matches = patterns
    .filter((pattern) => pattern.status === "active" && compilePattern(pattern)(normalizedTitle))
    .sort((left, right) => {
      const priority = { exact: 3, prefix: 2, token_set: 1 };
      return (priority[right.matchType] || 0) - (priority[left.matchType] || 0);
    });
  const match = matches[0] || null;

  return {
    normalizedTitle,
    familyId: match?.familyId || "exploratory",
    familyLabel: match?.familyLabel || "Exploratory / unknown title",
    matchedPatternId: match?.id || null,
    lane: match ? "title_family" : "exploratory",
  };
}

export function buildAliasProposal({ title, familyId, familyLabel, confidence = 0, source = "glm_flash" }) {
  const expression = normalizeTitle(title);
  if (!expression || !TITLE_FAMILIES.some((family) => family.id === familyId)) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: `pattern_${stableId(familyId, expression)}`,
    familyId,
    familyLabel: familyLabel || TITLE_FAMILIES.find((family) => family.id === familyId)?.label || familyId,
    matchType: "exact",
    expression,
    status: "proposed",
    source,
    version: 1,
    supportCount: 1,
    metrics: {
      modelConfidence: Number(confidence) || 0,
      positiveRegressions: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function evaluateProposalForPromotion(proposal, labelledJobs = []) {
  const matcher = compilePattern(proposal);
  const impacted = labelledJobs.filter((job) => matcher(job.title));
  const positiveRegressions = impacted.filter((job) => (
    job.disposition === "apply" && job.roleFamilyId && job.roleFamilyId !== proposal.familyId
  )).length;
  const explicitPositive = impacted.some((job) => job.disposition === "apply");
  const confidence = Number(proposal.metrics?.modelConfidence) || 0;
  const safeType = ["exact", "token_set"].includes(proposal.matchType);
  const enoughSupport = explicitPositive || Number(proposal.supportCount) >= 3;

  return {
    impacted: impacted.length,
    positiveRegressions,
    explicitPositive,
    autoPromote: safeType && enoughSupport && confidence >= 0.9 && positiveRegressions === 0,
  };
}

export function titleFamilyById(id) {
  return TITLE_FAMILIES.find((family) => family.id === id) || null;
}
