import { buildSearchPlan } from "./job-search/discovery.js";
import { buildJobCardFacts } from "./job-search/card-facts.js";
import { enqueueJobSearchRun } from "./job-search/inngest.js";
import { ownerEmails, TARGET_PROFILE } from "./job-search/profile.js";
import { getFreeProviderQuotaSummary, providerConfiguration, runFreeProviderCanary } from "./job-search/providers.js";
import {
  createRun,
  ensureJobSearchRepository,
  getJob,
  getRepositoryDashboard,
  getRun,
  getUsageSummary,
  listJobs,
  listTitlePatterns,
  recordFeedback,
  repositoryMode,
  rollbackTitlePattern,
  updateTitlePatternStatus,
} from "./job-search/repository.js";

const FEEDBACK_REASONS = new Set([
  "wrong_function",
  "too_hands_on",
  "coding_interview",
  "seniority",
  "compensation",
  "location_work_authorization",
  "domain",
  "company",
  "duplicate_expired",
  "other",
]);

function normalize(value) {
  return String(value || "").trim();
}

export function getJobSearchAccess(sessionContext) {
  const signedIn = Boolean(sessionContext?.user?.email);
  const email = normalize(sessionContext?.user?.email).toLowerCase();
  const allowAnySignedIn = process.env.JOBSEARCH_ALLOW_ANY_SIGNED_IN === "true";
  return { signedIn, allowed: signedIn && (allowAnySignedIn || ownerEmails().includes(email)), email };
}

export function requireJobSearchAccess(sessionContext) {
  const access = getJobSearchAccess(sessionContext);
  if (!access.signedIn) {
    const error = new Error("Sign in required.");
    error.statusCode = 401;
    throw error;
  }
  if (!access.allowed) {
    const error = new Error("This tool is restricted to the configured job-search owner.");
    error.statusCode = 403;
    throw error;
  }
  return access;
}

export function getJobSearchPlan() {
  return {
    profile: TARGET_PROFILE,
    discovery: buildSearchPlan(),
    schedule: ["06:00 UTC", "18:00 UTC"],
    budget: {
      monthlyUsd: Number(process.env.JOBSEARCH_MONTHLY_BUDGET_USD || 5),
      zaiUsd: 4,
      moonshotUsd: 1,
      deepEvaluationsPerDay: Number(process.env.JOBSEARCH_DEEP_EVALUATIONS_PER_DAY || 8),
      criticEvaluationsPerDay: Number(process.env.JOBSEARCH_CRITIC_EVALUATIONS_PER_DAY || 5),
      serpQueriesPerDay: Number(process.env.JOBSEARCH_SERP_QUERIES_PER_DAY || 8),
      braveQueriesPerMonth: Number(process.env.JOBSEARCH_BRAVE_QUERIES_PER_MONTH || 950),
      openrouterRequestsPerDay: Number(process.env.JOBSEARCH_OPENROUTER_REQUESTS_PER_DAY || 45),
      cloudflareNeuronsPerDay: Number(process.env.JOBSEARCH_CLOUDFLARE_NEURONS_PER_DAY || 9000),
      localInference: "unlimited",
    },
    stages: [
      "metadata-first Google, portal, and ATS discovery",
      "function-and-seniority title candidate routing",
      "local Qwen extraction and high-recall triage",
      "local Qwen deep fit evaluation for every candidate",
      "local Qwen critic and evidence checks",
      "outreach and feedback-tested taxonomy learning",
    ],
  };
}

export function getJobSearchRuntimeStatus() {
  return {
    ownerGate: process.env.JOBSEARCH_ALLOW_ANY_SIGNED_IN === "true" ? "any-signed-in" : "owner-email",
    repository: repositoryMode(),
    providers: providerConfiguration(),
    productionFallbacks: "disabled",
    sampleData: "disabled",
    localWorker: process.env.JOBSEARCH_LOCAL_WORKER_ENABLED === "true" ? "database-queue-enabled" : "disabled",
  };
}

export function getJobSearchStatus(sessionContext) {
  const access = getJobSearchAccess(sessionContext);
  if (!access.allowed) return { ...access, runtime: { ownerGate: "owner-email" } };
  return { ...access, runtime: getJobSearchRuntimeStatus(), plan: getJobSearchPlan() };
}

function publicJob(job) {
  const deep = job.details?.deepEvaluation || null;
  const critic = job.details?.critic || null;
  const cardFacts = buildJobCardFacts(job);
  return {
    id: job.id,
    sourceId: job.sourceId,
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
    descriptionSnippet: job.description.slice(0, 360),
    url: job.canonicalUrl,
    cardFacts,
    postedAt: job.postedAt,
    sourceProvider: job.sourceProvider,
    sourceQuery: job.sourceQuery,
    roleFamilyId: job.roleFamilyId,
    roleFamily: job.details?.titleClassification?.familyLabel || job.roleFamilyId,
    lane: job.details?.titleClassification?.lane || "exploratory",
    status: job.status,
    disposition: job.disposition,
    userFeedback: job.disposition === "apply" ? 1 : job.disposition === "pass" ? -1 : 0,
    triage: job.details?.triage || null,
    score: deep?.overallScore ?? null,
    verdict: deep?.verdict || null,
    summary: deep?.summary || job.details?.triage?.scopeSummary || "Awaiting evaluation.",
    dimensions: deep?.dimensions || null,
    greenFlags: deep?.greenFlags || [],
    redFlags: deep?.redFlags || [],
    unknowns: deep?.unknowns || job.details?.triage?.unknowns || [],
    claims: job.details?.claims || job.details?.sourceEvidence || [],
    critic,
    modelAgreement: job.details?.modelAgreement || "pending",
    outreach: job.details?.outreach || null,
    contactCandidates: job.details?.contactCandidates || [],
    feedbackReasons: job.details?.feedbackReasons || [],
    feedbackNote: job.details?.feedbackNote || "",
    providerStates: {
      triage: job.details?.triageStatus || "pending",
      deep: job.details?.deepStatus || "pending",
      critic: job.details?.criticStatus || "pending",
    },
    models: {
      triage: { provider: job.details?.triageProvider || null, model: job.details?.triageModel || null },
      deep: { provider: job.details?.deepProvider || null, model: job.details?.deepModel || null },
      critic: { provider: job.details?.criticProvider || null, model: job.details?.criticModel || null },
    },
    firstSeenAt: job.firstSeenAt,
    lastSeenAt: job.lastSeenAt,
    updatedAt: job.updatedAt,
  };
}

export async function getJobSearchDashboard({ view = "inbox" } = {}) {
  await ensureJobSearchRepository();
  const [dashboard, freeQuotas] = await Promise.all([
    getRepositoryDashboard(view),
    getFreeProviderQuotaSummary(),
  ]);
  return {
    ...dashboard,
    usage: { ...dashboard.usage, freeQuotas },
    jobs: dashboard.jobs.map(publicJob),
    discoveryLeads: (dashboard.discoveryLeads || []).map((lead) => ({
      id: lead.id,
      title: lead.title || "Title not extracted",
      company: lead.company || "Company not extracted",
      location: lead.location || "",
      url: lead.url,
      sourceProvider: lead.sourceProvider,
      sourceQuery: lead.sourceQuery,
      status: lead.status,
      eligible: Boolean(lead.ontology?.eligible),
      lane: lead.ontology?.lane || "metadata_pending",
      familyId: lead.ontology?.familyId || "exploratory",
      reason: lead.ontology?.reason || "Awaiting title metadata.",
      lastSeenAt: lead.lastSeenAt,
    })),
    runtime: getJobSearchRuntimeStatus(),
    plan: getJobSearchPlan(),
  };
}

export async function runJobSearchIngest({ trigger = "manual", discoveryUrls = [], slot = "morning" } = {}) {
  await ensureJobSearchRepository();
  const run = await createRun({ trigger, status: "queued", phase: "queued" });
  const queue = await enqueueJobSearchRun({ runId: run.id, trigger, slot, discoveryUrls });
  return { ok: true, run, queue, runId: run.id, status: "queued" };
}

export async function getJobSearchRun(runId) {
  return getRun(runId);
}

export async function getJobSearchUsage() {
  const [usage, freeQuotas] = await Promise.all([
    getUsageSummary(),
    getFreeProviderQuotaSummary(),
  ]);
  return { ...usage, freeQuotas };
}

export async function runJobSearchProviderCanary() {
  await ensureJobSearchRepository();
  return runFreeProviderCanary();
}

export async function updateJobSearchFeedback(jobId, input) {
  let disposition;
  let legacyFeedback = null;
  let reasons = [];
  let note = "";
  if (typeof input === "number") {
    legacyFeedback = Math.max(-1, Math.min(1, Math.round(input)));
    disposition = legacyFeedback === 1 ? "apply" : legacyFeedback === -1 ? "pass" : "maybe";
  } else {
    disposition = ["apply", "maybe", "pass"].includes(input?.disposition) ? input.disposition : "maybe";
    reasons = Array.isArray(input?.reasons) ? [...new Set(input.reasons.filter((reason) => FEEDBACK_REASONS.has(reason)))] : [];
    note = normalize(input?.note).slice(0, 1000);
  }
  const updated = await recordFeedback(jobId, { disposition, reasons, note, legacyFeedback });
  if (!updated) {
    const error = new Error("Job not found.");
    error.statusCode = 404;
    throw error;
  }
  return publicJob(updated);
}

export async function listNegativeFeedbackJobs() {
  return (await listJobs({ view: "passed", limit: 1000 })).map(publicJob);
}

export async function getJobSearchTaxonomy() {
  const patterns = await listTitlePatterns();
  return {
    active: patterns.filter((pattern) => pattern.status === "active"),
    proposed: patterns.filter((pattern) => pattern.status === "proposed"),
    rejected: patterns.filter((pattern) => pattern.status === "rejected"),
  };
}

export async function setJobSearchTaxonomyProposal(patternId, action) {
  if (!["approve", "reject", "rollback"].includes(action)) {
    const error = new Error("Unsupported taxonomy action.");
    error.statusCode = 400;
    throw error;
  }
  const pattern = action === "rollback"
    ? await rollbackTitlePattern(patternId)
    : await updateTitlePatternStatus(patternId, action === "approve" ? "active" : "rejected");
  if (!pattern) {
    const error = new Error("Title pattern not found.");
    error.statusCode = 404;
    throw error;
  }
  return pattern;
}

export async function rerunJobSearchJob(jobId) {
  const job = await getJob(jobId);
  if (!job) {
    const error = new Error("Job not found.");
    error.statusCode = 404;
    throw error;
  }
  return runJobSearchIngest({ trigger: "rerun", discoveryUrls: [job.canonicalUrl], slot: "morning" });
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]) || 0;
    const b = Number(right[index]) || 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}
