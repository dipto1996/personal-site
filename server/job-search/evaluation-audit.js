import { createHash } from "node:crypto";

import { EVALUATION_FRAMEWORK_VERSION, classifyVacancyIntegrity } from "./evaluation-framework.js";

const GATE_DIMENSIONS = Object.freeze({
  expertiseFit: "expertiseFit",
  workAuthorization: "workAuthorization",
  compensation: "compensation",
  codingInterview: "codingInterviewSafety",
});

const PROHIBITED_FIT_RATIONALES = [
  {
    code: "industry_used_as_fit_penalty",
    pattern: /(?:public[ -]sector|outside financial services|different industry)[^.]{0,180}(?:not (?:aligned|relevant)|does not match|poor fit)|(?:not (?:aligned|relevant)|does not match|poor fit)[^.]{0,180}(?:public[ -]sector|outside financial services|different industry)/i,
  },
  {
    code: "ai_used_as_fit_penalty",
    pattern: /(?:lack|absence|not|does not)[^.]{0,80}\bAI\b[^.]{0,140}(?:not (?:aligned|relevant)|does not match|poor fit)|(?:not (?:aligned|relevant)|does not match|poor fit)[^.]{0,140}(?:lack|absence|not|does not)[^.]{0,80}\bAI\b/i,
  },
  {
    code: "remote_used_as_fit_penalty",
    pattern: /remote[- ]from[- ]india|(?:lack|no|without)[^.]{0,80}remote[^.]{0,120}(?:not (?:aligned|relevant)|does not match|poor fit)/i,
  },
];

function addFinding(findings, code, message, severity = "error") {
  findings.push({ code, severity, message });
}

function isGrounded(claim) {
  if (!claim || !["explicit", "inferred"].includes(claim.evidenceType)) return true;
  return Boolean(String(claim.sourceUrl || "").trim() && String(claim.supportingPassage || "").trim());
}

function evaluationText(deep) {
  return [
    deep?.summary,
    ...Object.values(deep?.dimensions || {}).map((dimension) => dimension?.reasoning),
    ...Object.values(deep?.mustHave || {}).map((gate) => gate?.reasoning),
  ].filter(Boolean).join(" ");
}

export function auditJobEvaluation(job, { promptVersion } = {}) {
  const findings = [];
  const details = job?.details || {};
  const deep = details.deepEvaluation || null;
  const critic = details.critic || null;

  if (promptVersion && details.triagePromptVersion !== promptVersion) {
    addFinding(findings, "stale_triage_prompt", "Triage was not completed with the current prompt version.");
  }
  if (details.triageStatus !== "complete" || !details.triage) {
    addFinding(findings, "triage_incomplete", "Current triage output is missing.");
  }
  if (details.deepStatus !== "complete" || !deep) {
    addFinding(findings, "deep_incomplete", "Current deep evaluation is missing.");
    return findings;
  }
  if (promptVersion && details.deepPromptVersion !== promptVersion) {
    addFinding(findings, "stale_deep_prompt", "Deep evaluation was not completed with the current prompt version.");
  }
  if (details.evaluationFrameworkVersion !== EVALUATION_FRAMEWORK_VERSION
      || deep.decision?.frameworkVersion !== EVALUATION_FRAMEWORK_VERSION) {
    addFinding(findings, "stale_evaluation_framework", "Deep evaluation was not finalized with the current deterministic framework.");
  }

  const gates = deep.mustHave || {};
  const vacancy = classifyVacancyIntegrity(job);
  if (vacancy.status === "blocked" && deep.decision?.inputValidation?.status !== "blocked") {
    addFinding(findings, "non_vacancy_scored_as_job", vacancy.reason);
  }
  const blockers = Object.entries(gates).filter(([, gate]) => gate?.status === "blocked").map(([key]) => key);
  const unknowns = Object.entries(gates).filter(([, gate]) => gate?.status === "unknown").map(([key]) => key);
  const expectedVerdict = blockers.length ? "pass" : unknowns.length ? "maybe" : Number(deep.overallScore) >= 65 ? "apply" : "maybe";
  if (deep.verdict !== expectedVerdict) {
    addFinding(findings, "verdict_gate_contradiction", `Final verdict ${deep.verdict || "missing"} conflicts with deterministic gate result ${expectedVerdict}.`);
  }
  if (JSON.stringify([...(deep.decision?.blockers || [])].sort()) !== JSON.stringify([...blockers].sort())) {
    addFinding(findings, "blocker_ledger_mismatch", "Decision blocker keys do not match must-have gate statuses.");
  }
  if (JSON.stringify([...(deep.decision?.unknowns || [])].sort()) !== JSON.stringify([...unknowns].sort())) {
    addFinding(findings, "unknown_ledger_mismatch", "Decision unknown keys do not match must-have gate statuses.");
  }

  for (const [gateName, dimensionName] of Object.entries(GATE_DIMENSIONS)) {
    const gate = gates[gateName];
    const dimension = deep.dimensions?.[dimensionName];
    if (!gate) {
      addFinding(findings, "missing_gate", `Must-have gate ${gateName} is missing.`);
      continue;
    }
    if (["met", "blocked"].includes(gate.status) && !String(gate.sourceUrl || "").trim()) {
      addFinding(findings, "ungrounded_gate", `${gateName} is ${gate.status} without a source URL.`);
    }
    if (gate.status === "unknown" && dimension?.evidenceStatus === "unknown" && dimension?.score !== null) {
      addFinding(findings, "unknown_scored_as_fact", `${dimensionName} has a numeric score despite unknown evidence.`);
    }
    if (["workAuthorization", "compensation"].includes(gateName) && gate.status === "unknown" && dimension?.score !== null) {
      addFinding(findings, "unknown_gate_has_numeric_score", `${dimensionName} has a numeric score even though its must-have gate is unknown.`);
    }
    if (gate.status === "blocked" && dimension && dimension.score !== 0 && gateName !== "expertiseFit") {
      addFinding(findings, "blocked_gate_score_mismatch", `${dimensionName} is blocked but does not have score 0.`);
    }
  }

  Object.entries(deep.dimensions || {}).forEach(([name, dimension]) => {
    if (dimension?.evidenceStatus === "unknown" && dimension?.score !== null) {
      addFinding(findings, "unknown_dimension_scored", `${name} has a numeric score despite unknown evidence.`);
    }
  });

  (details.claims || []).forEach((claim, index) => {
    if (!isGrounded(claim)) {
      addFinding(findings, "ungrounded_claim", `Claim ${index + 1} (${claim?.claimType || "unknown"}) lacks a source URL or supporting passage.`);
    }
  });

  const rationaleText = evaluationText(deep);
  PROHIBITED_FIT_RATIONALES.forEach(({ code, pattern }) => {
    if (pattern.test(rationaleText)) addFinding(findings, code, "A bonus or context attribute was incorrectly used to reduce core expertise fit.");
  });

  if (details.criticStatus !== "complete" || !critic) {
    addFinding(findings, "critic_incomplete", "Independent critic evaluation is missing.");
  } else {
    if (promptVersion && details.criticPromptVersion !== promptVersion) {
      addFinding(findings, "stale_critic_prompt", "Critic evaluation was not completed with the current prompt version.");
    }
    const criticAgrees = critic.recommendedVerdict === deep.verdict;
    if (critic.agrees !== criticAgrees) {
      addFinding(findings, "critic_agreement_contradiction", "Critic agrees flag conflicts with its recommended verdict.");
    }
    if (!criticAgrees && !job.disposition && job.status !== "needs_review") {
      addFinding(findings, "critic_disagreement_not_review", "Evaluator and critic disagree, but the job is not in needs review.");
    }
    if (criticAgrees && critic.recommendedVerdict === "pass" && blockers.length === 0) {
      addFinding(findings, "unsupported_agreed_pass", "Evaluator and critic agree on pass without a finalized must-have blocker.");
    }
    const deterministicBlockers = Object.entries(gates)
      .filter(([, gate]) => gate?.status === "blocked" && gate?.basis === "deterministic")
      .map(([key]) => key);
    if (deterministicBlockers.length && critic.recommendedVerdict !== "pass") {
      addFinding(findings, "critic_overrode_deterministic_blocker", `Critic recommendation ignored verified blocker(s): ${deterministicBlockers.join(", ")}.`);
    }
  }

  return findings;
}

function duplicateSignature(job) {
  const tokens = String(job?.description || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 220);
  if (tokens.length < 80) return "";
  return createHash("sha256").update(tokens.join(" ")).digest("hex");
}

function addDuplicateConsistencyFindings(audited) {
  const groups = new Map();
  for (const item of audited) {
    const signature = duplicateSignature(item.job);
    if (!signature) continue;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(item);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const expertiseStatuses = new Set(group.map(({ job }) => job.details?.deepEvaluation?.mustHave?.expertiseFit?.status || "missing"));
    const verdicts = new Set(group.map(({ job }) => job.details?.deepEvaluation?.verdict || "missing"));
    const expertiseScores = group.map(({ job }) => Number(job.details?.deepEvaluation?.dimensions?.expertiseFit?.score)).filter(Number.isFinite);
    const scoreSpread = expertiseScores.length ? Math.max(...expertiseScores) - Math.min(...expertiseScores) : 0;
    if (expertiseStatuses.size === 1 && verdicts.size === 1 && scoreSpread < 0.75) continue;
    for (const item of group) {
      addFinding(item.findings, "duplicate_evaluation_inconsistency", "Near-identical postings received materially different expertise gates, scores, or verdicts.");
    }
  }
}

function sampleRank(seed, jobId) {
  return createHash("sha256").update(`${seed}|${jobId}`).digest("hex");
}

export function buildEvaluationAudit(jobs, { sampleSize = 20, seed = new Date().toISOString().slice(0, 10), promptVersion } = {}) {
  const candidates = jobs.filter((job) => job?.sourceProvider !== "sample");
  const audited = candidates.map((job) => ({ job, findings: auditJobEvaluation(job, { promptVersion }) }));
  addDuplicateConsistencyFindings(audited);
  const completed = audited.filter(({ job }) => (
    job.details?.deepStatus === "complete"
      && job.details?.evaluationFrameworkVersion === EVALUATION_FRAMEWORK_VERSION
      && job.details?.criticStatus === "complete"
      && (!promptVersion || (
        job.details?.triagePromptVersion === promptVersion
        && job.details?.deepPromptVersion === promptVersion
        && job.details?.criticPromptVersion === promptVersion
      ))
  ));
  const boundedSize = Math.max(1, Math.min(100, Number(sampleSize) || 20));
  const sample = completed
    .sort((left, right) => sampleRank(seed, left.job.id).localeCompare(sampleRank(seed, right.job.id)))
    .slice(0, boundedSize)
    .map(({ job, findings }) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.canonicalUrl,
      description: String(job.description || "").slice(0, 6000),
      roleFamilyId: job.roleFamilyId,
      status: job.status,
      disposition: job.disposition || null,
      triage: job.details?.triage || null,
      deepEvaluation: job.details?.deepEvaluation || null,
      claims: job.details?.claims || [],
      critic: job.details?.critic || null,
      findings,
    }));
  const findings = audited.flatMap(({ job, findings: jobFindings }) => (
    jobFindings.map((finding) => ({ jobId: job.id, title: job.title, company: job.company, ...finding }))
  ));
  const byCode = {};
  findings.forEach((finding) => { byCode[finding.code] = (byCode[finding.code] || 0) + 1; });
  return {
    generatedAt: new Date().toISOString(),
    seed,
    requestedSampleSize: boundedSize,
    population: {
      candidates: candidates.length,
      currentDeepAndCritic: completed.length,
      incompleteOrStale: candidates.length - completed.length,
      automatedAnomalies: findings.length,
      jobsWithAutomatedAnomalies: new Set(findings.map((finding) => finding.jobId)).size,
      anomaliesByCode: byCode,
    },
    sample,
  };
}
