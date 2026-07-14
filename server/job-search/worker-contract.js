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

export const WORKER_PROTOCOL_VERSION = "job-worker-2026-07-v6";
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
  maxPacketCharacters: 13500,
  maxPromptCharacters: 19000,
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
  const usesCurrentEvaluation = ["critic", "outreach"].includes(task.taskType);
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
    ...(usesCurrentEvaluation ? job.details?.claims || [] : []),
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
      evaluationPolicy: TARGET_PROFILE.evaluationPolicy,
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
      ...(usesCurrentEvaluation
        ? {
          roleFamilyId: job.roleFamilyId || "exploratory",
          deepEvaluation: job.details?.deepEvaluation || null,
        }
        : {}),
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
      content: "You are a high-recall career-function screener. Return JSON only. Protect against false rejection: classify the job's primary responsibilities against demonstrated experience, not title keywords, industry, eligibility, compensation, prestige, AI content, or remote-work preferences.",
    },
    {
      role: "user",
      content: `Candidate profile:\n${packet.candidate.baseline}\n\nCore expertise, in priority order:\n${JSON.stringify(packet.candidate.coreExpertise, null, 2)}\n\nAdditional differentiators, not prerequisites:\n${JSON.stringify(packet.candidate.differentiators, null, 2)}\n\nTriage policy:\n${JSON.stringify(packet.candidate.evaluationPolicy, null, 2)}\n\nJob:\n${JSON.stringify(packet.job, null, 2)}\n\nDecide only whether the primary responsibilities plausibly use the candidate's demonstrated expertise. Data Science Manager, Analytics Manager/Director, Product Analytics, Experimentation, Marketing/Customer/Growth Analytics, Decision Science, Strategy Analytics, Data Products, Business Manager with analytical ownership, technical/platform product management, decision-intelligence platforms, and cross-functional 0-to-1 product-builder roles are direct or plausible matches. A title containing Technical Product Manager, Platform Product Manager, Service Intelligence, Decision Intelligence, or an unfamiliar product label is not a rejection reason when responsibilities include data, analytics, decisioning, product strategy, or AI/ML. Different industries, public-sector work, lack of AI, lack of financial-services content, US onsite/hybrid work, compensation, visa evidence, and interview format must not reduce relevance; those are separate later gates. Python, SQL, statistics, predictive modeling, and experimentation inside analytics or data science do not make the function irrelevant. Use relevance=irrelevant only when supplied responsibilities clearly show a predominantly unrelated primary function such as software implementation, pure data-engineering IC delivery, IT support, sales, legal, clinical, or another non-core track. Before returning irrelevant, explicitly test whether at least two demonstrated areas transfer; if they do, return uncertain or relevant. If the description is incomplete, mixed, or plausibly transferable, use uncertain. Always return a concrete scopeSummary based on the primary responsibilities. Return one triage object using a canonical roleFamilyId.`,
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
      content: `Job:\n${JSON.stringify(packet.job, null, 2)}\n\nEvidence:\n${JSON.stringify(packet.evidence, null, 2)}\n\nReturn at most 6 highest-priority claims, favoring: job-level sponsorship or work-authorization restrictions; annual base salary rather than total compensation; explicit interview stages or assessments; and primary responsibilities proving expertise fit. Distinguish job-level evidence from employer-level history, annual base from total compensation, and explicit interview evidence from archetype inference. Keep each value under 180 characters and each supporting passage under 240 characters. Every explicit or inferred claim must include a sourceUrl and an exact supportingPassage drawn from the supplied material. List each material missing fact in unknowns. Do not use model memory.`,
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
      content: `Candidate:\n${packet.candidate.baseline}\n\nCore expertise:\n${JSON.stringify(packet.candidate.coreExpertise, null, 2)}\n\nDifferentiators, not prerequisites:\n${JSON.stringify(packet.candidate.differentiators, null, 2)}\n\nEvaluation policy:\n${JSON.stringify(packet.candidate.evaluationPolicy, null, 2)}\n\nFour must-have gates:\n${JSON.stringify(packet.candidate.hardRequirements, null, 2)}\n\nTarget geography: ${packet.candidate.targetGeography}\nCompensation: ${packet.candidate.compensation}\nWork authorization: ${packet.candidate.workAuthorization}\nAvoid: ${packet.candidate.avoid}\nRanking weights: ${JSON.stringify(packet.candidate.rankingWeights)}\n\nJob:\n${JSON.stringify(packet.job, null, 2)}\n\nValidated evidence extraction:\n${JSON.stringify(compactExtraction, null, 2)}\n\nPrior owner feedback:\n${JSON.stringify(packet.feedbackExamples, null, 2)}\n\nIndependently evaluate the job from its responsibilities and supplied evidence; do not inherit the triage label as truth. The supplied candidate profile and job posting are sufficient evidence to compare expertise and leadership: when substantive duties are present, score expertiseFit and leadershipScope with evidenceStatus=inferred instead of demanding an external source that links the candidate to the role. First evaluate four must-have gates: demonstrated expertise fit, work authorization, annual base compensation, and coding-interview safety. blocked requires supported incompatibility, unknown means missing or ambiguous evidence, and met requires support. Expertise fit is responsibility fit: 5 requires direct alignment across several demonstrated areas with no material mandatory-experience gap; 4 is strong alignment with only minor gaps; 3 is substantive transferable alignment with one or more material mandatory domain, data, method, or tool gaps; 2 is weak adjacency or several severe mandatory gaps; 0-1 is unrelated. Data-science management for marketing/customer models, analytics leadership, experimentation, product/growth/marketing/customer analytics, strategy analytics, decision science, data products, and analytical product-building are demonstrated core experience. Industry or public-sector context alone is never a penalty, but explicit required experience absent from the résumé is a real fit gap. Never lower expertiseFit or leadershipScope because a role lacks AI, is onsite/hybrid in the US, lacks remote-from-India flexibility, or has missing eligibility/pay/interview evidence. Those facts belong only in their own dimensions or gates. Then score expertiseFit, workAuthorization, compensation, codingInterviewSafety, leadershipScope, companyQuality, interviewVelocity, aiMlProductAdjacency, financialServicesAdvantage, and remoteFlexibility from 0-5. Use score=null and evidenceStatus=unknown when evidence is missing; never convert unknown to 0. Compensation means annual base or clearly comparable guaranteed cash, not total compensation or speculative equity. interviewVelocity means documented process speed only and must be null if unsupported. companyQuality must be null when no company evidence is supplied. codingInterviewSafety 5 means verified no-coding process and 0 means a supported blocker. ${INTERVIEW_RISK_INSTRUCTIONS} A primarily engineering-implementation role is an expertise blocker. Missing compensation, visa, or interview evidence must produce unknown gates and maybe, never pass. F-1/OPT/CPT compatibility alone does not establish future sponsorship, so keep work authorization unknown unless sponsorship is explicitly supported or official employer evidence establishes both E-Verify participation and H-1B/LCA history. Explicit no-current-or-future sponsorship, citizenship/clearance, confirmed annual-base maximum below $170,000, and explicit coding/SQL/Python assessment are blockers. AI/ML adjacency, financial-services overlap, remote flexibility, seniority, company quality, and interview velocity are bonuses after the four must-haves. Return a model recommendation; the server recomputes evidence gates, weights, and final verdict. Keep reasoning concise. Every external factual claim must cite supplied evidence; otherwise preserve it as unknown.`,
    },
  ];
}

function criticMessages(packet) {
  return [
    {
      role: "system",
      content: "Act as an independent skeptical career strategist. Return JSON only and use only supplied evidence. Look equally for false rejection and false optimism; do not preserve agreement for its own sake.",
    },
    {
      role: "user",
      content: `Candidate profile:\n${packet.candidate.baseline}\n\nCore expertise:\n${JSON.stringify(packet.candidate.coreExpertise, null, 2)}\n\nEvaluation policy:\n${JSON.stringify(packet.candidate.evaluationPolicy, null, 2)}\n\nFour must-have gates:\n${JSON.stringify(packet.candidate.hardRequirements, null, 2)}\n\nJob and primary evaluation:\n${JSON.stringify({ job: packet.job, primary: packet.job.deepEvaluation, evidence: packet.evidence }, null, 2)}\n\nAudit the evaluation from scratch. Look equally for false rejection and false optimism. Challenge responsibility-fit reasoning, unsupported gate statuses, score/reason contradictions, annual-base versus total-compensation mistakes, unrelated-company or unrelated-role research, hidden coding-interview risk, and work-authorization evidence. A public-sector or different-industry role can still be a strong expertise match. Lack of AI, financial-services overlap, remote work, or employer prestige cannot reduce core fit. Missing evidence cannot become score 0, met, or blocked. F-1/OPT/CPT acceptance alone cannot establish future sponsorship. Engineering and coding-bound scientist IC roles are near-certain coding risks absent contrary role-specific evidence; product/decision science and data-science management are elevated but not automatically blocked; analytics/strategy leadership is lower risk but unverified. A pass requires at least one supported blocker; unknown gates without a blocker require maybe. apply means pursue, maybe means manual review, and pass means reject. Set agrees=true exactly when recommendedVerdict equals the primary final verdict. In objections, identify every material anomaly and state the corrected gate or dimension.`,
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
  if (taskType === "triage") return withinPromptBudget({ name: "triage", schema: triageSchema, messages: triageMessages(packet), maxTokens: 900, thinking: false });
  if (taskType === "deep" && passName === "extract") {
    return withinPromptBudget({ name: "extraction", schema: workerEvidenceExtractionSchema, messages: extractionMessages(packet), maxTokens: 1800, thinking: false });
  }
  if (taskType === "deep" && passName === "evaluate") {
    return withinPromptBudget({ name: "evaluation", schema: deepWorkerEvaluationSchema, messages: deepMessages(packet, prior.extraction), maxTokens: 2400, thinking: true });
  }
  if (taskType === "critic") {
    const primaryVerdict = packet.job.deepEvaluation?.verdict;
    const workerCriticSchema = criticSchema.superRefine((critic, context) => {
      if (primaryVerdict && critic.agrees !== (critic.recommendedVerdict === primaryVerdict)) {
        context.addIssue({ code: "custom", path: ["agrees"], message: "agrees must match whether recommendedVerdict equals the primary verdict." });
      }
    });
    return withinPromptBudget({ name: "critic", schema: workerCriticSchema, messages: criticMessages(packet), maxTokens: 900, thinking: true });
  }
  if (taskType === "outreach") return withinPromptBudget({ name: "outreach", schema: outreachSchema, messages: outreachMessages(packet), maxTokens: 500, thinking: false });
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
