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

export const WORKER_PROTOCOL_VERSION = "job-worker-2026-07-v2";
export const REQUIRED_WORKER_VERSION = `windows-qwen-worker-${WORKER_PROTOCOL_VERSION}`;
const INTERVIEW_RISK_INSTRUCTIONS = "Infer interview risk from the role archetype as well as explicit evidence: engineering and coding-bound data/applied/research-scientist IC roles are near-certain coding risks unless role-specific contrary evidence exists; product/decision scientists, data-science management, and hands-on technical leadership have elevated but unconfirmed risk; analytics/strategy leadership is generally lower risk but remains unverified. Python, SQL, statistics, predictive modeling, and experimentation inside analytics/data-science work do not alone prove a coding round.";
export const WORKER_LIMITS = Object.freeze({
  contextTokens: 8192,
  concurrency: 1,
  leaseSeconds: 1200,
  heartbeatSeconds: 30,
  idleShutdownSeconds: 300,
  maxDescriptionCharacters: 12000,
  maxEvidenceItems: 20,
  maxSupportingPassageCharacters: 700,
  maxPacketCharacters: 11500,
  maxPromptCharacters: 14500,
  maxEvaluationEvidenceItems: 6,
});

const workerGroundedEvidenceSchema = evidenceSchema.extend({
  claimType: z.string().trim().min(1).max(64),
  value: z.string().trim().min(1).max(180),
  sourceUrl: z.string().url().max(500),
  supportingPassage: z.string().trim().min(1).max(240),
  sourceDate: z.string().max(40).default(""),
  evidenceType: z.enum(["explicit", "inferred"]),
});

const workerEvidenceExtractionSchema = z.object({
  claims: z.array(workerGroundedEvidenceSchema).max(6).default([]),
  unknowns: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
});

const deepWorkerEvaluationSchema = deepEvaluationSchema.extend({
  verdict: z.enum(["apply", "maybe", "pass"]).describe("apply means pursue; maybe means manual review; pass means reject or skip"),
  overallScore: z.number().int().min(0).max(100).describe("integer attractiveness score from 0 to 100, never a 0-to-5 dimension score"),
  claims: z.array(workerGroundedEvidenceSchema).max(6).default([]),
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

function evidencePriority(item) {
  const text = `${item.claimType} ${item.value} ${item.supportingPassage}`.toLowerCase();
  let priority = 0;
  if (/visa|sponsor|work authorization|citizen|clearance|eligible|eligibility|e-verify|h-1b|h1b|stem opt|f-1 opt/.test(text)) priority += 1000;
  if (/compensation|salary|pay|bonus|equity|rsu|stock|benefit/.test(text)) priority += 900;
  if (/coding|code|python|sql|engineer|technical interview|algorithm|software|platform/.test(text)) priority += 800;
  if (/remote|hybrid|on-site|onsite|location|india|relocat/.test(text)) priority += 100;
  if (item.evidenceType === "explicit") priority += 100;
  if (item.sourceUrl && item.supportingPassage) priority += 50;
  return priority;
}

function uniqueEvidence(items) {
  const byKey = new Map();
  let order = 0;
  for (const item of items) {
    const compacted = compactEvidence(item);
    if (!compacted.value) continue;
    const key = `${compacted.sourceUrl}|${compacted.supportingPassage}|${compacted.claimType}`;
    if (!byKey.has(key)) byKey.set(key, { item: compacted, order: order += 1 });
  }
  return [...byKey.values()]
    .sort((left, right) => evidencePriority(right.item) - evidencePriority(left.item) || left.order - right.order)
    .map(({ item }) => item)
    .slice(0, WORKER_LIMITS.maxEvidenceItems);
}

function packetCharacters(packet) {
  return JSON.stringify(packet).length;
}

function fitPacketToBudget(packet) {
  while (packetCharacters(packet) > WORKER_LIMITS.maxPacketCharacters && packet.evidence.length > 3) {
    packet.evidence.pop();
  }
  while (packetCharacters(packet) > WORKER_LIMITS.maxPacketCharacters && packet.feedbackExamples.length > 2) {
    packet.feedbackExamples.pop();
  }
  if (packetCharacters(packet) > WORKER_LIMITS.maxPacketCharacters) {
    const overflow = packetCharacters(packet) - WORKER_LIMITS.maxPacketCharacters;
    packet.job.description = packet.job.description.slice(0, Math.max(2000, packet.job.description.length - overflow - 128));
  }
  while (packetCharacters(packet) > WORKER_LIMITS.maxPacketCharacters && packet.evidence.length > 1) {
    packet.evidence.pop();
  }
  if (packetCharacters(packet) > WORKER_LIMITS.maxPacketCharacters) {
    const overflow = packetCharacters(packet) - WORKER_LIMITS.maxPacketCharacters;
    packet.job.description = packet.job.description.slice(0, Math.max(0, packet.job.description.length - overflow - 128));
  }
  if (packetCharacters(packet) > WORKER_LIMITS.maxPacketCharacters) {
    throw new Error("The Windows worker packet cannot fit the configured context budget without truncating candidate constraints.");
  }
  return packet;
}

export function buildWorkerPacket({ task, job, feedbackExamples = [] }) {
  if (!task?.id || !job?.id) throw new Error("A task and job are required to build a worker packet.");
  const researchEvidence = (job.details?.research?.results || []).map((item) => ({
    claimType: "web_search_snippet",
    value: item.title || item.description,
    sourceUrl: item.url,
    supportingPassage: item.description,
    sourceDate: item.age || "",
    confidence: 0.65,
    evidenceType: "inferred",
  }));
  const evidence = uniqueEvidence([
    ...(job.details?.sourceEvidence || []),
    ...(job.details?.claims || []),
    ...researchEvidence,
  ]);
  return fitPacketToBudget({
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
      coreExpertise: TARGET_PROFILE.coreExpertise,
      differentiators: TARGET_PROFILE.differentiators,
      targetGeography: TARGET_PROFILE.targetGeography,
      compensation: TARGET_PROFILE.compensation,
      workAuthorization: TARGET_PROFILE.workAuthorization,
      hardRequirements: TARGET_PROFILE.hardRequirements,
      rankingWeights: TARGET_PROFILE.rankingWeights,
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
  });
}

function triageMessages(packet) {
  return [
    {
      role: "system",
      content: "You are a high-recall career screener. Return JSON only. Never reject uncertainty and classify responsibilities rather than keyword overlap.",
    },
    {
      role: "user",
      content: `Candidate profile:\n${packet.candidate.baseline}\n\nCore expertise, in priority order:\n${JSON.stringify(packet.candidate.coreExpertise, null, 2)}\n\nAdditional differentiators, not prerequisites:\n${JSON.stringify(packet.candidate.differentiators, null, 2)}\n\nConstraints:\n${packet.candidate.avoid}\n${packet.candidate.targetGeography}\n\nJob:\n${JSON.stringify(packet.job, null, 2)}\n\nUse relevance=irrelevant only for a clear primary-function mismatch. Analytics, experimentation, product analytics, marketing/customer analytics, strategy analytics, data-science management, decision science, data products, and cross-functional product-building are core matches in any industry. Do not require AI or financial-services content. A role mentioning Python, SQL, statistics, model building, or engineering partnership is not automatically coding-interview-heavy. Return a single triage object using a canonical roleFamilyId.`,
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
      content: `Job:\n${JSON.stringify(packet.job, null, 2)}\n\nEvidence:\n${JSON.stringify(packet.evidence, null, 2)}\n\nReturn at most 6 highest-priority claims, favoring eligibility, compensation, and coding/interview evidence. Keep each value under 180 characters and each supporting passage under 240 characters. Every explicit or inferred claim must include a sourceUrl and a supportingPassage drawn from the supplied material. Do not use model memory.`,
    },
  ];
}

function deepMessages(packet, extraction) {
  const compactExtraction = {
    claims: uniqueEvidence(extraction?.claims || []).slice(0, WORKER_LIMITS.maxEvaluationEvidenceItems),
    unknowns: (extraction?.unknowns || []).slice(0, 8).map((item) => compactString(item, 300)),
  };
  return [
    {
      role: "system",
      content: "You are a rigorous career strategist. Return JSON only. Ground every material fact in supplied evidence; unknown must remain unknown.",
    },
    {
      role: "user",
      content: `Candidate:\n${packet.candidate.baseline}\n\nCore expertise:\n${JSON.stringify(packet.candidate.coreExpertise, null, 2)}\n\nDifferentiators, not prerequisites:\n${JSON.stringify(packet.candidate.differentiators, null, 2)}\n\nFour must-have gates:\n${JSON.stringify(packet.candidate.hardRequirements, null, 2)}\n\nTarget geography: ${packet.candidate.targetGeography}\nCompensation: ${packet.candidate.compensation}\nWork authorization: ${packet.candidate.workAuthorization}\nAvoid: ${packet.candidate.avoid}\nRanking weights: ${JSON.stringify(packet.candidate.rankingWeights)}\n\nJob:\n${JSON.stringify(packet.job, null, 2)}\n\nValidated evidence extraction:\n${JSON.stringify(compactExtraction, null, 2)}\n\nPrior owner feedback:\n${JSON.stringify(packet.feedbackExamples, null, 2)}\n\nFirst evaluate the four must-have gates: expertise fit, work authorization, compensation, and coding-interview safety. Use status=blocked only for supported incompatibility, status=unknown when evidence is missing, and status=met when supported. Then score these dimensions: expertiseFit, workAuthorization, compensation, codingInterviewSafety, leadershipScope, companyQuality, interviewVelocity, aiMlProductAdjacency, financialServicesAdvantage, and remoteFlexibility. Each dimension is 0-5 where 5 is most attractive. Use score=null and evidenceStatus=unknown when evidence is missing; never convert unknown to 0. codingInterviewSafety 5 means low/no coding-interview risk and 0 means explicit high risk. interviewVelocity concerns process speed only. leadershipScope concerns responsibility and people/decision scope only. Public-sector or non-financial-services work may reduce an optional domain bonus, but must not reduce expertise fit or leadership scope when responsibilities match. AI/ML adjacency, financial-services overlap, and remote flexibility are bonuses, not prerequisites. US on-site/hybrid work is acceptable when work authorization is compatible; remote-from-India is not required. ${INTERVIEW_RISK_INSTRUCTIONS} A primarily engineering-implementation role is a function blocker. Missing compensation, visa, or interview evidence must produce unknown gates and a maybe recommendation, not a pass. Explicit no-current-or-future sponsorship, citizenship/clearance, a confirmed salary maximum below $170,000, or explicit coding interviews are blockers. Return a model recommendation; the server will apply deterministic gates and weights for the final verdict. Keep reasoning concise, and cite every explicit or inferred claim with supplied evidence.`,
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
      content: `Candidate profile:\n${packet.candidate.baseline}\n\nCore expertise:\n${JSON.stringify(packet.candidate.coreExpertise, null, 2)}\n\nFour must-have gates:\n${JSON.stringify(packet.candidate.hardRequirements, null, 2)}\n\nJob and primary evaluation:\n${JSON.stringify({ job: packet.job, primary: packet.job.deepEvaluation, evidence: packet.evidence }, null, 2)}\n\nChallenge unsupported gate statuses, contradictions, hidden coding-interview risk, role-archetype risk classification, salary interpretation, and work-authorization evidence. Engineering and coding-bound scientist IC roles are near-certain coding risks absent contrary role-specific evidence; product/decision science and data-science management are elevated but not automatically blocked. Do not treat industry mismatch, lack of AI, lack of remote work, or public-sector context as a core role-fit failure when analytics/experimentation responsibilities match. apply means pursue, maybe means manual review, and pass means reject. Set agrees=true exactly when recommendedVerdict equals the primary verdict. Missing facts remain unknown and should normally cause maybe unless another must-have gate is explicitly blocked.`,
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

export function workerPromptCharacters(messages) {
  return messages.reduce((total, message) => total + String(message.content || "").length, 0);
}

function withinPromptBudget(pass) {
  const promptCharacters = workerPromptCharacters(pass.messages);
  if (promptCharacters > WORKER_LIMITS.maxPromptCharacters) {
    throw new Error(`The ${pass.name} pass exceeds the Windows worker prompt budget.`);
  }
  return { ...pass, promptCharacters };
}

export function getWorkerPass(taskType, passName, packet, prior = {}) {
  if (taskType === "triage") return withinPromptBudget({ name: "triage", schema: triageSchema, messages: triageMessages(packet), maxTokens: 900 });
  if (taskType === "deep" && passName === "extract") {
    return withinPromptBudget({ name: "extraction", schema: workerEvidenceExtractionSchema, messages: extractionMessages(packet), maxTokens: 1800 });
  }
  if (taskType === "deep" && passName === "evaluate") {
    return withinPromptBudget({ name: "evaluation", schema: deepWorkerEvaluationSchema, messages: deepMessages(packet, prior.extraction), maxTokens: 2400 });
  }
  if (taskType === "critic") {
    const primaryVerdict = packet.job.deepEvaluation?.verdict;
    const workerCriticSchema = criticSchema.superRefine((critic, context) => {
      if (primaryVerdict && critic.agrees !== (critic.recommendedVerdict === primaryVerdict)) {
        context.addIssue({ code: "custom", path: ["agrees"], message: "agrees must match whether recommendedVerdict equals the primary verdict." });
      }
    });
    return withinPromptBudget({ name: "critic", schema: workerCriticSchema, messages: criticMessages(packet), maxTokens: 900 });
  }
  if (taskType === "outreach") return withinPromptBudget({ name: "outreach", schema: outreachSchema, messages: outreachMessages(packet), maxTokens: 500 });
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
