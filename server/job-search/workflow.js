import { createHash } from "node:crypto";

import { fetchConfiguredAtsJobs, fetchKnownCompanyAtsJobs, validateDiscoveryCandidates } from "./ats.js";
import { buildSearchPlan, getManualDiscoveryUrls } from "./discovery.js";
import { TARGET_PROFILE } from "./profile.js";
import {
  EVALUATION_FRAMEWORK_VERSION,
  classifyCodingInterviewRisk,
  finalizeDeepEvaluation,
} from "./evaluation-framework.js";
import {
  callCriticModel,
  callDeepModel,
  callLocalModel,
  callTriageModel,
  callUtilityModel,
  providerConfiguration,
  searchBrave,
  searchSerpApiJobs,
  extractJobPage,
} from "./providers.js";
import {
  addSnapshot,
  enqueueLocalTask,
  getControlOperation,
  getJob,
  getJobByCanonicalUrl,
  getCalibrationStatus,
  getLocalQueueControl,
  getRun,
  getUsageSummary,
  holdLocalQueueTasks,
  listCompanies,
  listFeedbackExamples,
  listJobs,
  listLocalTasks,
  listTitleObservations,
  listTitlePatterns,
  recordDiscoveryLeads,
  readResearchCache,
  recordEvaluation,
  recordObservation,
  releaseLocalQueueTasks,
  replaceClaims,
  saveTitlePattern,
  saveControlOperation,
  setLocalQueueControl,
  setLocalTaskStatus,
  updateRun,
  updateJobClassification,
  upsertCompany,
  upsertJob,
  writeResearchCache,
} from "./repository.js";
import {
  cloudDeepEvaluationSchema,
  cloudEvidenceExtractionSchema,
  criticSchema,
  deepEvaluationSchema,
  outreachSchema,
  taxonomyProposalSchema,
  triageBatchSchema,
} from "./schemas.js";
import {
  buildAliasProposal,
  classifyTitle,
  evaluateProposalForPromotion,
  normalizeTitle,
  titleFamilyById,
} from "./taxonomy.js";
import { classifyCandidateTitle } from "./title-ontology.js";
import { normalizeTimestampInput } from "./utils.js";
import { rotatingWatchlistCompanies } from "./watchlist.js";
import { parseWorkerOutput } from "./worker-contract.js";

export const PROMPT_VERSION = "job-intelligence-2026-07-analytics-first-v14";

const INTERVIEW_RISK_INSTRUCTIONS = "Infer interview risk from the role archetype as well as explicit evidence: engineering and coding-bound data/applied/research-scientist IC roles are near-certain coding risks unless role-specific contrary evidence exists; product/decision scientists, data-science management, and hands-on technical leadership have elevated but unconfirmed risk; analytics/strategy leadership is generally lower risk but remains unverified. Python, SQL, statistics, predictive modeling, and experimentation inside analytics/data-science work do not alone prove a coding round.";

function hash(...parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function sourceDomain(value, sourceProvider = "") {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (/linkedin\.com|wellfound\.com|workatastartup\.com|builtin\.com|google\.com|bing\.com/.test(hostname)) return "";
    if (sourceProvider === "generic_page" || /career|jobs/.test(hostname)) return hostname;
  } catch {
    // Some discovery records are metadata-only until extraction.
  }
  return "";
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function rotateItems(items, count, seed) {
  if (!items.length) return [];
  const offset = Number.parseInt(hash(seed).slice(0, 8), 16) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)].slice(0, count);
}

function uniqueJobs(jobs) {
  const byKey = new Map();
  jobs.forEach((job) => {
    if (!job?.title || !job?.company || !job?.description) return;
    const key = job.url || job.sourceId || hash(job.title, job.company, job.description.slice(0, 500));
    const existing = byKey.get(key);
    if (!existing || job.description.length > existing.description.length) byKey.set(key, job);
  });
  return [...byKey.values()];
}

function metadataCandidateJob(candidate) {
  if (!candidate?.url || !candidate?.title || !candidate?.description) return null;
  if (!/(linkedin\.com\/jobs\/view|wellfound\.com\/jobs\/|greenhouse|lever|ashby|workday|smartrecruiters|workable|icims|jobvite|bamboohr|breezy)/i.test(candidate.url)) return null;
  const unbrandedTitle = candidate.title.replace(/\s*[|\-–]\s*(LinkedIn|Wellfound|Greenhouse|Lever|Ashby)\s*$/i, "").trim();
  const atCompany = unbrandedTitle.match(/^(.+?)\s+at\s+(.+)$/i);
  return {
    sourceId: `metadata_${hash(candidate.url).slice(0, 24)}`,
    title: (atCompany?.[1] || unbrandedTitle).slice(0, 300),
    company: (atCompany?.[2] || "Unknown company").slice(0, 300),
    location: candidate.location || "",
    postedAt: candidate.postedAt || null,
    description: candidate.description,
    url: candidate.url,
    sourceQuery: candidate.sourceQuery,
    sourceProvider: candidate.sourceProvider,
    raw: {
      ...(candidate.raw || {}),
      discoveryMetadataOnly: true,
    },
  };
}

function normalizePostedTimestamp(value) {
  const normalized = normalizeTimestampInput(value);
  return {
    postedAt: normalized.iso,
    postedAtRaw: normalized.raw && !normalized.iso ? normalized.raw : "",
  };
}

function currentTitleClassification(rawTitle, patterns) {
  const title = classifyTitle(rawTitle, patterns);
  const ontology = classifyCandidateTitle(rawTitle);
  const routedFamilyId = title.familyId === "exploratory" && ontology.eligible
    ? ontology.familyId
    : title.familyId;
  const routedFamily = titleFamilyById(routedFamilyId);
  return {
    normalizedTitle: title.normalizedTitle,
    roleFamilyId: routedFamilyId,
    titleClassification: {
      ...title,
      familyId: routedFamilyId,
      familyLabel: routedFamily?.label || title.familyLabel,
      lane: routedFamilyId === title.familyId ? title.lane : ontology.lane,
      ontology,
    },
  };
}

function clearMismatchPromoted(job) {
  return job?.details?.triage?.relevance === "irrelevant" && ["apply", "maybe"].includes(job?.disposition);
}

function shouldRefreshTriage(job) {
  return job?.details?.triageStatus === "complete"
    && job?.details?.triagePromptVersion !== PROMPT_VERSION;
}

function shouldQueueDeepForJob(job) {
  if (!job) return false;
  const relevance = job.details?.triage?.relevance;
  const staleEvaluation = Boolean(job.details?.deepEvaluation)
    && (
      job.details?.evaluationFrameworkVersion !== EVALUATION_FRAMEWORK_VERSION
      || job.details?.deepPromptVersion !== PROMPT_VERSION
    );
  if (staleEvaluation) return ["relevant", "uncertain", "irrelevant"].includes(relevance);
  if (job.details?.deepStatus === "complete" || job.details?.deepEvaluation) return false;
  return ["relevant", "uncertain", "irrelevant"].includes(relevance);
}

function shouldQueueCriticForJob(job) {
  return Boolean(job?.details?.deepEvaluation)
    && job?.details?.evaluationFrameworkVersion === EVALUATION_FRAMEWORK_VERSION
    && job?.details?.deepPromptVersion === PROMPT_VERSION
    && (
      job?.details?.criticStatus !== "complete"
      || job?.details?.criticPromptVersion !== PROMPT_VERSION
    );
}

function nextLocalTaskType(job) {
  if (!job) return null;
  if (shouldRefreshTriage(job)) return "triage";
  if (job.details?.triageStatus !== "complete") return "triage";
  if (shouldQueueDeepForJob(job)) return "deep";
  if (shouldQueueCriticForJob(job)) return "critic";
  if (
    job.details?.deepEvaluation?.verdict === "apply"
    && job.details?.critic?.agrees
    && job.details?.critic?.recommendedVerdict === "apply"
    && !job.details?.outreach
  ) return "outreach";
  return null;
}

function localTaskPriority(job, taskType) {
  if (taskType === "triage") return 100;
  if (taskType === "deep") return job?.details?.triage?.relevance === "relevant" ? 110
    : job?.details?.triage?.relevance === "uncertain" ? 105 : 101;
  if (taskType === "critic") return 120;
  if (taskType === "outreach") return 30;
  return 0;
}

async function braveWithinQuota(query, options = {}) {
  const usage = await getUsageSummary();
  const cap = Number(process.env.JOBSEARCH_BRAVE_QUERIES_PER_MONTH || 950);
  if ((usage.byProvider.brave?.requests || 0) >= cap) return { status: "quota_blocked", results: [] };
  return searchBrave(query, options);
}

async function discover({ runId, trigger, slot = "morning", discoveryUrls = [] }) {
  const plan = buildSearchPlan();
  const queryHalf = Math.ceil(plan.serpQueries.length / 2);
  const serpQueries = trigger === "manual"
    ? []
    : slot === "evening" ? plan.serpQueries.slice(queryHalf) : plan.serpQueries.slice(0, queryHalf);
  const braveHalf = Math.ceil(plan.braveQueries.length / 2);
  const braveQueries = trigger === "manual"
    ? []
    : slot === "evening" ? plan.braveQueries.slice(braveHalf) : plan.braveQueries.slice(0, braveHalf);
  const usage = await getUsageSummary();
  const serpRemaining = Math.max(0, 250 - (usage.byProvider.serpapi?.requests || 0));
  const attemptedSerpQueries = serpQueries.slice(0, serpRemaining);
  const serpSettled = await Promise.allSettled(attemptedSerpQueries.map((query) => searchSerpApiJobs(query, { runId })));
  const serpFailures = serpSettled.map((result, index) => ({ result, query: attemptedSerpQueries[index] }))
    .filter((item) => item.result.status === "rejected");
  const serpFallbackSettled = [];
  for (const { query } of serpFailures) {
    try {
      serpFallbackSettled.push({
        status: "fulfilled",
        value: await braveWithinQuota(`${query.query} (job OR jobs OR career OR careers)`, { runId, freshness: "pd", count: 10 }),
      });
    } catch (reason) {
      serpFallbackSettled.push({ status: "rejected", reason });
    }
  }
  const companyRecords = trigger === "manual" ? [] : await listCompanies(100);
  const seededCompanies = rotatingWatchlistCompanies(new Date(), 2).map((name) => ({ name, domain: "" }));
  const rotatedCompanies = rotateItems(companyRecords, 2, `${new Date().toISOString().slice(0, 10)}:${slot}`);
  const watchlistTargets = [...seededCompanies, ...rotatedCompanies]
    .filter((company, index, values) => values.findIndex((item) => item.name === company.name) === index);
  const watchlistQueries = trigger === "manual" ? [] : watchlistTargets.map((company) => {
    const directDomain = company.domain ? ` OR site:${company.domain}` : "";
    return `"${company.name}" (AI OR data OR analytics OR strategy OR product) (jobs OR careers) (site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com OR site:myworkdayjobs.com OR site:jobs.smartrecruiters.com OR site:linkedin.com/jobs/view${directDomain})`;
  });
  const weeklyBackfill = trigger !== "manual" && slot === "morning" && new Date().getUTCDay() === 0
    ? plan.serpQueries.slice(0, 4).map((query) => `${query.query} (jobs OR careers)`)
    : [];
  const braveSettled = [];
  for (const query of braveQueries) {
    try {
      braveSettled.push({ status: "fulfilled", value: await braveWithinQuota(query.query, { runId, freshness: "pd" }) });
    } catch (reason) {
      braveSettled.push({ status: "rejected", reason });
    }
  }
  const watchlistSettled = [];
  for (const query of watchlistQueries) {
    try {
      watchlistSettled.push({ status: "fulfilled", value: await braveWithinQuota(query, { runId, freshness: "pw", count: 5 }) });
    } catch (reason) {
      watchlistSettled.push({ status: "rejected", reason });
    }
  }
  const backfillSettled = [];
  for (const query of weeklyBackfill) {
    try {
      backfillSettled.push({ status: "fulfilled", value: await braveWithinQuota(query, { runId, freshness: "pw", count: 10 }) });
    } catch (reason) {
      backfillSettled.push({ status: "rejected", reason });
    }
  }
  const [atsConfigured, atsKnownCompanies] = await Promise.all([
    fetchConfiguredAtsJobs(),
    fetchKnownCompanyAtsJobs(companyRecords, {
      limit: 8,
      rotationKey: `${new Date().toISOString().slice(0, 10)}:${slot}`,
    }),
  ]);

  const serpJobs = serpSettled.flatMap((result) => result.status === "fulfilled" ? result.value.jobs : []);
  const braveResults = [...braveSettled, ...watchlistSettled, ...backfillSettled, ...serpFallbackSettled]
    .flatMap((result) => result.status === "fulfilled" ? result.value.results : [])
    .filter((result) => /job|career|greenhouse|lever|ashby|workday|smartrecruiters/i.test(`${result.url} ${result.title}`))
    .map((result) => ({
      url: result.url,
      title: result.title || "",
      company: "",
      location: "",
      postedAt: null,
      description: result.description || "",
      sourceQuery: "brave_discovery",
      sourceProvider: "brave",
      raw: { searchResult: result },
    }));
  const manualCandidates = getManualDiscoveryUrls(discoveryUrls).map((url) => ({
    url, sourceQuery: "manual_url", sourceProvider: "manual_url",
  }));
  const browserCandidates = [...manualCandidates, ...braveResults];
  const validationCandidates = browserCandidates.filter((candidate) => {
    if (candidate.sourceProvider === "manual_url") return true;
    const titleMatch = classifyCandidateTitle(candidate.title);
    return titleMatch.eligible || !candidate.title || /\b(job|jobs|career|careers)\b/i.test(candidate.title);
  });
  const validated = await validateDiscoveryCandidates(validationCandidates);
  const metadataFallbackJobs = validationCandidates.map(metadataCandidateJob).filter(Boolean);
  const jobs = uniqueJobs([
    ...serpJobs,
    ...atsConfigured.jobs,
    ...atsKnownCompanies.jobs,
    ...validated.jobs,
    ...metadataFallbackJobs,
  ]);
  const rawLeads = [
    ...serpJobs.map((job) => ({ ...job, status: "extracted" })),
    ...atsConfigured.jobs.map((job) => ({ ...job, status: "extracted" })),
    ...atsKnownCompanies.jobs.map((job) => ({ ...job, status: "extracted" })),
    ...browserCandidates.map((candidate) => {
      const ontology = classifyCandidateTitle(candidate.title);
      return {
        ...candidate,
        status: candidate.sourceProvider === "manual_url"
          ? "extraction_pending"
          : !candidate.title ? "metadata_pending" : ontology.eligible ? "extraction_pending" : "filtered_title",
        ontology,
        snippet: candidate.description || candidate.raw?.searchResult?.description || "",
      };
    }),
  ];
  return {
    jobs,
    rawLeads,
    providers: {
      configuration: providerConfiguration(),
      serpapi: {
        requested: serpQueries.length,
        completed: serpSettled.filter((item) => item.status === "fulfilled").length,
        failed: serpFailures.length,
        fallbackCompleted: serpFallbackSettled.filter((item) => item.status === "fulfilled").length,
        remainingMonthly: serpRemaining,
        errors: serpFailures.map(({ result, query }) => ({
          queryId: query.id,
          error: String(result.reason?.message || "Google Jobs request failed").slice(0, 300),
        })),
      },
      brave: {
        requested: braveQueries.length + watchlistQueries.length + weeklyBackfill.length + serpFallbackSettled.length,
        completed: [...braveSettled, ...watchlistSettled, ...backfillSettled, ...serpFallbackSettled].filter((item) => item.status === "fulfilled").length,
        weeklyBackfill: weeklyBackfill.length,
        serpFallbacks: serpFallbackSettled.length,
      },
      ats: {
        configured: atsConfigured.provider,
        knownCompanies: atsKnownCompanies.provider,
      },
      validation: validated.provider,
    },
  };
}

async function normalizeAndPersist(jobs) {
  const patterns = await listTitlePatterns({ includeInactive: false });
  const persisted = [];
  for (const job of jobs) {
    const postedTimestamp = normalizePostedTimestamp(job.postedAt || job.postedAtRaw || "");
    const classification = currentTitleClassification(job.title, patterns);
    const title = classification.titleClassification;
    const routedFamilyId = classification.roleFamilyId;
    const contentHash = hash(job.title, job.company, job.location || "", job.description);
    const structuredCompensation = String(
      job.compensation
      || job.raw?.detected_extensions?.salary
      || job.raw?.baseSalary
      || "",
    ).trim().slice(0, 300);
    const existing = await getJob(job.sourceId) || await getJobByCanonicalUrl(job.url);
    const unchanged = existing?.contentHash === contentHash;
    const record = await upsertJob({
      ...existing,
      ...job,
      sourceId: existing?.sourceId || job.sourceId,
      canonicalUrl: job.url,
      normalizedTitle: classification.normalizedTitle,
      contentHash,
      roleFamilyId: routedFamilyId,
      status: unchanged ? existing.status : "triage_pending",
      postedAt: postedTimestamp.postedAt,
      postedAtRaw: postedTimestamp.postedAtRaw,
      details: {
        ...(existing?.details || {}),
        sourceMetadata: {
          ...(existing?.details?.sourceMetadata || {}),
          ...(postedTimestamp.postedAtRaw ? { postedAtRaw: postedTimestamp.postedAtRaw } : {}),
          ...(job.raw?.pageExtraction ? { pageExtraction: job.raw.pageExtraction } : {}),
          ...(structuredCompensation ? { compensation: structuredCompensation } : {}),
        },
        titleClassification: {
          ...classification.titleClassification,
        },
        sourceEvidence: [
          {
            claimType: "job_posting",
            value: "Source job description",
            sourceUrl: job.url || "",
            supportingPassage: job.description.slice(0, 600),
            sourceDate: postedTimestamp.postedAt || postedTimestamp.postedAtRaw || "",
            confidence: 1,
            evidenceType: "explicit",
          },
          ...(structuredCompensation ? [{
            claimType: "compensation",
            value: structuredCompensation,
            sourceUrl: job.url || "",
            supportingPassage: structuredCompensation,
            sourceDate: postedTimestamp.postedAt || postedTimestamp.postedAtRaw || "",
            confidence: 1,
            evidenceType: "explicit",
          }] : []),
        ],
      },
    });
    await addSnapshot(record.id, { contentHash, title: record.title, description: record.description, raw: job.raw || {} });
    await recordObservation({
      normalizedTitle: title.normalizedTitle,
      rawTitle: job.title,
      familyId: routedFamilyId === "exploratory" ? null : routedFamilyId,
      matchedPatternId: title.matchedPatternId,
      discoverySource: job.sourceProvider,
    });
    if (record.company && record.company !== "Unknown company") {
      await upsertCompany({
        name: record.company,
        domain: sourceDomain(job.url, job.sourceProvider),
        atsProvider: job.raw?.ats?.provider || "",
        atsIdentifier: job.raw?.ats?.boardToken || job.raw?.ats?.company || job.raw?.ats?.tenant || "",
        metadata: {
          lastDiscoverySource: job.sourceProvider,
          ...(job.raw?.ats ? { atsDescriptor: job.raw.ats } : {}),
        },
      });
    }
    if (!unchanged || ["triage_pending", "error"].includes(existing?.status)) persisted.push(record);
  }
  return persisted;
}

export async function persistExtractedJobs(jobs = []) {
  return normalizeAndPersist(uniqueJobs(jobs));
}

const TRIAGE_TRANSFERABLE_RESPONSIBILITY_SIGNALS = [
  {
    id: "analytics_insights",
    pattern: /\b(analytics?|insights?|measurement|metrics?|forecasting|decision intelligence|decision support|performance management)\b/i,
  },
  {
    id: "experimentation_science",
    pattern: /\b(experiment(?:ation|s)?|a\/?b test(?:ing)?|causal inference|statistical|predictive model(?:ing)?|data science|machine learning)\b/i,
  },
  {
    id: "data_decision_product",
    pattern: /\b(data product|analytics product|intelligence platform|decision(?:ing)? platform|product strategy|product development|product roadmap|technical product manager|platform product manager)\b/i,
  },
  {
    id: "data_strategy_architecture",
    pattern: /\b(data strategy|analytics strategy|data model(?:s|ing)?|data flow(?:s)?|decision logic|decision framework(?:s)?|data architecture|data ecosystem)\b/i,
  },
  {
    id: "customer_growth_marketing",
    pattern: /\b(customer|marketing|growth|retention|acquisition|lifecycle|commercial) (?:analytics?|insights?|science|strategy|measurement)\b/i,
  },
  {
    id: "cross_functional_builder",
    pattern: /\b(0[- ]to[- ]1|zero[- ]to[- ]one|cross[- ]functional|stakeholder leadership|operating model|product builder|build(?:ing)? foundational capabilities)\b/i,
  },
];

export function applyHighRecallTriageSafety(job, evaluation) {
  if (!evaluation || evaluation.relevance !== "irrelevant") return evaluation;

  const titleMatch = classifyCandidateTitle(job?.title || "");
  if (titleMatch.excludedConcepts.length && !titleMatch.eligible) return evaluation;

  const responsibilityText = `${job?.title || ""}\n${job?.description || ""}`;
  const matchedSignals = TRIAGE_TRANSFERABLE_RESPONSIBILITY_SIGNALS
    .filter((signal) => signal.pattern.test(responsibilityText))
    .map((signal) => signal.id);
  const qualifiedProductTitle = /\b(technical|platform|data|analytics|ai|ml|decision(?:ing)?|intelligence)\s+product\s+(manager|lead|director|head)\b/i
    .test(job?.title || "");
  const plausibleTransferableScope = matchedSignals.length >= 3
    || (matchedSignals.length >= 2 && (titleMatch.eligible || qualifiedProductTitle));
  if (!plausibleTransferableScope) return evaluation;

  const originalConfidence = Number(evaluation.confidence) || 0;
  const overrideReason = `High-recall safety override: transferable responsibility signals (${matchedSignals.join(", ")}) require deep review.`;
  return {
    ...evaluation,
    relevance: "uncertain",
    confidence: Math.min(originalConfidence, 0.8),
    roleFamilyId: evaluation.roleFamilyId === "exploratory" && titleMatch.familyId !== "exploratory"
      ? titleMatch.familyId
      : evaluation.roleFamilyId,
    scopeSummary: evaluation.scopeSummary === "No scope summary returned."
      ? "Plausible analytics, data, strategy, or product-building scope requires deep review."
      : evaluation.scopeSummary,
    reasons: [...new Set([...(evaluation.reasons || []), overrideReason])].slice(0, 8),
    unknowns: [...new Set([...(evaluation.unknowns || []), "Triage rejection conflicted with transferable responsibility evidence."])].slice(0, 8),
    safetyOverride: {
      policy: "high_recall_transferable_scope_v1",
      originalRelevance: evaluation.relevance,
      originalConfidence,
      matchedSignals,
    },
  };
}

function triageMessages(batch) {
  return [
    {
      role: "system",
      content: "You are a high-recall career-function screener. Return compact JSON only. Protect against false rejection: classify primary responsibilities against demonstrated experience, not title keywords, industry, eligibility, compensation, prestige, AI content, or remote-work preferences. confidence is certainty in the relevance label. Keep scopeSummary under 25 words and reasons/unknowns to at most three short items each.",
    },
    {
      role: "user",
      content: `Candidate profile:\n${TARGET_PROFILE.baseline}\n\nCore expertise:\n${JSON.stringify(TARGET_PROFILE.coreExpertise, null, 2)}\n\nDifferentiators, not prerequisites:\n${JSON.stringify(TARGET_PROFILE.differentiators, null, 2)}\n\nTriage policy:\n${JSON.stringify(TARGET_PROFILE.evaluationPolicy, null, 2)}\n\nEvaluate only primary responsibility fit. Data-science management, analytics leadership, experimentation, product/growth/marketing/customer analytics, strategy analytics, decision science, data products, Business Manager roles with analytical ownership, technical/platform product management, decision-intelligence platforms, and cross-functional 0-to-1 product building are direct or plausible matches. A title containing Technical Product Manager, Platform Product Manager, Service Intelligence, Decision Intelligence, or an unfamiliar product label is not a rejection reason when the responsibilities include data, analytics, decisioning, product strategy, or AI/ML. Different industries, public-sector work, lack of AI or financial-services content, US onsite/hybrid work, compensation, visa evidence, and interview format must not reduce relevance; those are separate later gates. Python, SQL, statistics, predictive modeling, and experimentation inside analytics/data science do not make the function irrelevant. Use irrelevant only when supplied responsibilities clearly show a predominantly unrelated function such as software implementation, pure data-engineering IC delivery, IT support, sales, legal, or clinical work. Use uncertain for incomplete, mixed, or plausibly transferable descriptions. Before returning irrelevant, explicitly test whether at least two demonstrated areas transfer; if they do, return uncertain or relevant. Always return a concrete scopeSummary based on the primary responsibilities. roleFamilyId must be exactly one of: ai_product_platform, data_ai_strategy, product_decision_science, analytics_leadership, business_strategy_management, ai_governance_model_risk, ai_operator_context, fintech_finserv_leadership, exploratory.\n\nJobs:\n${JSON.stringify(batch.map((job) => ({ sourceId: job.sourceId, title: job.title, company: job.company, location: job.location, description: job.description.slice(0, 5000) })), null, 2)}\n\nReturn {"jobs":[{"sourceId":"...","evaluation":{"roleFamilyId":"...","relevance":"relevant|uncertain|irrelevant","confidence":0.0,"scopeSummary":"...","codingIntensity":"low|medium|high|unknown","seniority":"too_junior|aligned|stretch|unknown","reasons":[],"unknowns":[]}}]}`,
    },
  ];
}

async function triageJobs(jobs, runId) {
  const results = [];
  for (const batch of chunks(jobs, 3)) {
    const response = await callTriageModel({
      messages: triageMessages(batch), schema: triageBatchSchema, runId,
      operation: "triage", maxTokens: 1800,
    });
    if (!response.result) {
      for (const job of batch) {
        const updated = await upsertJob({
          ...job,
          status: "triage_pending",
          details: { ...job.details, triageStatus: response.status, triageAttempts: response.attempts || [] },
        });
        results.push(updated);
      }
      continue;
    }
    const bySource = new Map(response.result.jobs.map((item) => [item.sourceId, item.evaluation]));
    for (const job of batch) {
      const rawEvaluation = bySource.get(job.sourceId);
      if (!rawEvaluation) {
        results.push(await upsertJob({ ...job, status: "triage_pending", details: { ...job.details, triageStatus: "missing_result" } }));
        continue;
      }
      const evaluation = applyHighRecallTriageSafety(job, rawEvaluation);
      const reject = evaluation.relevance === "irrelevant" && evaluation.confidence >= 0.95;
      const status = reject ? "triage_rejected" : "deep_review_pending";
      const updated = await upsertJob({
        ...job,
        roleFamilyId: evaluation.roleFamilyId || job.roleFamilyId,
        status,
        details: {
          ...job.details,
          triage: evaluation,
          triageStatus: "complete",
          triagePromptVersion: PROMPT_VERSION,
          triageProvider: response.provider,
          triageModel: response.model,
          triageAttempts: response.attempts || [],
          deepEvaluation: null,
          deepStatus: "pending",
          deepPromptVersion: null,
          evaluationFrameworkVersion: null,
          critic: null,
          criticStatus: "pending",
          criticPromptVersion: null,
          modelAgreement: "pending",
          outreach: null,
        },
      });
      await recordEvaluation({
        jobId: job.id, runId, stage: "triage", provider: response.provider, model: response.model,
        promptVersion: PROMPT_VERSION, verdict: evaluation.relevance, score: evaluation.confidence * 100,
        output: evaluation, usage: response.usage,
      });
      results.push(updated);
    }
  }
  return results;
}

async function researchJob(job, runId) {
  const cacheKey = hash(
    "company-role-posting-research-v6",
    job.company,
    job.normalizedTitle || job.title,
    job.location,
    job.canonicalUrl || job.sourceId,
  );
  const cached = await readResearchCache(cacheKey);
  if (cached) return cached;
  const cleanTitle = String(job.title || "").replace(/[^a-z0-9&,+/() -]+/gi, " ").replace(/\s+/g, " ").trim();
  const cleanLocation = String(job.location || "").replace(/[^a-z0-9&,+/() -]+/gi, " ").replace(/\s+/g, " ").trim();
  const locationTerm = cleanLocation && !/^(remote|multiple locations?)$/i.test(cleanLocation)
    ? ` "${cleanLocation}"`
    : "";
  const codingRisk = classifyCodingInterviewRisk(job);
  const interviewTerms = ["near_certain", "elevated"].includes(codingRisk.riskLevel)
    ? " OR \"coding interview\" OR \"live coding\" OR \"SQL assessment\" OR \"Python assessment\" OR \"technical screen\" OR \"interview process\""
    : "";
  const queries = [
    `"${job.company}" "${cleanTitle}"${locationTerm} (salary OR compensation OR "pay range" OR sponsorship OR "work authorization"${interviewTerms})`,
    `"${job.company}" ("STEM OPT" OR "F-1 OPT" OR "E-Verify" OR H-1B OR LCA) (site:e-verify.gov OR site:dol.gov OR site:uscis.gov OR site:dhs.gov)`,
  ];
  const results = [];
  const errors = [];
  const configuredResearchCap = Number(process.env.JOBSEARCH_BRAVE_RESEARCH_STOP_AT_MONTHLY_REQUESTS || 600);
  const researchCap = Number.isFinite(configuredResearchCap) ? Math.max(0, configuredResearchCap) : 600;
  for (const query of queries) {
    const usage = await getUsageSummary();
    if ((usage.byProvider.brave?.requests || 0) >= researchCap) {
      errors.push("Brave research reserve reached; remaining facts stay unknown.");
      break;
    }
    try {
      const response = await braveWithinQuota(query, { runId, freshness: "", count: 6 });
      if (response.status !== "live") errors.push(`Brave research status: ${response.status}.`);
      results.push(...response.results.map((item) => ({ ...item, query })));
    } catch (error) {
      errors.push(String(error.message || error).slice(0, 300));
    }
  }
  const limitedResults = results.slice(0, 24);
  const contactCandidates = limitedResults
    .filter((item) => /recruiter|talent|hiring|head of|director|vice president|\bvp\b/i.test(`${item.title} ${item.description}`))
    .slice(0, 6)
    .map((item) => ({ nameOrTitle: item.title, url: item.url, evidence: item.description, source: "brave" }));
  const research = {
    company: job.company,
    collectedAt: new Date().toISOString(),
    status: limitedResults.length ? (errors.length ? "partial" : "complete") : errors.length ? "blocked" : "empty",
    results: limitedResults,
    contactCandidates,
    errors,
  };
  if (limitedResults.length) {
    await writeResearchCache({ cacheKey, company: job.company, topic: "job_fit", result: research, ttlDays: 30 });
  }
  return research;
}

function pageExtractionEvidence(job, description) {
  return {
    claimType: "job_posting",
    value: "Extracted source job description",
    sourceUrl: job.canonicalUrl || "",
    supportingPassage: description.slice(0, 600),
    sourceDate: job.postedAt || job.details?.sourceMetadata?.postedAtRaw || "",
    confidence: 1,
    evidenceType: "explicit",
  };
}

export function isRicherExtractedDescription(job, candidate) {
  const current = String(job?.description || "").trim();
  const description = String(candidate?.description || "").trim();
  if (description.length < Math.max(600, current.length + 300, Math.ceil(current.length * 1.2))) return false;
  const titleTokens = normalizeTitle(job?.title || "").split(" ").filter((token) => token.length >= 4);
  const normalizedDescription = normalizeTitle(description);
  const titleOverlap = titleTokens.filter((token) => normalizedDescription.includes(token)).length;
  const jobLanguage = /responsibilit|qualification|requirement|experience|about the role|what you.ll do|compensation|salary|benefits/i.test(description);
  const challengePage = /sign in to continue|join linkedin|verify you are human|unusual traffic|captcha|access denied/i.test(description);
  return !challengePage && jobLanguage && (titleOverlap >= 1 || !titleTokens.length);
}

export async function prepareWindowsDeepJob({ jobId, runId = null }) {
  let job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} was not found.`);

  const extractionMetadata = job.details?.sourceMetadata?.pageExtraction;
  if (job.canonicalUrl && (!extractionMetadata || job.description.length < 1200)) {
    const extracted = await extractJobPage(job.canonicalUrl, { runId });
    if (isRicherExtractedDescription(job, extracted.job)) {
      const description = extracted.job.description;
      const sourceEvidence = [
        ...(job.details?.sourceEvidence || []).filter((item) => item.claimType !== "job_posting"),
        pageExtractionEvidence(job, description),
      ];
      job = await upsertJob({
        ...job,
        description,
        location: job.location || extracted.job.location || "",
        contentHash: hash(job.title, job.company, job.location || extracted.job.location || "", description),
        details: {
          ...job.details,
          sourceEvidence,
          sourceMetadata: {
            ...(job.details?.sourceMetadata || {}),
            pageExtraction: {
              status: extracted.status,
              descriptionCharacters: description.length,
              extractedAt: new Date().toISOString(),
            },
          },
        },
      });
    } else if (!extractionMetadata) {
      job = await upsertJob({
        ...job,
        details: {
          ...job.details,
          sourceMetadata: {
            ...(job.details?.sourceMetadata || {}),
            pageExtraction: {
              status: extracted.status,
              error: extracted.error || "No richer source description was returned.",
              extractedAt: new Date().toISOString(),
            },
          },
        },
      });
    }
  }

  if (!job.details?.research?.collectedAt) {
    const research = await researchJob(job, runId);
    job = await upsertJob({
      ...job,
      details: { ...job.details, research, contactCandidates: research.contactCandidates || [] },
    });
  }
  return job;
}

function deepEvidenceMessages(job, research) {
  const compactResearch = (research?.results || []).slice(0, 6).map((item) => ({
    title: item.title,
    url: item.url,
    description: String(item.description || "").slice(0, 400),
    age: item.age || "",
  }));
  return [
    {
      role: "system",
      content: "Extract only evidence supplied in the job posting or web snippets. Return JSON only. Unknown facts must remain unknown.",
    },
    {
      role: "user",
      content: `Job:\n${JSON.stringify({ title: job.title, company: job.company, location: job.location, url: job.canonicalUrl, description: job.description.slice(0, 7500), structuredCompensation: job.details?.sourceMetadata?.compensation || "" })}\n\nWeb snippets:\n${JSON.stringify(compactResearch)}\n\nReturn at most six material claims. Prioritize responsibility fit, job-level work-authorization restrictions, annual base compensation, and explicit interview stages. Each explicit or inferred claim requires a supplied source URL and a verbatim supporting passage under 240 characters. Employer sponsorship history is not job-level sponsorship. Missing facts belong in unknowns.`,
    },
  ];
}

function compactFeedbackExamples(examples) {
  return examples.slice(0, 4).map((example) => ({
    title: String(example.title || "").slice(0, 180),
    company: String(example.company || "").slice(0, 180),
    disposition: example.disposition || "",
    reasons: Array.isArray(example.reasons) ? example.reasons.slice(0, 4) : [],
    note: String(example.note || "").slice(0, 240),
  }));
}

function deepMessages(job, research, examples, extraction = {}) {
  const compactResearch = (research?.results || []).slice(0, 4).map((item) => ({
    title: String(item.title || "").slice(0, 220),
    url: item.url,
    description: String(item.description || "").slice(0, 320),
  }));
  return [
    {
      role: "system",
      content: "You are a rigorous career strategist. Return one compact JSON object only. Ground facts in supplied evidence. Unknown must remain unknown. Keep every reason under 35 words.",
    },
    {
      role: "user",
      content: `Candidate:\n${TARGET_PROFILE.baseline}\n\nCore expertise:\n${JSON.stringify(TARGET_PROFILE.coreExpertise)}\n\nDifferentiators only:\n${JSON.stringify(TARGET_PROFILE.differentiators)}\n\nFour must-haves:\n${JSON.stringify(TARGET_PROFILE.hardRequirements)}\n\nWeights: ${JSON.stringify(TARGET_PROFILE.rankingWeights)}\n\nJob:\n${JSON.stringify({ title: job.title, company: job.company, location: job.location, url: job.canonicalUrl, description: job.description.slice(0, 6500), structuredCompensation: job.details?.sourceMetadata?.compensation || "" })}\n\nExtracted evidence:\n${JSON.stringify(extraction)}\n\nAdditional web snippets:\n${JSON.stringify(compactResearch)}\n\nOwner examples:\n${JSON.stringify(compactFeedbackExamples(examples))}\n\nEvaluate from responsibilities, not title or triage. The supplied candidate profile and job posting are the evidence for expertiseFit and leadershipScope: when the posting contains substantive duties, score those dimensions and use evidenceStatus=inferred; never call them unknown merely because no external source links the candidate to the role. Expertise fit: 5 requires direct alignment across several demonstrated areas with no material mandatory-experience gap; 4 is strong alignment with only minor gaps; 3 is substantive transferable alignment but the posting names one or more material mandatory domain, data, method, or tool gaps; 2 is weak adjacency or several severe mandatory gaps; 0-1 is unrelated. Industry or public-sector context alone is never a penalty, but explicit requirements such as several years of healthcare claims, specialized clinical coding, or another domain capability absent from the résumé are real fit gaps and must reduce the score without erasing transferable analytics fit. Never lower expertise or leadership for missing AI/finance content, onsite work, or missing salary/visa/interview evidence. Use score=null and evidenceStatus=unknown only for facts the supplied material truly does not establish; unknown is never 0. ${INTERVIEW_RISK_INSTRUCTIONS} Missing compensation, sponsorship, or interview evidence means unknown and maybe, not pass. Annual base below $170k, explicit no-current/future sponsorship, citizenship/clearance, and explicit coding/SQL/Python assessments are blockers. F-1/OPT/CPT compatibility alone does not prove future sponsorship. Employer history must not override a job-level restriction. Engineering implementation is an expertise blocker. AI/ML, finance, remote work, seniority, company quality, and interview speed are bonuses only.\n\nReturn exactly one object with verdict=apply|maybe|pass, overallScore=0..100, summary, dimensions, mustHave, claims, redFlags, greenFlags, unknowns, and outreachAngle. dimensions must contain expertiseFit, workAuthorization, compensation, codingInterviewSafety, leadershipScope, companyQuality, interviewVelocity, aiMlProductAdjacency, financialServicesAdvantage, and remoteFlexibility. Every dimension is {"score":0..5 or null,"evidenceStatus":"explicit|inferred|unknown","confidence":0..1,"reasoning":"under 35 words"}. mustHave must contain expertiseFit, workAuthorization, compensation, and codingInterview. Every gate is {"status":"met|blocked|unknown","evidenceStatus":"explicit|inferred|unknown","reasoning":"under 35 words","sourceUrl":"URL or empty"}. verdict is only the model recommendation; the server recomputes gates, score, and final verdict. Keep external factual claims to supplied evidence and preserve unknowns.`,
    },
  ];
}

function compareDeepCandidates(left, right) {
  const relevance = { relevant: 2, uncertain: 1, irrelevant: 0 };
  const lane = { title_family: 2, exploratory: 0 };
  const coding = { low: 3, unknown: 2, medium: 1, high: 0 };
  return (lane[right.details?.titleClassification?.lane] || 0) - (lane[left.details?.titleClassification?.lane] || 0)
    || (relevance[right.details?.triage?.relevance] || 0) - (relevance[left.details?.triage?.relevance] || 0)
    || (coding[right.details?.triage?.codingIntensity] || 0) - (coding[left.details?.triage?.codingIntensity] || 0)
    || (Number(right.details?.triage?.confidence) || 0) - (Number(left.details?.triage?.confidence) || 0)
    || new Date(right.postedAt || right.firstSeenAt || 0).getTime() - new Date(left.postedAt || left.firstSeenAt || 0).getTime();
}

async function deepEvaluateJobs(jobs, runId) {
  const candidates = jobs
    .filter((job) => shouldQueueDeepForJob(job))
    .sort(compareDeepCandidates);
  const evaluated = [];
  for (const job of candidates) {
    const research = await researchJob(job, runId);
    const examples = await listFeedbackExamples(job.roleFamilyId);
    const extractionResponse = await callUtilityModel({
      messages: deepEvidenceMessages(job, research), schema: cloudEvidenceExtractionSchema,
      runId, operation: "deep_evidence_extract", maxTokens: 900,
    });
    const extraction = extractionResponse.result || { claims: [], unknowns: [] };
    const response = await callDeepModel({
      messages: deepMessages(job, research, examples, extraction), schema: cloudDeepEvaluationSchema,
      runId, operation: "deep_fit", maxTokens: 1200,
    });
    if (!response.result) {
      evaluated.push(await upsertJob({
        ...job,
        status: "deep_review_pending",
        details: {
          ...job.details,
          deepStatus: response.status,
          deepAttempts: response.attempts || [],
          evidenceExtractionStatus: extractionResponse.status,
          evidenceExtractionAttempts: extractionResponse.attempts || [],
          research,
        },
      }));
      continue;
    }
    const currentClaims = dedupeClaims([...(extraction.claims || []), ...(response.result.claims || [])]);
    const finalized = finalizeDeepEvaluation(
      withCurrentEvaluationClaims(job, currentClaims),
      { ...response.result, claims: currentClaims },
    );
    const evaluation = await recordEvaluation({
      jobId: job.id, runId, stage: "deep", provider: response.provider, model: response.model,
      promptVersion: PROMPT_VERSION, verdict: finalized.verdict, score: finalized.overallScore,
      output: finalized, usage: response.usage,
    });
    const claims = dedupeClaims([
      ...(job.details?.sourceEvidence || []),
      ...(finalized.claims || []),
    ]);
    await replaceClaims(job.id, evaluation.id, claims);
    const status = finalized.verdict === "apply" ? "critic_pending"
      : finalized.verdict === "maybe" ? "needs_review" : "passed";
    evaluated.push(await upsertJob({
      ...job, status,
      details: {
        ...job.details, deepEvaluation: finalized, deepStatus: "complete", deepPromptVersion: PROMPT_VERSION,
        evaluationFrameworkVersion: EVALUATION_FRAMEWORK_VERSION,
        deepProvider: response.provider, deepModel: response.model, deepAttempts: response.attempts || [],
        evidenceExtractionStatus: extractionResponse.status,
        evidenceExtractionAttempts: extractionResponse.attempts || [],
        research, claims,
        contactCandidates: research.contactCandidates || [],
      },
    }));
  }
  return evaluated;
}

async function selectDeepCandidates(jobIds, includeBacklog = true) {
  const [current, backlog] = await Promise.all([
    jobsForIds(jobIds),
    includeBacklog ? listJobs({ view: "all", limit: 1000 }) : Promise.resolve([]),
  ]);
  const jobs = [...new Map([...current, ...backlog.filter((job) => shouldQueueDeepForJob(job))]
    .map((job) => [job.id, job])).values()];
  return jobs
    .filter((job) => shouldQueueDeepForJob(job))
    .sort(compareDeepCandidates);
}

function criticMessages(job) {
  const evidence = (job.details?.claims || []).slice(0, 12).map((claim) => ({
    ...claim,
    supportingPassage: String(claim.supportingPassage || "").slice(0, 500),
  }));
  return [
    { role: "system", content: "Act as an independent evaluation auditor. Return JSON only and use only supplied evidence. Look equally for false rejection and false optimism; do not preserve agreement for its own sake." },
    { role: "user", content: `Candidate profile:\n${TARGET_PROFILE.baseline}\n\nCore expertise:\n${JSON.stringify(TARGET_PROFILE.coreExpertise, null, 2)}\n\nEvaluation policy:\n${JSON.stringify(TARGET_PROFILE.evaluationPolicy, null, 2)}\n\nMust-have gates:\n${JSON.stringify(TARGET_PROFILE.hardRequirements, null, 2)}\n\nJob and primary evaluation:\n${JSON.stringify({ title: job.title, company: job.company, description: job.description.slice(0, 8000), primary: job.details?.deepEvaluation, evidence }, null, 2)}\n\nReconstruct the decision from scratch. Challenge responsibility-fit reasoning, unsupported gates, score/reason contradictions, annual-base versus total-compensation mistakes, unrelated-company or unrelated-role research, hidden coding-interview risk, and work-authorization evidence. Public-sector or different-industry context can still be a strong expertise match. Industry alone is not a penalty, but explicit mandatory domain, data, method, or tool requirements absent from the résumé are real fit gaps. Lack of AI, financial-services overlap, remote work, or prestige cannot reduce core fit. Missing evidence cannot become score 0, met, or blocked. F-1/OPT/CPT acceptance alone cannot establish future sponsorship. Engineering and coding-bound scientist IC roles are near-certain coding risks absent contrary role-specific evidence; product/decision science and data-science management are elevated but not automatically blocked. An inferred coding-archetype score may coexist with an unknown interview gate and is not itself a contradiction. The server intentionally recomputes final overallScore and verdict; differences from modelOverallScore or modelVerdict are not anomalies by themselves. A pass requires a supported blocker; unknown gates without a blocker require maybe. Return agrees, recommendedVerdict, confidence, objections, unsupportedClaims, and summary under 100 words. Put every material anomaly and its corrected gate or dimension in objections.` },
  ];
}

export function normalizeCriticAgreement(result, primaryVerdict) {
  return {
    ...result,
    agrees: Boolean(primaryVerdict) && result?.recommendedVerdict === primaryVerdict,
  };
}

async function criticJobs(jobs, runId) {
  const candidates = jobs.filter((job) => shouldQueueCriticForJob(job))
    .sort((a, b) => (b.details?.deepEvaluation?.overallScore || 0) - (a.details?.deepEvaluation?.overallScore || 0))
    ;
  const reviewed = [];
  const calibration = await getCalibrationStatus();
  for (const job of candidates) {
    const response = await callCriticModel({ messages: criticMessages(job), schema: criticSchema, runId, operation: "critic" });
    if (!response.result) {
      reviewed.push(await upsertJob({
        ...job,
        status: "needs_review",
        details: { ...job.details, criticStatus: response.status, criticAttempts: response.attempts || [] },
      }));
      continue;
    }
    const primaryVerdict = job.details?.deepEvaluation?.verdict;
    const criticResult = normalizeCriticAgreement(response.result, primaryVerdict);
    await recordEvaluation({
      jobId: job.id, runId, stage: "critic", provider: response.provider, model: response.model,
      promptVersion: PROMPT_VERSION, verdict: criticResult.recommendedVerdict,
      score: criticResult.confidence * 100, output: criticResult, usage: response.usage,
    });
    const disagreement = !criticResult.agrees;
    const hardBlocked = (job.details?.deepEvaluation?.decision?.blockers || []).length > 0;
    reviewed.push(await upsertJob({
      ...job,
      status: disagreement ? "needs_review"
        : hardBlocked ? "passed"
        : primaryVerdict === "apply" && calibration.active ? "shortlisted"
          : primaryVerdict === "pass" ? "passed" : "needs_review",
      details: {
        ...job.details,
        critic: criticResult,
        criticStatus: "complete",
        criticPromptVersion: PROMPT_VERSION,
        criticProvider: response.provider,
        criticModel: response.model,
        criticAttempts: response.attempts || [],
        modelAgreement: disagreement ? "disagree" : "agree",
        autoShortlist: primaryVerdict === "apply" && !disagreement
          ? { enabled: calibration.active, calibration }
          : null,
      },
    }));
  }
  return reviewed;
}

async function selectCriticCandidates(jobIds, includeBacklog = true) {
  const [current, backlog] = await Promise.all([
    jobsForIds(jobIds),
    includeBacklog ? listJobs({ view: "all", limit: 1000 }) : Promise.resolve([]),
  ]);
  const jobs = [...new Map([...current, ...backlog.filter((job) => shouldQueueCriticForJob(job))]
    .map((job) => [job.id, job])).values()];
  return jobs.filter((job) => shouldQueueCriticForJob(job))
    .sort((a, b) => (b.details?.deepEvaluation?.overallScore || 0) - (a.details?.deepEvaluation?.overallScore || 0));
}

async function draftOutreach(job, runId) {
  const result = await callUtilityModel({
    runId, operation: "outreach", schema: outreachSchema, maxTokens: 500,
    messages: [
      { role: "system", content: "Write a concise truthful outreach note. Return JSON only. Do not invent facts or contacts." },
      { role: "user", content: `Candidate identity: ${TARGET_PROFILE.outreachIdentity}.\n\nCandidate background:\n${TARGET_PROFILE.baseline}\n\nJob: ${JSON.stringify({ title: job.title, company: job.company, evaluation: job.details?.deepEvaluation, evidence: job.details?.claims }, null, 2)}\n\nReturn a subject and message under 170 words. Lead with the candidate experience most relevant to this role. Mention work authorization only when explicitly supported, and never imply permanent authorization.` },
    ],
  });
  if (!result.result) return job;
  return upsertJob({ ...job, details: { ...job.details, outreach: result.result } });
}

async function proposeTaxonomy(runId) {
  const observations = await listTitleObservations({ unmatchedOnly: true, limit: 12 });
  const patterns = await listTitlePatterns();
  const jobs = await listJobs({ view: "all", limit: 1000 });
  const labelled = jobs.filter((job) => job.disposition);
  const proposals = [];
  for (const observation of observations) {
    if (patterns.some((pattern) => pattern.expression === observation.normalizedTitle)) continue;
    const response = await callUtilityModel({
      runId, operation: "taxonomy_proposal", schema: taxonomyProposalSchema, maxTokens: 500,
      messages: [
        { role: "system", content: "Map a job title to the candidate's role taxonomy. Return JSON only. Do not write regex." },
        { role: "user", content: `Title: ${observation.rawTitle}\nAllowed families: ai_product_platform, data_ai_strategy, product_decision_science, analytics_leadership, business_strategy_management, ai_governance_model_risk, ai_operator_context, fintech_finserv_leadership. Return familyId, familyLabel, confidence, rationale. If no family is appropriate, use familyId=exploratory.` },
      ],
    });
    if (!response.result || response.result.familyId === "exploratory") continue;
    const proposal = buildAliasProposal({
      title: observation.rawTitle,
      familyId: response.result.familyId,
      familyLabel: response.result.familyLabel,
      confidence: response.result.confidence,
    });
    if (!proposal) continue;
    proposal.supportCount = observation.occurrenceCount;
    proposal.metrics = { ...proposal.metrics, rationale: response.result.rationale };
    const assessment = evaluateProposalForPromotion(proposal, labelled);
    proposal.metrics = { ...proposal.metrics, ...assessment };
    proposal.status = assessment.autoPromote ? "active" : "proposed";
    proposals.push(await saveTitlePattern(proposal));
  }
  return proposals;
}

async function jobsForIds(jobIds = []) {
  const jobs = [];
  for (const jobId of jobIds) {
    const job = await getJob(jobId);
    if (job) jobs.push(job);
  }
  return jobs;
}

export async function runDiscoveryStage({ runId, trigger, slot, discoveryUrls }) {
  const discovered = await discover({ runId, trigger, slot, discoveryUrls });
  const leads = await recordDiscoveryLeads(discovered.rawLeads.map((lead) => ({ ...lead, runId })));
  const changed = await normalizeAndPersist(discovered.jobs);
  return {
    jobIds: changed.map((job) => job.id),
    discoveredCount: leads.length,
    extractedCount: discovered.jobs.length,
    changedCount: changed.length,
    providers: discovered.providers,
  };
}

export async function runTriageStage({ runId, jobIds }) {
  const jobs = await jobsForIds(jobIds);
  const triaged = await triageJobs(jobs, runId);
  return { jobIds: triaged.map((job) => job.id), triagedCount: triaged.length };
}

export async function enqueueJobsForLocalProcessing({ runId = null, jobIds = [] }) {
  const [currentJobs, backlog, patterns] = await Promise.all([
    jobsForIds(jobIds),
    listJobs({ view: "all", limit: 5000 }),
    listTitlePatterns({ includeInactive: false }),
  ]);
  const rawJobs = [...new Map([
    ...currentJobs,
    ...backlog.filter((job) => shouldRefreshTriage(job) || shouldQueueDeepForJob(job)),
  ].map((job) => [job.id, job])).values()];
  const jobs = [];
  for (const job of rawJobs) {
    const classification = currentTitleClassification(job.title, patterns);
    const staleOntology = job.details?.titleClassification?.ontology?.ontologyVersion
      !== classification.titleClassification.ontology.ontologyVersion;
    const changedFamily = job.roleFamilyId !== classification.roleFamilyId;
    if (staleOntology || changedFamily) {
      jobs.push(await updateJobClassification(job.id, classification));
    } else {
      jobs.push(job);
    }
  }
  const queued = [];
  for (const job of jobs) {
    const taskType = nextLocalTaskType(job);
    if (!taskType) continue;
    const task = await enqueueLocalTask({
      jobId: job.id,
      taskType,
      priority: localTaskPriority(job, taskType),
      revision: windowsTaskRevision(job, taskType),
      payload: { sourceId: job.sourceId, runId },
    });
    queued.push(task);
    await upsertJob({
      ...job,
      status: taskType === "triage" ? "local_triage_pending"
        : taskType === "deep" ? "deep_review_pending"
          : taskType === "critic" ? "critic_pending"
            : job.status,
      details: {
        ...job.details,
        ...(taskType === "triage" ? { triageStatus: "pending" } : {}),
        ...(taskType === "deep" ? { deepStatus: "pending", criticStatus: "pending", modelAgreement: "pending" } : {}),
        ...(taskType === "critic" ? { criticStatus: "pending", modelAgreement: "pending" } : {}),
        localQueue: { status: task.status, taskId: task.id, taskType, queuedAt: new Date().toISOString() },
      },
    });
  }
  return { queuedCount: queued.length, taskIds: queued.map((task) => task.id) };
}

export async function selectDeepJobIds({ jobIds, includeBacklog = true }) {
  return (await selectDeepCandidates(jobIds, includeBacklog)).map((job) => job.id);
}

export async function runDeepStage({ runId, jobIds, includeBacklog = true }) {
  const [current, backlog] = await Promise.all([
    jobsForIds(jobIds),
    includeBacklog ? listJobs({ view: "all", limit: 1000 }) : Promise.resolve([]),
  ]);
  const jobs = [...new Map([...current, ...backlog.filter((job) => shouldQueueDeepForJob(job))]
    .map((job) => [job.id, job])).values()];
  const evaluated = await deepEvaluateJobs(jobs, runId);
  return {
    jobIds: evaluated.map((job) => job.id),
    evaluatedCount: evaluated.filter((job) => job.details?.deepStatus === "complete").length,
    blockedCount: evaluated.filter((job) => job.details?.deepStatus && job.details.deepStatus !== "complete").length,
  };
}

export async function selectCriticJobIds({ jobIds, includeBacklog = true }) {
  return (await selectCriticCandidates(jobIds, includeBacklog)).map((job) => job.id);
}

export async function runCriticStage({ runId, jobIds, includeBacklog = true }) {
  const [current, backlog] = await Promise.all([
    jobsForIds(jobIds),
    includeBacklog ? listJobs({ view: "all", limit: 1000 }) : Promise.resolve([]),
  ]);
  const jobs = [...new Map([...current, ...backlog.filter((job) => shouldQueueCriticForJob(job))]
    .map((job) => [job.id, job])).values()];
  const reviewed = await criticJobs(jobs, runId);
  return {
    jobIds: reviewed.map((job) => job.id),
    reviewedCount: reviewed.filter((job) => job.details?.criticStatus === "complete").length,
    blockedCount: reviewed.filter((job) => job.details?.criticStatus && job.details.criticStatus !== "complete").length,
    shortlistIds: reviewed.filter((job) => job.status === "shortlisted").map((job) => job.id),
  };
}

export async function runOutreachStage({ runId, jobIds }) {
  const [current, shortlist] = await Promise.all([jobsForIds(jobIds), listJobs({ view: "shortlist", limit: 1000 })]);
  const jobs = [...new Map([...current, ...shortlist.filter((job) => !job.details?.outreach)]
    .map((job) => [job.id, job])).values()];
  for (const job of jobs) await draftOutreach(job, runId);
  return { draftedCount: jobs.length };
}

export async function runTaxonomyStage({ runId, slot }) {
  if (slot !== "evening") return { proposalCount: 0 };
  return { proposalCount: (await proposeTaxonomy(runId)).length };
}

export async function runLocalTriageEvaluation({ jobId, runId = null }) {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} was not found.`);
  const response = await callLocalModel({
    stage: "triage", messages: triageMessages([job]), schema: triageBatchSchema,
    runId, operation: "local_triage", maxTokens: 1400,
  });
  const rawEvaluation = response.result?.jobs?.find((item) => item.sourceId === job.sourceId)?.evaluation;
  if (!rawEvaluation) throw new Error(`Local triage failed: ${response.status}${response.error ? ` (${response.error})` : ""}`);
  const evaluation = applyHighRecallTriageSafety(job, rawEvaluation);
  const reject = evaluation.relevance === "irrelevant" && evaluation.confidence >= 0.95;
  const updated = await upsertJob({
    ...job,
    roleFamilyId: evaluation.roleFamilyId || job.roleFamilyId,
    status: reject ? "triage_rejected" : "deep_review_pending",
    details: {
      ...job.details, triage: evaluation, triageStatus: "complete",
      triagePromptVersion: PROMPT_VERSION,
      triageProvider: response.provider, triageModel: response.model,
      triageAttempts: [{ provider: response.provider, model: response.model, status: response.status }],
      deepEvaluation: null, deepStatus: "pending", deepPromptVersion: null, evaluationFrameworkVersion: null,
      critic: null, criticStatus: "pending", criticPromptVersion: null, modelAgreement: "pending", outreach: null,
    },
  });
  await recordEvaluation({
    jobId: job.id, runId, stage: "triage", provider: response.provider, model: response.model,
    promptVersion: PROMPT_VERSION, verdict: evaluation.relevance, score: evaluation.confidence * 100,
    output: evaluation, usage: response.usage,
  });
  return updated;
}

export async function runLocalDeepEvaluation({ jobId, runId = null }) {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} was not found.`);
  const research = job.details?.research || {
    company: job.company,
    collectedAt: new Date().toISOString(),
    results: [],
    contactCandidates: [],
    status: "direct_evidence_only",
  };
  const examples = await listFeedbackExamples(job.roleFamilyId);
  const response = await callLocalModel({
    stage: "deep", messages: deepMessages(job, research, examples), schema: deepEvaluationSchema,
    runId, operation: "local_deep_fit", maxTokens: 3500,
  });
  if (!response.result) throw new Error(`Local deep evaluation failed: ${response.status}${response.error ? ` (${response.error})` : ""}`);
  const currentClaims = dedupeClaims(response.result.claims || []);
  const finalized = finalizeDeepEvaluation(withCurrentEvaluationClaims(job, currentClaims), response.result);
  const evaluation = await recordEvaluation({
    jobId: job.id, runId, stage: "deep", provider: response.provider, model: response.model,
    promptVersion: PROMPT_VERSION, verdict: finalized.verdict, score: finalized.overallScore,
    output: finalized, usage: response.usage,
  });
  const claims = dedupeClaims([...(job.details?.sourceEvidence || []), ...(finalized.claims || [])]);
  await replaceClaims(job.id, evaluation.id, claims);
  const status = finalized.verdict === "apply" ? "critic_pending"
    : finalized.verdict === "maybe" ? "needs_review" : "passed";
  return upsertJob({
    ...job,
    status,
    details: {
      ...job.details, deepEvaluation: finalized, deepStatus: "complete", deepPromptVersion: PROMPT_VERSION,
      evaluationFrameworkVersion: EVALUATION_FRAMEWORK_VERSION,
      deepProvider: response.provider, deepModel: response.model,
      deepAttempts: [{ provider: response.provider, model: response.model, status: response.status }],
      research, claims, contactCandidates: research.contactCandidates || [],
      critic: null, criticStatus: "pending", criticPromptVersion: null, modelAgreement: "pending", outreach: null,
    },
  });
}

export async function runLocalCriticEvaluation({ jobId, runId = null }) {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} was not found.`);
  if (!job.details?.deepEvaluation) throw new Error(`Job ${jobId} has no deep evaluation to criticise.`);
  const response = await callLocalModel({
    stage: "critic", messages: criticMessages(job), schema: criticSchema,
    runId, operation: "local_critic", maxTokens: 1200,
  });
  if (!response.result) throw new Error(`Local critic failed: ${response.status}${response.error ? ` (${response.error})` : ""}`);
  const primaryVerdict = job.details.deepEvaluation.verdict;
  const criticResult = normalizeCriticAgreement(response.result, primaryVerdict);
  await recordEvaluation({
    jobId: job.id, runId, stage: "critic", provider: response.provider, model: response.model,
    promptVersion: PROMPT_VERSION, verdict: criticResult.recommendedVerdict,
    score: criticResult.confidence * 100, output: criticResult, usage: response.usage,
  });
  const disagreement = !criticResult.agrees;
  const hardBlocked = (job.details.deepEvaluation?.decision?.blockers || []).length > 0;
  const calibration = await getCalibrationStatus();
  return upsertJob({
    ...job,
    status: disagreement ? "needs_review"
      : hardBlocked ? "passed"
      : primaryVerdict === "apply" && calibration.active ? "shortlisted"
        : primaryVerdict === "pass" ? "passed" : "needs_review",
    details: {
      ...job.details, critic: criticResult, criticStatus: "complete", criticPromptVersion: PROMPT_VERSION,
      criticProvider: response.provider, criticModel: response.model,
      criticAttempts: [{ provider: response.provider, model: response.model, status: response.status }],
      modelAgreement: disagreement ? "disagree" : "agree",
      autoShortlist: primaryVerdict === "apply" && !disagreement
        ? { enabled: calibration.active, calibration }
        : null,
    },
  });
}

export async function runLocalOutreachDraft({ jobId, runId = null }) {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} was not found.`);
  const response = await callLocalModel({
    stage: "utility", runId, operation: "local_outreach", schema: outreachSchema, maxTokens: 600,
    messages: [
      { role: "system", content: "Write a concise truthful outreach note. Return JSON only. Do not invent facts or contacts." },
      { role: "user", content: `Candidate identity: ${TARGET_PROFILE.outreachIdentity}.\n\nCandidate background:\n${TARGET_PROFILE.baseline}\n\nJob: ${JSON.stringify({ title: job.title, company: job.company, evaluation: job.details?.deepEvaluation, evidence: job.details?.claims }, null, 2)}\n\nReturn a subject and message under 170 words. Lead with the candidate experience most relevant to this role. Mention work authorization only when explicitly supported, and never imply permanent authorization.` },
    ],
  });
  if (!response.result) throw new Error(`Local outreach drafting failed: ${response.status}${response.error ? ` (${response.error})` : ""}`);
  return upsertJob({ ...job, details: { ...job.details, outreach: response.result } });
}

function deterministicWorkerEvaluationId(taskKey, stage) {
  return `jseval_worker_${hash(taskKey, stage).slice(0, 32)}`;
}

function dedupeClaims(claims = []) {
  const unique = new Map();
  for (const claim of claims) {
    const key = `${claim.claimType || ""}|${claim.value || ""}|${claim.sourceUrl || ""}|${claim.supportingPassage || ""}`;
    if (!unique.has(key)) unique.set(key, claim);
  }
  return [...unique.values()].slice(0, 30);
}

export function withCurrentEvaluationClaims(job, claims = []) {
  return {
    ...job,
    details: {
      ...(job?.details || {}),
      claims: dedupeClaims(claims),
    },
  };
}

export async function applyWindowsWorkerResult({ task, output, resultId, model = "qwen3-4b-q4_k_m", usage = {} }) {
  const job = await getJob(task.jobId);
  if (!job) throw new Error(`Job ${task.jobId} was not found.`);
  const previous = job.details?.workerTaskResults?.[task.taskKey];
  if (previous?.resultId === resultId) return job;

  const parsed = parseWorkerOutput(task.taskType, output);
  const evaluationBase = {
    jobId: job.id,
    runId: task.payload?.runId || null,
    provider: "windows-local",
    model,
    promptVersion: PROMPT_VERSION,
    usage,
  };
  let updated;

  if (task.taskType === "triage") {
    const evaluation = applyHighRecallTriageSafety(job, parsed.triage);
    const reject = evaluation.relevance === "irrelevant" && evaluation.confidence >= 0.95;
    await recordEvaluation({
      ...evaluationBase,
      id: deterministicWorkerEvaluationId(task.taskKey, "triage"),
      stage: "triage",
      verdict: evaluation.relevance,
      score: evaluation.confidence * 100,
      output: evaluation,
    });
    updated = await upsertJob({
      ...job,
      roleFamilyId: evaluation.roleFamilyId || job.roleFamilyId,
      status: reject ? "triage_rejected" : "deep_review_pending",
      details: {
        ...job.details,
        triage: evaluation,
        triageStatus: "complete",
        triagePromptVersion: PROMPT_VERSION,
        triageProvider: evaluationBase.provider,
        triageModel: model,
        triageAttempts: [{ provider: evaluationBase.provider, model, status: "live" }],
        deepEvaluation: null,
        deepStatus: "pending",
        deepPromptVersion: null,
        evaluationFrameworkVersion: null,
        critic: null,
        criticStatus: "pending",
        criticPromptVersion: null,
        modelAgreement: "pending",
        outreach: null,
      },
    });
  } else if (task.taskType === "deep") {
    const currentClaims = dedupeClaims([
      ...parsed.extraction.claims,
      ...(parsed.evaluation.claims || []),
    ]);
    const result = finalizeDeepEvaluation(withCurrentEvaluationClaims(job, currentClaims), parsed.evaluation);
    const evaluation = await recordEvaluation({
      ...evaluationBase,
      id: deterministicWorkerEvaluationId(task.taskKey, "deep"),
      stage: "deep",
      verdict: result.verdict,
      score: result.overallScore,
      output: { ...result, evidenceExtraction: parsed.extraction },
    });
    const claims = dedupeClaims([
      ...(job.details?.sourceEvidence || []),
      ...currentClaims,
    ]);
    await replaceClaims(job.id, evaluation.id, claims);
    updated = await upsertJob({
      ...job,
      status: result.verdict === "apply" ? "critic_pending"
        : result.verdict === "maybe" ? "needs_review" : "passed",
      details: {
        ...job.details,
        evidenceExtraction: parsed.extraction,
        deepEvaluation: result,
        deepStatus: "complete",
        deepPromptVersion: PROMPT_VERSION,
        evaluationFrameworkVersion: EVALUATION_FRAMEWORK_VERSION,
        deepProvider: evaluationBase.provider,
        deepModel: model,
        deepAttempts: [{ provider: evaluationBase.provider, model, status: "live" }],
        claims,
        critic: null,
        criticStatus: "pending",
        criticPromptVersion: null,
        modelAgreement: "pending",
        outreach: null,
      },
    });
  } else if (task.taskType === "critic") {
    if (!job.details?.deepEvaluation) throw new Error(`Job ${job.id} has no deep evaluation to criticise.`);
    const result = normalizeCriticAgreement(parsed.critic, job.details.deepEvaluation.verdict);
    await recordEvaluation({
      ...evaluationBase,
      id: deterministicWorkerEvaluationId(task.taskKey, "critic"),
      stage: "critic",
      verdict: result.recommendedVerdict,
      score: result.confidence * 100,
      output: result,
    });
    const disagreement = !result.agrees || result.recommendedVerdict !== job.details.deepEvaluation.verdict;
    const hardBlocked = (job.details.deepEvaluation?.decision?.blockers || []).length > 0;
    const calibration = await getCalibrationStatus();
    const strongCandidate = !disagreement && result.recommendedVerdict === "apply";
    updated = await upsertJob({
      ...job,
      status: disagreement ? "needs_review"
        : hardBlocked ? "passed"
        : strongCandidate && calibration.active ? "shortlisted"
          : result.recommendedVerdict === "pass" ? "passed" : "needs_review",
      details: {
        ...job.details,
        critic: result,
        criticStatus: "complete",
        criticPromptVersion: PROMPT_VERSION,
        criticProvider: evaluationBase.provider,
        criticModel: model,
        criticAttempts: [{ provider: evaluationBase.provider, model, status: "live" }],
        modelAgreement: disagreement ? "disagree" : "agree",
        autoShortlist: strongCandidate ? { enabled: calibration.active, calibration } : null,
      },
    });
  } else if (task.taskType === "outreach") {
    updated = await upsertJob({
      ...job,
      details: { ...job.details, outreach: parsed.outreach },
    });
  }

  return upsertJob({
    ...updated,
    details: {
      ...updated.details,
      workerTaskResults: {
        ...(updated.details?.workerTaskResults || {}),
        [task.taskKey]: { resultId, taskType: task.taskType, completedAt: new Date().toISOString() },
      },
    },
  });
}

export function windowsTaskRevision(job, taskType) {
  const revision = `${job.contentHash}:${PROMPT_VERSION}`;
  const deepEvaluationFingerprint = job.details?.deepEvaluation
    ? hash(JSON.stringify(job.details.deepEvaluation))
    : "none";
  return taskType === "critic" && job.details?.deepEvaluation
    ? `${revision}:${EVALUATION_FRAMEWORK_VERSION}:windows-critic-v3:${deepEvaluationFingerprint}`
    : taskType === "outreach" && job.details?.deepEvaluation
      ? `${revision}:${EVALUATION_FRAMEWORK_VERSION}:windows-outreach-v3:${deepEvaluationFingerprint}`
      : taskType === "deep"
        ? `${revision}:${EVALUATION_FRAMEWORK_VERSION}:windows-deep-grounded-v2`
        : `${revision}:windows-${taskType}-v1`;
}

export async function enqueueNextWindowsTask(job) {
  if (!job) return null;
  const taskType = nextLocalTaskType(job);
  if (!taskType) return null;
  return enqueueLocalTask({
    jobId: job.id,
    taskType,
    priority: localTaskPriority(job, taskType),
    revision: windowsTaskRevision(job, taskType),
    payload: { sourceId: job.sourceId },
  });
}

function boundedReleaseLimit(limit, fallback = 20, maximum = 200) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(maximum, Math.floor(parsed)));
}

function queueCounts(tasks = []) {
  const byStatus = {};
  const byTaskType = {};
  tasks.forEach((task) => {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    byTaskType[task.taskType] ||= {};
    byTaskType[task.taskType][task.status] = (byTaskType[task.taskType][task.status] || 0) + 1;
  });
  return { total: tasks.length, byStatus, byTaskType };
}

function simulateHeldQueue(tasks = [], heldIds = new Set()) {
  return tasks.map((task) => (heldIds.has(task.id) && ["queued", "retry", "processing"].includes(task.status))
    ? { ...task, status: "held", leaseUntil: null, leasedBy: "", leaseToken: "" }
    : task);
}

function simulateReleasedQueue(tasks = [], releasedIds = new Set()) {
  return tasks.map((task) => (releasedIds.has(task.id) && task.status === "held")
    ? { ...task, status: "queued", leaseUntil: null, leasedBy: "", leaseToken: "" }
    : task);
}

function buildTaskLookup(tasks = []) {
  const lookup = new Map();
  for (const task of tasks) {
    const key = `${task.jobId}:${task.taskType}`;
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key).push(task);
  }
  for (const values of lookup.values()) {
    values.sort((left, right) => compareQueueTaskCreatedAt(left, right));
  }
  return lookup;
}

export function compareQueueTaskCreatedAt(left, right) {
  const leftTime = new Date(left?.createdAt || 0).getTime();
  const rightTime = new Date(right?.createdAt || 0).getTime();
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}

function pendingTaskFor(lookup, job, taskType) {
  const revision = windowsTaskRevision(job, taskType);
  const taskKey = hash(job.id, taskType, revision);
  return (lookup.get(`${job.id}:${taskType}`) || []).find((task) => (
    task.taskKey === taskKey && ["held", "queued", "retry", "processing"].includes(task.status)
  )) || null;
}

function interleaveBuckets(...buckets) {
  const queues = buckets.map((bucket) => [...bucket]);
  const result = [];
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const queue of queues) {
      if (!queue.length) continue;
      result.push(queue.shift());
      advanced = true;
    }
  }
  return result;
}

function buildBackfillReleasePlan(jobs, tasks, { limit = 20, activeReleaseJobIds = [] } = {}) {
  const lookup = buildTaskLookup(tasks);
  const active = new Set(activeReleaseJobIds);
  const triagePending = [];
  const deepRelevant = [];
  const deepPromoted = [];
  const deepUncertain = [];
  const criticReady = [];
  const outreachReady = [];

  for (const job of jobs) {
    if (!job) continue;
    const taskType = nextLocalTaskType(job);
    if (!taskType) continue;
    const task = pendingTaskFor(lookup, job, taskType);
    if (active.has(job.id) && task && task.status !== "held") continue;
    if (taskType === "triage") {
      triagePending.push({ job, taskType, task });
      continue;
    }
    if (taskType === "deep") {
      const candidate = {
        job,
        taskType,
        task,
      };
      if (job.details?.triage?.relevance === "relevant") deepRelevant.push(candidate);
      else if (clearMismatchPromoted(job)) deepPromoted.push(candidate);
      else deepUncertain.push(candidate);
      continue;
    }
    if (taskType === "critic") {
      criticReady.push({
        job,
        taskType,
        task,
      });
      continue;
    }
    if (taskType === "outreach") {
      outreachReady.push({ job, taskType, task });
    }
  }

  triagePending.sort((left, right) => compareQueueTaskCreatedAt(left.task, right.task));
  deepRelevant.sort((left, right) => compareDeepCandidates(left.job, right.job));
  deepPromoted.sort((left, right) => compareDeepCandidates(left.job, right.job));
  deepUncertain.sort((left, right) => compareDeepCandidates(left.job, right.job));
  criticReady.sort((left, right) => (
    (right.job.details?.deepEvaluation?.overallScore || 0) - (left.job.details?.deepEvaluation?.overallScore || 0)
  ));
  outreachReady.sort((left, right) => (
    (right.job.details?.deepEvaluation?.overallScore || 0) - (left.job.details?.deepEvaluation?.overallScore || 0)
  ));

  const ordered = interleaveBuckets(triagePending, deepRelevant, deepPromoted, deepUncertain, criticReady, outreachReady);
  const selected = ordered.slice(0, limit);
  return {
    counts: {
      totalCandidates: ordered.length,
      triagePending: triagePending.length,
      deepRelevant: deepRelevant.length,
      deepPromoted: deepPromoted.length,
      deepUncertain: deepUncertain.length,
      criticReady: criticReady.length,
      outreachReady: outreachReady.length,
    },
    selected,
  };
}

export async function resumeWindowsQueue({
  operationKey = "",
  dryRun = false,
  reason = "windows_local_processing_active",
} = {}) {
  if (operationKey) {
    const existing = await getControlOperation("queue_resume", operationKey);
    if (existing?.result) return existing.result;
  }

  const queueControlBefore = await getLocalQueueControl();
  const projected = {
    ...queueControlBefore,
    holdNewTasks: false,
    holdReason: reason,
    activeReleaseJobIds: [],
  };
  const queueControlAfter = dryRun ? projected : await setLocalQueueControl(projected);
  const result = {
    ok: true,
    dryRun,
    operationKey: operationKey || null,
    queueControlBefore,
    queueControlAfter,
  };
  if (operationKey) await saveControlOperation("queue_resume", operationKey, { result });
  return result;
}

export async function reconcileHeldWindowsQueue({
  operationKey = "",
  dryRun = false,
  reason = "windows_migration_precalibration",
} = {}) {
  if (operationKey) {
    const existing = await getControlOperation("queue_hold", operationKey);
    if (existing?.result) return existing.result;
  }

  const [queueControlBefore, tasksBefore] = await Promise.all([
    getLocalQueueControl(),
    listLocalTasks({ limit: 10000 }),
  ]);
  const holdableIds = new Set(tasksBefore
    .filter((task) => ["queued", "retry"].includes(task.status)
      || (task.status === "processing" && task.leaseUntil && new Date(task.leaseUntil) <= Date.now()))
    .map((task) => task.id));
  const simulatedAfter = simulateHeldQueue(tasksBefore, holdableIds);

  let queueControlAfter = queueControlBefore;
  let heldTasks = [];
  if (!dryRun) {
    queueControlAfter = await setLocalQueueControl({
      holdNewTasks: true,
      holdReason: reason,
      activeReleaseJobIds: [],
    });
    heldTasks = await holdLocalQueueTasks({
      statuses: ["queued", "retry"],
      includeExpiredProcessing: true,
      reason,
    });
  }

  const result = {
    ok: true,
    dryRun,
    operationKey: operationKey || null,
    holdReason: reason,
    queueControlBefore,
    queueControlAfter: dryRun ? {
      ...queueControlBefore,
      holdNewTasks: true,
      holdReason: reason,
      activeReleaseJobIds: [],
    } : queueControlAfter,
    queueCounts: {
      before: queueCounts(tasksBefore),
      after: queueCounts(dryRun ? simulatedAfter : await listLocalTasks({ limit: 10000 })),
    },
    heldCount: holdableIds.size,
    heldTaskIds: dryRun ? [...holdableIds] : heldTasks.map((task) => task.id),
  };
  if (operationKey) {
    await saveControlOperation("queue_hold", operationKey, { result });
  }
  return result;
}

export async function prepareFreeCloudCalibrationCohort({
  operationKey = "",
  dryRun = false,
  expectedSize = 20,
  reason = "windows_thermal_cloud_calibration",
} = {}) {
  if (operationKey) {
    const existing = await getControlOperation("cloud_calibration_prepare", operationKey);
    if (existing?.result) return existing.result;
  }

  const boundedExpectedSize = Math.max(1, Math.min(50, Number(expectedSize) || 20));
  const [queueControlBefore, tasksBefore] = await Promise.all([
    getLocalQueueControl(),
    listLocalTasks({ limit: 10000 }),
  ]);
  const activeJobIds = [...new Set(queueControlBefore.activeReleaseJobIds)].filter(Boolean);
  const recoverableJobIds = [...new Set(tasksBefore
    .filter((task) => task.status === "held" && task.lastError === `Held: ${reason}`)
    .map((task) => task.jobId)
    .filter(Boolean))];
  const selectedJobIds = activeJobIds.length ? activeJobIds : recoverableJobIds;
  if (selectedJobIds.length !== boundedExpectedSize) {
    const error = new Error(
      `Expected ${boundedExpectedSize} active calibration jobs, but found ${selectedJobIds.length}.`,
    );
    error.statusCode = 409;
    throw error;
  }

  const jobs = await jobsForIds(selectedJobIds);
  if (jobs.length !== selectedJobIds.length) {
    const error = new Error("One or more active calibration jobs no longer exist.");
    error.statusCode = 409;
    throw error;
  }

  const selectedSet = new Set(selectedJobIds);
  const actionableTasks = tasksBefore.filter((task) => (
    selectedSet.has(task.jobId) && ["queued", "retry", "processing"].includes(task.status)
  ));
  const projectedControl = {
    ...queueControlBefore,
    holdNewTasks: true,
    holdReason: reason,
    activeReleaseJobIds: [],
  };

  let queueControlAfter = projectedControl;
  let heldTasks = actionableTasks;
  if (!dryRun) {
    heldTasks = [];
    for (const task of actionableTasks) {
      const held = await setLocalTaskStatus(task.id, {
        status: "held",
        availableAt: new Date().toISOString(),
        clearLease: true,
        lastError: `Held: ${reason}`,
      });
      if (held) heldTasks.push(held);
    }
    queueControlAfter = await setLocalQueueControl(projectedControl);
  }

  const result = {
    ok: true,
    dryRun,
    operationKey: operationKey || null,
    reason,
    recovered: activeJobIds.length === 0,
    expectedSize: boundedExpectedSize,
    selectedJobIds,
    selected: jobs.map((job) => ({
      jobId: job.id,
      sourceId: job.sourceId,
      title: job.title,
      company: job.company,
    })),
    heldTaskIds: heldTasks.map((task) => task.id),
    queueControlBefore,
    queueControlAfter,
  };
  if (operationKey) await saveControlOperation("cloud_calibration_prepare", operationKey, { result });
  return result;
}

export async function releaseHeldWindowsBacklog({
  operationKey = "",
  dryRun = false,
  limit = 20,
} = {}) {
  if (operationKey) {
    const existing = await getControlOperation("queue_release", operationKey);
    if (existing?.result) return existing.result;
  }

  const boundedLimit = boundedReleaseLimit(limit, 20, 200);
  const [queueControlBefore, tasksBefore, jobs] = await Promise.all([
    getLocalQueueControl(),
    listLocalTasks({ limit: 10000 }),
    listJobs({ view: "all", limit: 5000 }),
  ]);
  const plan = buildBackfillReleasePlan(jobs, tasksBefore, {
    limit: boundedLimit,
    activeReleaseJobIds: queueControlBefore.activeReleaseJobIds,
  });

  if (!dryRun && !queueControlBefore.holdNewTasks) {
    const error = new Error("Queue hold must be enabled before releasing a controlled backlog cohort.");
    error.statusCode = 409;
    throw error;
  }

  const selectedJobIds = plan.selected.map((item) => item.job.id);
  const selectedTaskIds = plan.selected.map((item) => item.task?.id).filter(Boolean);
  const simulatedAfter = simulateReleasedQueue(tasksBefore, new Set(selectedTaskIds));
  let queueControlAfter = queueControlBefore;
  let released = [];
  let created = [];

  if (!dryRun) {
    queueControlAfter = await setLocalQueueControl({
      holdNewTasks: true,
      holdReason: queueControlBefore.holdReason || "windows_migration_precalibration",
      activeReleaseJobIds: [...new Set([...queueControlBefore.activeReleaseJobIds, ...selectedJobIds])],
    });
    released = await releaseLocalQueueTasks(selectedTaskIds);
    for (const candidate of plan.selected.filter((item) => !item.task)) {
      const task = await enqueueNextWindowsTask(candidate.job);
      if (task) created.push(task);
    }
  }

  const result = {
    ok: true,
    dryRun,
    operationKey: operationKey || null,
    limit: boundedLimit,
    queueControlBefore,
    queueControlAfter: dryRun ? {
      ...queueControlBefore,
      holdNewTasks: true,
      activeReleaseJobIds: [...new Set([...queueControlBefore.activeReleaseJobIds, ...selectedJobIds])],
    } : queueControlAfter,
    candidateCounts: plan.counts,
    selectedCount: plan.selected.length,
    queueCounts: {
      before: queueCounts(tasksBefore),
      after: queueCounts(dryRun ? simulatedAfter : await listLocalTasks({ limit: 10000 })),
    },
    activated: {
      releasedExistingCount: dryRun ? selectedTaskIds.length : released.length,
      createdCount: dryRun ? plan.selected.filter((item) => !item.task).length : created.length,
    },
    selected: plan.selected.map((item) => ({
      jobId: item.job.id,
      sourceId: item.job.sourceId,
      title: item.job.title,
      company: item.job.company,
      taskType: item.taskType,
      existingTaskId: item.task?.id || null,
      existingTaskStatus: item.task?.status || null,
      triageRelevance: item.job.details?.triage?.relevance || "unknown",
      deepScore: item.job.details?.deepEvaluation?.overallScore ?? null,
    })),
  };
  if (operationKey) {
    await saveControlOperation("queue_release", operationKey, { result });
  }
  return result;
}

export async function retryFailedWindowsTasks({
  operationKey = "",
  dryRun = false,
  limit = 20,
} = {}) {
  if (operationKey) {
    const existing = await getControlOperation("queue_retry_failed", operationKey);
    if (existing?.result) return existing.result;
  }

  const boundedLimit = boundedReleaseLimit(limit, 20, 200);
  const [queueControl, tasks] = await Promise.all([
    getLocalQueueControl(),
    listLocalTasks({ statuses: ["failed"], limit: 10000 }),
  ]);
  const activeJobIds = new Set(queueControl.activeReleaseJobIds);
  const selected = tasks
    .filter((task) => (!queueControl.holdNewTasks || activeJobIds.has(task.jobId))
      && ["triage", "deep", "critic", "outreach"].includes(task.taskType))
    .slice(0, boundedLimit);

  let retried = [];
  if (!dryRun) {
    retried = (await Promise.all(selected.map((task) => setLocalTaskStatus(task.id, {
      status: "queued",
      availableAt: new Date().toISOString(),
      clearLease: true,
      completedAt: null,
    })))).filter(Boolean);
  }

  const result = {
    ok: true,
    dryRun,
    operationKey: operationKey || null,
    selectedCount: selected.length,
    retriedCount: dryRun ? selected.length : retried.length,
    selected: selected.map((task) => ({
      taskId: task.id,
      jobId: task.jobId,
      taskType: task.taskType,
      attempts: task.attempts,
    })),
  };
  if (operationKey) {
    await saveControlOperation("queue_retry_failed", operationKey, { result });
  }
  return result;
}

export async function executeJobSearchRun({ runId, trigger = "manual", slot = "morning", discoveryUrls = [] } = {}) {
  const stats = { discovered: 0, changed: 0, triaged: 0, deepEvaluated: 0, criticised: 0, shortlisted: 0, taxonomyProposals: 0, localQueued: 0 };
  const errors = [];
  let providers = {};
  try {
    await updateRun(runId, { status: "running", phase: "discovery", stats });
    const discovery = await runDiscoveryStage({ runId, trigger, slot, discoveryUrls });
    providers = discovery.providers;
    stats.discovered = discovery.discoveredCount;
    stats.changed = discovery.changedCount;

    if (process.env.JOBSEARCH_LOCAL_WORKER_ENABLED === "true") {
      const local = await enqueueJobsForLocalProcessing({ runId, jobIds: discovery.jobIds });
      stats.localQueued = local.queuedCount;
      return updateRun(runId, {
        status: "completed", phase: "queued_local", stats,
        providers: { ...providers, local: { status: "queued", queued: local.queuedCount } },
        errors,
      });
    }

    await updateRun(runId, { status: "running", phase: "triage", stats, providers });
    const triage = await runTriageStage({ runId, jobIds: discovery.jobIds });
    stats.triaged = triage.triagedCount;

    await updateRun(runId, { status: "running", phase: "deep_evaluation", stats, providers });
    const deep = await runDeepStage({ runId, jobIds: triage.jobIds });
    stats.deepEvaluated = deep.evaluatedCount;

    await updateRun(runId, { status: "running", phase: "criticism", stats, providers });
    const reviewed = await runCriticStage({ runId, jobIds: deep.jobIds });
    stats.criticised = reviewed.reviewedCount;
    await runOutreachStage({ runId, jobIds: reviewed.shortlistIds });
    stats.shortlisted = reviewed.shortlistIds.length;

    if (slot === "evening") {
      await updateRun(runId, { status: "running", phase: "taxonomy", stats, providers });
      stats.taxonomyProposals = (await runTaxonomyStage({ runId, slot })).proposalCount;
    }

    const config = providerConfiguration();
    const requiredMissing = ["serpapi", "brave", "tavily"].filter((key) => !config[key]);
    if (!["groq", "cloudflare", "openrouter", "zai"].some((key) => config[key])) requiredMissing.push("model_router");
    const modelBlocked = deep.blockedCount + reviewed.blockedCount;
    const status = requiredMissing.length || modelBlocked ? "partial" : "completed";
    if (requiredMissing.length) errors.push({ stage: "configuration", message: `Missing providers: ${requiredMissing.join(", ")}` });
    if (modelBlocked) errors.push({ stage: "models", message: `${modelBlocked} model evaluations exhausted configured free routes or quotas.` });
    return updateRun(runId, { status, phase: "complete", stats, providers, errors });
  } catch (error) {
    errors.push({ stage: "pipeline", message: error.message || "Pipeline failed." });
    await updateRun(runId, { status: "failed", phase: "failed", stats, providers, errors });
    throw error;
  }
}
