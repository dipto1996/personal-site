import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATION_WEIGHTS,
  finalizeDeepEvaluation,
  parseAnnualCompensation,
} from "../server/job-search/evaluation-framework.js";

function dimension(score, reasoning, evidenceStatus = score === null ? "unknown" : "inferred") {
  return { score, reasoning, evidenceStatus, confidence: score === null ? 0 : 0.8 };
}

function modelEvaluation(overrides = {}) {
  return {
    verdict: "maybe",
    overallScore: 50,
    summary: "Model draft.",
    mustHave: {},
    dimensions: {
      expertiseFit: dimension(3.5, "Responsibilities match analytics, performance management, and decision support."),
      workAuthorization: dimension(null, "Unknown."),
      compensation: dimension(null, "Unknown."),
      codingInterviewSafety: dimension(null, "Unknown."),
      leadershipScope: dimension(3.5, "The role owns analytics and organizational performance."),
      companyQuality: dimension(2.5, "Public-sector employer."),
      interviewVelocity: dimension(null, "Interview timing is not listed."),
      aiMlProductAdjacency: dimension(1, "Limited AI adjacency."),
      financialServicesAdvantage: dimension(0, "No financial-services overlap."),
      remoteFlexibility: dimension(0, "On-site role."),
      ...overrides,
    },
    greenFlags: [],
    redFlags: [],
    unknowns: [],
    claims: [],
  };
}

test("evaluation weights keep expertise and eligibility ahead of optional bonuses", () => {
  assert.equal(Object.values(EVALUATION_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(EVALUATION_WEIGHTS.expertiseFit, 35);
  assert.equal(EVALUATION_WEIGHTS.workAuthorization, 20);
  assert.equal(EVALUATION_WEIGHTS.compensation, 15);
  assert.equal(EVALUATION_WEIGHTS.codingInterviewSafety, 10);
  assert.ok(EVALUATION_WEIGHTS.remoteFlexibility < EVALUATION_WEIGHTS.leadershipScope);
  assert.ok(EVALUATION_WEIGHTS.aiMlProductAdjacency < EVALUATION_WEIGHTS.codingInterviewSafety);
});

test("public-sector analytics remains a credible fit but explicit salary and sponsorship blockers force pass", () => {
  const job = {
    title: "Strategic Performance and Analytics Manager",
    company: "San Bernardino County",
    canonicalUrl: "https://example.com/job",
    description: "Lead performance management, analytics, and organizational improvement. San Bernardino County is not able to consider candidates who will require visa sponsorship at the time of application or in the future.",
    details: {
      sourceMetadata: { compensation: "$89,502.40-$123,073.60 a year" },
      sourceEvidence: [],
      claims: [],
      research: { results: [] },
    },
  };
  const result = finalizeDeepEvaluation(job, modelEvaluation());

  assert.equal(result.verdict, "pass");
  assert.equal(result.dimensions.expertiseFit.score, 3.5);
  assert.equal(result.dimensions.leadershipScope.score, 3.5);
  assert.equal(result.mustHave.expertiseFit.status, "met");
  assert.equal(result.mustHave.workAuthorization.status, "blocked");
  assert.equal(result.mustHave.compensation.status, "blocked");
  assert.equal(result.mustHave.codingInterview.status, "unknown");
  assert.equal(result.dimensions.codingInterviewSafety.score, null);
  assert.match(result.summary, /^Pass: The role has a substantive match/);
});

test("missing salary, sponsorship, and interview evidence stays unknown and routes to review", () => {
  const result = finalizeDeepEvaluation({
    title: "Director of Product Analytics",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "Lead experimentation, product analytics, and customer behavior measurement.",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  }, modelEvaluation({
    expertiseFit: dimension(4.5, "Strong product analytics and experimentation match."),
  }));

  assert.equal(result.verdict, "maybe");
  assert.deepEqual(result.decision.blockers, []);
  assert.deepEqual(result.decision.unknowns.sort(), ["codingInterview", "compensation", "workAuthorization"]);
  assert.equal(result.dimensions.compensation.score, null);
  assert.equal(result.dimensions.workAuthorization.score, null);
  assert.equal(result.dimensions.codingInterviewSafety.score, null);
});

test("a compensation range spanning the minimum stays under review", () => {
  const result = finalizeDeepEvaluation({
    title: "Director of Product Analytics",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "Lead product analytics and experimentation.",
    details: {
      sourceMetadata: { compensation: "$140,000-$205,000 a year" },
      sourceEvidence: [],
      claims: [],
      research: { results: [] },
    },
  }, modelEvaluation({
    expertiseFit: dimension(4.5, "Strong product analytics and experimentation match."),
  }));

  assert.equal(result.mustHave.compensation.status, "unknown");
  assert.equal(result.verdict, "maybe");
  assert.match(result.mustHave.compensation.reasoning, /spans the \$170,000 threshold/i);
});

test("annual compensation parser handles decimal salary ranges without treating them as hourly", () => {
  assert.deepEqual(parseAnnualCompensation("$89,502.40-$123,073.60 a year"), {
    minimum: 89502,
    maximum: 123074,
    text: "$89,502.40-$123,073.60 a year",
    hourly: false,
  });
});

test("data-engineering management remains reviewable while data-engineering IC is coding-blocked", () => {
  const base = {
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "Lead the data engineering organization and partner with analytics leaders.",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  };
  const manager = finalizeDeepEvaluation({ ...base, title: "Senior Manager, Data Engineering" }, modelEvaluation({
    expertiseFit: dimension(3, "Adjacent analytics-platform leadership role."),
  }));
  const engineer = finalizeDeepEvaluation({ ...base, title: "Senior Data Engineer" }, modelEvaluation({
    expertiseFit: dimension(2, "Primary function is engineering implementation."),
  }));

  assert.equal(manager.mustHave.codingInterview.status, "unknown");
  assert.equal(manager.verdict, "maybe");
  assert.equal(engineer.mustHave.expertiseFit.status, "blocked");
  assert.equal(engineer.mustHave.codingInterview.status, "blocked");
  assert.equal(engineer.verdict, "pass");
});

test("employer-level eligibility requires exact-company official E-Verify and sponsorship evidence", () => {
  const job = {
    title: "Director of Product Analytics",
    company: "Example Analytics",
    canonicalUrl: "https://example.com/job",
    description: "Lead product analytics and experimentation.",
    details: {
      sourceEvidence: [], claims: [], research: { results: [{
        title: "E-Verify employers",
        description: "Other Company participates in E-Verify and has certified LCA filings.",
        url: "https://www.e-verify.gov/employers/employer-search",
      }] },
      employerEligibilityEvidence: [
        { company: "Example Analytics", value: "E-Verify participant", sourceUrl: "https://www.e-verify.gov/employers/employer-search" },
        { company: "Example Analytics", value: "Certified LCA disclosure history", sourceUrl: "https://www.dol.gov/agencies/eta/foreign-labor/performance" },
      ],
    },
  };
  const result = finalizeDeepEvaluation(job, modelEvaluation({ expertiseFit: dimension(4, "Strong match.") }));
  assert.equal(result.mustHave.workAuthorization.status, "met");
  assert.equal(result.mustHave.workAuthorization.evidenceStatus, "inferred");

  const genericOnly = finalizeDeepEvaluation({ ...job, details: { ...job.details, employerEligibilityEvidence: [] } }, modelEvaluation());
  assert.equal(genericOnly.mustHave.workAuthorization.status, "unknown");
});
