import { createHash } from "node:crypto";

import { z } from "zod";

import { TARGET_PROFILE } from "./profile.js";
import {
  criticSchema,
  deepEvaluationSchema,
  evidenceSchema,
  outreachSchema,
  triageSchema,
} from "./schemas.js";

export const WORKER_PROTOCOL_VERSION = "job-worker-2026-07-v1";
export const WORKER_LIMITS = Object.freeze({
  contextTokens: 4096,
  concurrency: 1,
  leaseSeconds: 1200,
  heartbeatSeconds: 30,
  idleShutdownSeconds: 300,
  maxDescriptionCharacters: 12000,
  maxEvidenceItems: 20,
  maxSupportingPassageCharacters: 700,
});

const workerGroundedEvidenceSchema = evidenceSchema.extend({
  sourceUrl: z.string().url(),
  supportingPassage: z.string().trim().min(1),
  evidenceType: z.enum(["explicit", "inferred"]),
});

const workerEvidenceExtractionSchema = z.object({
  claims: z.array(workerGroundedEvidenceSchema).max(20).default([]),
  unknowns: z.array(z.string().min(1)).max(10).default([]),
});

const deepWorkerEvaluationSchema = deepEvaluationSchema.extend({
  verdict: z.enum(["apply", "maybe", "pass"]).describe("apply means pursue; maybe means manual review; pass means reject or skip"),
  overallScore: z.number().int().min(0).max(100).describe("integer attractiveness score from 0 to 100, never a 0-to-5 dimension score"),
  claims: z.array(workerGroundedEvidenceSchema).max(20).default([]),
}).superRefine((evaluation, context) => {
  const dimensions = Object.values(evaluation.dimensions || {});
  const averageDimension = dimensions.length
    ? dimensions.reduce((sum, dimension) => sum + Number(dimension.score || 0), 0) / dimensions.length
    : 0;
  if (evaluation.verdict === "apply" && evaluation.overallScore < 70) {
    context.addIssue({ code: "custom", path: ["overallScore"], message: "An apply verdict requires an overall score of at least 70." });
  }
  if (evaluation.verdict === "maybe" && (evaluation.overallScore < 40 || evaluation.overallScore > 84)) {
    context.addIssue({ code: "custom", path: ["overallScore"], message: "A maybe verdict requires an overall score from 40 through 84." });
  }
  if (evaluation.verdict === "pass" && evaluation.overallScore > 50) {
    context.addIssue({ code: "custom", path: ["overallScore"], message: "A pass (reject/skip) verdict cannot score above 50." });
  }
  if (averageDimension >= 4 && evaluation.verdict === "pass") {
    context.addIssue({ code: "custom", path: ["verdict"], message: "High dimension scores contradict a pass (reject/skip) verdict." });
  }
  if (averageDimension <= 2 && evaluation.verdict === "apply") {
    context.addIssue({ code: "custom", path: ["verdict"], message: "Low dimension scores contradict an apply (pursue) verdict." });
  }
});

export const workerOutputs = Object.freeze({
  triage: z.object({ triage: triageSchema }),
  deep: z.object({ extraction: workerEvidenceExtractionSchema, evaluation: deepWorkerEvaluationSchema }),
  critic: z.object({ critic: criticSchema }),
  outreach: z.object({ outreach: outreachSchema }),
});

function compactString(value, max) {
  return String(value || "").trim().slice(0, max);
}

function compactEvidence(item) {
  return {
    claimType: compactString(item?.claimType || item?.type || "source_evidence", 80),
    value: compactString(item?.value || item?.title || item?.description, 500),
    sourceUrl: compactString(item?.sourceUrl || item?.url, 2000),
    supportingPassage: compactString(item?.supportingPassage || item?.description, WORKER_LIMITS.maxSupportingPassageCharacters),
    sourceDate: compactString(item?.sourceDate || item?.age, 80),
    confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0.7)),
    evidenceType: ["explicit", "inferred", "unknown"].includes(item?.evidenceType)
      ? item.evidenceType
      : "explicit",
  };
}

function uniqueEvidence(items) {
  const byKey = new Map();
  for (const item of items) {
    const compacted = compactEvidence(item);
    if (!compacted.value) continue;
    const key = `${compacted.sourceUrl}|${compacted.supportingPassage}|${compacted.claimType}`;
    if (!byKey.has(key)) byKey.set(key, compacted);
  }
  return [...byKey.values()].slice(0, WORKER_LIMITS.maxEvidenceItems);
}

export function buildWorkerPacket({ task, job, feedbackExamples = [] }) {
  if (!task?.id || !job?.id) throw new Error("A task and job are required to build a worker packet.");
  const researchEvidence = (job.details?.research?.results || []).map((item) => ({
    claimType: "web_research",
    value: item.title || item.description,
    sourceUrl: item.url,
    supportingPassage: item.description,
    sourceDate: item.age || "",
    confidence: 0.7,
    evidenceType: "explicit",
  }));
  const evidence = uniqueEvidence([
    ...(job.details?.sourceEvidence || []),
    ...(job.details?.claims || []),
    ...researchEvidence,
  ]);
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    task: {
      id: task.id,
      taskKey: task.taskKey,
      taskType: task.taskType,
      attempt: task.attempts,
      leaseUntil: task.leaseUntil,
    },
    candidate: {
      profileVersion: TARGET_PROFILE.version,
      baseline: TARGET_PROFILE.baseline,
      targetGeography: TARGET_PROFILE.targetGeography,
      compensation: TARGET_PROFILE.compensation,
      avoid: TARGET_PROFILE.avoid,
      outreachIdentity: TARGET_PROFILE.outreachIdentity,
    },
    job: {
      id: job.id,
      sourceId: job.sourceId,
      title: compactString(job.title, 300),
      company: compactString(job.company, 300),
      location: compactString(job.location, 300),
      url: compactString(job.canonicalUrl, 2000),
      description: compactString(job.description, WORKER_LIMITS.maxDescriptionCharacters),
      postedAt: job.postedAt || null,
      roleFamilyId: job.roleFamilyId || "exploratory",
      triage: job.details?.triage || null,
      deepEvaluation: job.details?.deepEvaluation || null,
    },
    evidence,
    feedbackExamples: feedbackExamples.slice(0, 6).map((item) => ({
      title: compactString(item.title, 200),
      company: compactString(item.company, 200),
      disposition: compactString(item.disposition, 30),
      reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 4).map((reason) => compactString(reason, 120)) : [],
      note: compactString(item.note, 300),
    })),
    constraints: {
      ...WORKER_LIMITS,
      factsWithoutEvidenceRemainUnknown: true,
      paidProvidersEnabled: false,
      allowedModelTier: "qwen3-4b-q4_k_m",
    },
  };
}

function triageMessages(packet) {
  return [
    {
      role: "system",
      content: "You are a high-recall career screener. Return JSON only. Never reject uncertainty and classify responsibilities rather than keyword overlap.",
    },
    {
      role: "user",
      content: `Candidate profile:\n${packet.candidate.baseline}\n\nConstraints:\n${packet.candidate.avoid}\n${packet.candidate.targetGeography}\n\nJob:\n${JSON.stringify(packet.job, null, 2)}\n\nUse relevance=irrelevant only for a clear function mismatch. A role mentioning Python, SQL, or engineering partnership is not automatically coding-heavy. Return a single triage object using a canonical roleFamilyId.`,
    },
  ];
}

function extractionMessages(packet) {
  return [
    {
      role: "system",
      content: "Extract only facts supported by the supplied job description and evidence. Return JSON only. Missing compensation, visa, remote, location, or interview facts must remain unknown.",
    },
    {
      role: "user",
      content: `Job:\n${JSON.stringify(packet.job, null, 2)}\n\nEvidence:\n${JSON.stringify(packet.evidence, null, 2)}\n\nReturn at most 20 claims. Every explicit or inferred claim must include a sourceUrl and a verbatim supportingPassage drawn from the supplied material. Do not use model memory.`,
    },
  ];
}

function deepMessages(packet, extraction) {
  return [
    {
      role: "system",
      content: "You are a rigorous career strategist. Return JSON only. Ground every material fact in supplied evidence; unknown must remain unknown.",
    },
    {
      role: "user",
      content: `Candidate:\n${packet.candidate.baseline}\n\nTarget geography: ${packet.candidate.targetGeography}\nCompensation: ${packet.candidate.compensation}\nAvoid: ${packet.candidate.avoid}\n\nJob:\n${JSON.stringify(packet.job, null, 2)}\n\nValidated evidence extraction:\n${JSON.stringify(extraction, null, 2)}\n\nPrior owner feedback:\n${JSON.stringify(packet.feedbackExamples, null, 2)}\n\nEvaluate role fit, financial-services advantage, AI/data relevance, leadership, coding/interview risk, location/authorization, compensation/upside, company quality, and interview velocity. Verdict semantics are mandatory: apply means pursue the job, maybe means manual review, and pass means reject or skip the job; pass never means a successful grade. overallScore must be an integer attractiveness score from 0 to 100, not a 0-to-5 dimension score. A coherent strong fit with dimension scores around 4-5 should normally score 75-100 and be apply; a clear mismatch or blocker should normally score 0-39 and be pass. A primarily hands-on data/software/platform engineering role must score roleFit 0-2 and verdict pass. US on-site/hybrid is incompatible with continuing from India unless global-remote evidence is explicit. Citizenship, clearance, or incompatible work authorization is a blocker. Do not infer interview format, compensation, visa, or remote eligibility from silence. Every explicit or inferred claim must cite the validated evidence with a non-empty sourceUrl and supportingPassage.`,
    },
  ];
}

function criticMessages(packet) {
  return [
    {
      role: "system",
      content: "Act as an independent skeptical career strategist. Return JSON only and use only supplied evidence. Prefer correcting optimism over preserving agreement.",
    },
    {
      role: "user",
      content: `Candidate profile:\n${packet.candidate.baseline}\n\nJob and primary evaluation:\n${JSON.stringify({ job: packet.job, primary: packet.job.deepEvaluation, evidence: packet.evidence }, null, 2)}\n\nIdentify unsupported claims, contradictions, hidden coding or eligibility risks, and whether apply|maybe|pass is justified. apply means pursue, maybe means manual review, and pass means reject or skip; pass never means a successful grade. Set agrees=true exactly when recommendedVerdict equals the primary verdict, otherwise false. Missing facts remain unknown.`,
    },
  ];
}

function outreachMessages(packet) {
  return [
    { role: "system", content: "Write a concise truthful outreach note. Return JSON only. Never invent facts or contacts." },
    {
      role: "user",
      content: `Candidate identity: ${packet.candidate.outreachIdentity}.\n\nJob:\n${JSON.stringify({ job: packet.job, evidence: packet.evidence }, null, 2)}\n\nReturn a subject and message under 170 words. Mention work authorization only when explicitly supported and never imply permanent authorization.`,
    },
  ];
}

export function getWorkerPasses(taskType) {
  if (taskType === "deep") return ["extract", "evaluate"];
  if (["triage", "critic", "outreach"].includes(taskType)) return ["evaluate"];
  throw new Error(`Unsupported worker task type: ${taskType}`);
}

export function getWorkerPass(taskType, passName, packet, prior = {}) {
  if (taskType === "triage") return { name: "triage", schema: triageSchema, messages: triageMessages(packet), maxTokens: 900 };
  if (taskType === "deep" && passName === "extract") {
    return { name: "extraction", schema: workerEvidenceExtractionSchema, messages: extractionMessages(packet), maxTokens: 1300 };
  }
  if (taskType === "deep" && passName === "evaluate") {
    return { name: "evaluation", schema: deepWorkerEvaluationSchema, messages: deepMessages(packet, prior.extraction), maxTokens: 2400 };
  }
  if (taskType === "critic") {
    const primaryVerdict = packet.job.deepEvaluation?.verdict;
    const workerCriticSchema = criticSchema.superRefine((critic, context) => {
      if (primaryVerdict && critic.agrees !== (critic.recommendedVerdict === primaryVerdict)) {
        context.addIssue({ code: "custom", path: ["agrees"], message: "agrees must match whether recommendedVerdict equals the primary verdict." });
      }
    });
    return { name: "critic", schema: workerCriticSchema, messages: criticMessages(packet), maxTokens: 900 };
  }
  if (taskType === "outreach") return { name: "outreach", schema: outreachSchema, messages: outreachMessages(packet), maxTokens: 500 };
  throw new Error(`Unsupported worker pass: ${taskType}/${passName}`);
}

export function parseWorkerOutput(taskType, output) {
  const schema = workerOutputs[taskType];
  if (!schema) throw new Error(`Unsupported worker task type: ${taskType}`);
  return schema.parse(output);
}

export function workerResultId(taskKey, output) {
  return createHash("sha256").update(`${taskKey}|${JSON.stringify(output)}`).digest("hex");
}
