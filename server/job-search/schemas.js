import { z } from "zod";

import { TITLE_FAMILIES } from "./taxonomy.js";

const ROLE_FAMILY_IDS = new Set([...TITLE_FAMILIES.map((family) => family.id), "exploratory"]);
const confidenceSchema = z.number().min(0).max(100).transform((value) => (
  value <= 1 ? value : value <= 5 ? value / 5 : value / 100
));
const boundedText = (maximum) => z.string().trim().min(1).transform((value) => value.slice(0, maximum));
const boundedOptionalText = (maximum) => z.string().trim().transform((value) => value.slice(0, maximum));
const boundedModelText = (maximum, fallback) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value : fallback),
  boundedText(maximum),
);

export function normalizeRoleFamilyId(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (ROLE_FAMILY_IDS.has(normalized)) return normalized;
  if (/engineer|engineering|infrastructure|systems|security|support/.test(normalized)) return "exploratory";
  if (/fintech|financial|banking|payments|credit|capital_markets|insurance|risk_analytics/.test(normalized)) return "fintech_finserv_leadership";
  if (/product_scien|decision_scien|experimentation|measurement/.test(normalized)) return "product_decision_science";
  if (/ai_product|genai_product|product_manager|product_lead/.test(normalized)) return "ai_product_platform";
  if (/governance|model_risk|responsible_ai|compliance/.test(normalized)) return "ai_governance_model_risk";
  if (/analytics/.test(normalized)) return "analytics_leadership";
  if (/context|ai_operator|ai_operations|founder_operator|startup_operator/.test(normalized)) return "ai_operator_context";
  if (/business|strategy_manager|chief_of_staff|strategy_operations/.test(normalized)) return "business_strategy_management";
  if (/data_strategy|ai_strategy|data_ai_strategy|transformation/.test(normalized)) return "data_ai_strategy";
  return "exploratory";
}

export const evidenceSchema = z.object({
  claimType: z.string().min(1),
  value: z.string().min(1),
  sourceUrl: z.string().url().or(z.literal("")),
  supportingPassage: z.string().default(""),
  sourceDate: z.string().default(""),
  confidence: confidenceSchema,
  evidenceType: z.enum(["explicit", "inferred", "unknown"]),
});

export const groundedEvidenceSchema = evidenceSchema.superRefine((claim, context) => {
  if (["explicit", "inferred"].includes(claim.evidenceType)) {
    if (!claim.sourceUrl) {
      context.addIssue({ code: "custom", path: ["sourceUrl"], message: "Grounded claims require a source URL." });
    }
    if (!claim.supportingPassage.trim()) {
      context.addIssue({ code: "custom", path: ["supportingPassage"], message: "Grounded claims require a supporting passage." });
    }
  }
});

export const evidenceExtractionSchema = z.object({
  claims: z.array(groundedEvidenceSchema).max(20).default([]),
  unknowns: z.array(z.string().min(1)).max(10).default([]),
});

const cloudGroundedEvidenceSchema = evidenceSchema.extend({
  claimType: boundedText(64),
  value: boundedText(180),
  sourceUrl: z.string().url(),
  supportingPassage: boundedText(240),
  sourceDate: boundedOptionalText(40).default(""),
  evidenceType: z.enum(["explicit", "inferred"]),
});

export const cloudEvidenceExtractionSchema = z.object({
  claims: z.array(cloudGroundedEvidenceSchema).transform((items) => items.slice(0, 6)).default([]),
  unknowns: z.array(boundedText(180)).transform((items) => items.slice(0, 6)).default([]),
});

export const triageSchema = z.object({
  roleFamilyId: z.string().min(1).transform(normalizeRoleFamilyId),
  relevance: z.enum(["relevant", "uncertain", "irrelevant"]),
  confidence: confidenceSchema,
  scopeSummary: z.string().min(1).default("No scope summary returned."),
  codingIntensity: z.enum(["low", "medium", "high", "unknown"]).default("unknown"),
  seniority: z.enum(["too_junior", "aligned", "stretch", "unknown"]).default("unknown"),
  reasons: z.array(z.string()).max(8).default([]),
  unknowns: z.array(z.string()).max(8).default([]),
});

export const triageBatchSchema = z.object({
  jobs: z.array(z.object({
    sourceId: z.string().min(1),
    evaluation: triageSchema,
  })).min(1).max(8),
});

const dimensionSchema = z.object({
  score: z.number().min(0).max(5).nullable().default(null),
  evidenceStatus: z.enum(["explicit", "inferred", "unknown"]).default("unknown"),
  confidence: confidenceSchema.default(0),
  reasoning: z.string().min(1),
});

const mustHaveGateSchema = z.object({
  status: z.enum(["met", "blocked", "unknown"]),
  evidenceStatus: z.enum(["explicit", "inferred", "unknown"]).default("unknown"),
  reasoning: z.string().min(1),
  sourceUrl: z.string().url().or(z.literal("")).default(""),
});

export const deepEvaluationSchema = z.object({
  verdict: z.enum(["apply", "maybe", "pass"]),
  overallScore: z.number().min(0).max(100),
  summary: z.string().min(1),
  dimensions: z.object({
    expertiseFit: dimensionSchema,
    workAuthorization: dimensionSchema,
    compensation: dimensionSchema,
    codingInterviewSafety: dimensionSchema,
    leadershipScope: dimensionSchema,
    companyQuality: dimensionSchema,
    interviewVelocity: dimensionSchema,
    aiMlProductAdjacency: dimensionSchema,
    financialServicesAdvantage: dimensionSchema,
    remoteFlexibility: dimensionSchema,
  }),
  mustHave: z.object({
    expertiseFit: mustHaveGateSchema,
    workAuthorization: mustHaveGateSchema,
    compensation: mustHaveGateSchema,
    codingInterview: mustHaveGateSchema,
  }),
  claims: z.array(groundedEvidenceSchema).max(30).default([]),
  redFlags: z.array(z.string()).max(10).default([]),
  greenFlags: z.array(z.string()).max(10).default([]),
  unknowns: z.array(z.string()).max(10).default([]),
  outreachAngle: z.string().default(""),
});

const cloudDimensionSchema = z.object({
  score: z.number().min(0).max(5).nullable().default(null),
  evidenceStatus: z.enum(["explicit", "inferred", "unknown"]).default("unknown"),
  confidence: confidenceSchema.default(0),
  reasoning: boundedModelText(240, "Evidence not established."),
});

const cloudMustHaveGateSchema = z.object({
  status: z.enum(["met", "blocked", "unknown"]),
  evidenceStatus: z.enum(["explicit", "inferred", "unknown"]).default("unknown"),
  reasoning: boundedModelText(260, "Evidence not established."),
  sourceUrl: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string().url().or(z.literal(""))),
});

export const cloudDeepEvaluationSchema = z.object({
  verdict: z.enum(["apply", "maybe", "pass"]).default("maybe"),
  overallScore: z.number().int().min(0).max(100).default(50),
  summary: boundedModelText(500, "Model evaluation completed; deterministic gates decide the final verdict."),
  dimensions: z.object({
    expertiseFit: cloudDimensionSchema,
    workAuthorization: cloudDimensionSchema,
    compensation: cloudDimensionSchema,
    codingInterviewSafety: cloudDimensionSchema,
    leadershipScope: cloudDimensionSchema,
    companyQuality: cloudDimensionSchema,
    interviewVelocity: cloudDimensionSchema,
    aiMlProductAdjacency: cloudDimensionSchema,
    financialServicesAdvantage: cloudDimensionSchema,
    remoteFlexibility: cloudDimensionSchema,
  }),
  mustHave: z.object({
    expertiseFit: cloudMustHaveGateSchema,
    workAuthorization: cloudMustHaveGateSchema,
    compensation: cloudMustHaveGateSchema,
    codingInterview: cloudMustHaveGateSchema,
  }),
  claims: z.array(cloudGroundedEvidenceSchema).transform((items) => items.slice(0, 6)).default([]),
  redFlags: z.array(boundedText(180)).transform((items) => items.slice(0, 6)).default([]),
  greenFlags: z.array(boundedText(180)).transform((items) => items.slice(0, 6)).default([]),
  unknowns: z.array(boundedText(180)).transform((items) => items.slice(0, 6)).default([]),
  outreachAngle: boundedOptionalText(320).default(""),
});

const modelStringListSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value).map(String);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}, z.array(z.string()).transform((items) => items.slice(0, 10)));

export const criticSchema = z.object({
  agrees: z.boolean(),
  recommendedVerdict: z.enum(["apply", "maybe", "pass"]),
  confidence: confidenceSchema,
  objections: modelStringListSchema.default([]),
  unsupportedClaims: modelStringListSchema.default([]),
  summary: z.string().min(1),
});

export const taxonomyProposalSchema = z.object({
  familyId: z.string().min(1).transform(normalizeRoleFamilyId),
  familyLabel: z.string().min(1),
  confidence: confidenceSchema,
  rationale: z.string().min(1),
});

export const outreachSchema = z.object({
  subject: z.string().max(160).default(""),
  message: z.string().min(1).max(1600),
});

export function parseStructuredContent(schema, content) {
  const raw = String(content || "").trim();
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Model response did not contain a JSON object.");
    }
    parsed = JSON.parse(match[0]);
  }

  return schema.parse(parsed);
}
