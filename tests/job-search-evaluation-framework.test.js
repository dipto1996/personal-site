import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATION_WEIGHTS,
  classifyCodingInterviewRisk,
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
  assert.equal(result.dimensions.codingInterviewSafety.score, 4);
  assert.equal(result.mustHave.codingInterview.riskLevel, "low");
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
  assert.equal(result.dimensions.codingInterviewSafety.score, 4);
  assert.equal(result.mustHave.codingInterview.riskLevel, "low");
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
    compensationType: "base_or_salary",
  });
});

test("hourly compensation is annualized once without treating hourly rates as thousands", () => {
  assert.deepEqual(parseAnnualCompensation("$20-$30 per hour"), {
    minimum: 41600,
    maximum: 62400,
    text: "$20-$30 per hour",
    hourly: true,
    compensationType: "base_or_salary",
  });
  assert.deepEqual(parseAnnualCompensation("$75/hour"), {
    minimum: 156000,
    maximum: 156000,
    text: "$75/hour",
    hourly: true,
    compensationType: "base_or_salary",
  });
});

test("hourly compensation below the annual minimum is a blocker", () => {
  const result = finalizeDeepEvaluation({
    title: "Manager of Data Science and Analytics",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "Lead data science and analytics. The position pays $20-$30 per hour.",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  }, modelEvaluation({ expertiseFit: dimension(4, "Strong data-science management match.") }));

  assert.equal(result.mustHave.compensation.status, "blocked");
  assert.match(result.mustHave.compensation.reasoning, /\$62,400/);
  assert.equal(result.verdict, "pass");
});

test("annual compensation parser does not mistake years of experience for salary", () => {
  assert.equal(parseAnnualCompensation("Salary commensurate with 10-15 years of relevant experience"), null);
  assert.deepEqual(
    parseAnnualCompensation("Base salary range: 170-210k")?.minimum,
    170000,
  );
});

test("total-compensation-only evidence cannot satisfy the annual-base gate", () => {
  const result = finalizeDeepEvaluation({
    title: "Director of Analytics",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "Lead analytics. Total compensation is $220,000-$260,000 including bonus and equity.",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  }, modelEvaluation({ expertiseFit: dimension(4, "Strong analytics leadership match.") }));
  assert.equal(result.mustHave.compensation.status, "unknown");
  assert.equal(result.dimensions.compensation.score, null);
});

test("unrelated search snippets cannot block sponsorship or establish compensation", () => {
  const result = finalizeDeepEvaluation({
    title: "Director of Product Analytics",
    company: "Example Analytics",
    canonicalUrl: "https://example.com/job",
    description: "Lead product analytics and experimentation.",
    details: {
      sourceEvidence: [],
      claims: [],
      research: { results: [{
        title: "Other Company Product Analytics Manager",
        description: "Other Company does not sponsor visas. Base salary is $90,000-$110,000.",
        url: "https://example.org/other-company-role",
      }] },
    },
  }, modelEvaluation({ expertiseFit: dimension(4.5, "Strong product analytics match.") }));
  assert.equal(result.mustHave.workAuthorization.status, "unknown");
  assert.equal(result.mustHave.compensation.status, "unknown");
  assert.equal(result.verdict, "maybe");
});

test("explicit F-1 OPT incompatibility blocks work authorization", () => {
  const result = finalizeDeepEvaluation({
    title: "Analytics Manager",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "Lead customer analytics. We cannot accept candidates working on F-1 OPT or STEM OPT.",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  }, modelEvaluation({ expertiseFit: dimension(4, "Strong customer analytics match.") }));
  assert.equal(result.mustHave.workAuthorization.status, "blocked");
  assert.equal(result.verdict, "pass");
});

test("title routing alone cannot mark expertise as met", () => {
  const result = finalizeDeepEvaluation({
    title: "Director of Product Analytics",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  }, modelEvaluation({ expertiseFit: dimension(null, "Responsibilities were not supplied.") }));
  assert.equal(result.mustHave.expertiseFit.status, "unknown");
  assert.equal(result.verdict, "maybe");
});

test("partial expertise fit stays under review until responsibilities reach substantive fit", () => {
  const job = {
    title: "Director of Product Analytics",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "Own a partially adjacent analytics program.",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  };
  const partial = finalizeDeepEvaluation(job, modelEvaluation({
    expertiseFit: dimension(2.5, "Partial but credible transferable fit."),
  }));
  const substantive = finalizeDeepEvaluation(job, modelEvaluation({
    expertiseFit: dimension(3, "Substantive transferable analytics fit."),
  }));

  assert.equal(partial.mustHave.expertiseFit.status, "unknown");
  assert.equal(partial.verdict, "maybe");
  assert.equal(substantive.mustHave.expertiseFit.status, "met");
});

test("unknown evidence status always produces a null score", () => {
  const result = finalizeDeepEvaluation({
    title: "Director of Product Analytics",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "Lead product analytics and experimentation.",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  }, modelEvaluation({
    expertiseFit: dimension(4, "Strong match."),
    interviewVelocity: dimension(0, "No process evidence.", "unknown"),
  }));
  assert.equal(result.dimensions.interviewVelocity.score, null);
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

test("coding-bound scientist IC roles are inferred blockers when interview stages are omitted", () => {
  for (const title of ["Senior Data Scientist", "Principal Applied Scientist", "Staff Research Scientist"]) {
    const risk = classifyCodingInterviewRisk({
      title,
      company: "Example",
      canonicalUrl: "https://example.com/job",
      description: "Build statistical models and partner with product leaders.",
      details: { sourceEvidence: [], claims: [], research: { results: [] } },
    });
    assert.equal(risk.status, "blocked", title);
    assert.equal(risk.evidenceStatus, "inferred", title);
    assert.equal(risk.riskLevel, "near_certain", title);
  }
});

test("product science and data-science management are elevated review risks, not automatic blockers", () => {
  for (const title of ["Product Scientist", "Decision Scientist", "Senior Manager, Data Science"]) {
    const risk = classifyCodingInterviewRisk({
      title,
      company: "Example",
      canonicalUrl: "https://example.com/job",
      description: "Lead experimentation, measurement, and cross-functional decisions.",
      details: { sourceEvidence: [], claims: [], research: { results: [] } },
    });
    assert.equal(risk.status, "unknown", title);
    assert.equal(risk.riskLevel, "elevated", title);
    assert.equal(risk.suggestedScore, 2, title);
  }
});

test("analytics and product leadership are low inferred coding risks but remain unverified", () => {
  for (const title of ["Senior Analytics Manager", "Strategy and Analytics Lead", "AI Product Manager"]) {
    const risk = classifyCodingInterviewRisk({
      title,
      company: "Example",
      canonicalUrl: "https://example.com/job",
      description: "Lead analytics, experimentation, and executive decision support.",
      details: { sourceEvidence: [], claims: [], research: { results: [] } },
    });
    assert.equal(risk.status, "unknown", title);
    assert.equal(risk.riskLevel, "low", title);
    assert.equal(risk.suggestedScore, 4, title);
  }
});

test("role-specific no-coding evidence overrides an otherwise coding-bound title archetype", () => {
  const risk = classifyCodingInterviewRisk({
    title: "Senior Data Scientist",
    company: "Example",
    canonicalUrl: "https://example.com/job",
    description: "The interview process has no live coding and no coding assessment.",
    details: { sourceEvidence: [], claims: [], research: { results: [] } },
  });
  assert.equal(risk.status, "met");
  assert.equal(risk.evidenceStatus, "explicit");
  assert.equal(risk.riskLevel, "low");
});

test("role-specific web evidence can confirm a technical assessment", () => {
  const risk = classifyCodingInterviewRisk({
    title: "Product Analytics Manager",
    company: "Example Labs",
    canonicalUrl: "https://example.com/job",
    description: "Lead product analytics and experimentation.",
    details: {
      sourceEvidence: [], claims: [], research: { results: [{
        title: "Example Labs Product Analytics Manager interview",
        description: "Candidates complete a SQL assessment before the final interview.",
        url: "https://interviews.example.org/example-labs-product-analytics-manager",
      }] },
    },
  });
  assert.equal(risk.status, "blocked");
  assert.equal(risk.riskLevel, "confirmed");
  assert.equal(risk.sourceUrl, "https://interviews.example.org/example-labs-product-analytics-manager");
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
