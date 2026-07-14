import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "job-search-intelligence-"));
process.env.TRADEGRAPH_DATA_DIR = tempDir;
process.env.JOBSEARCH_OWNER_EMAILS = "owner@example.com";
for (const key of [
  "DATABASE_URL", "SERPAPI_API_KEY", "BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY",
  "ZAI_API_KEY", "MOONSHOT_API_KEY", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY",
  "JOBSEARCH_GREENHOUSE_BOARDS", "JOBSEARCH_LEVER_COMPANIES", "JOBSEARCH_ASHBY_COMPANIES",
  "JOBSEARCH_WORKDAY_SOURCES", "JOBSEARCH_SMARTRECRUITERS_COMPANIES",
]) delete process.env[key];

const persistence = await import("../server/persistence.js");
const auth = await import("../server/auth.js");
const workspaces = await import("../server/workspaces.js");
const jobSearch = await import("../server/job-search.js");
const discovery = await import("../server/job-search/discovery.js");
const ats = await import("../server/job-search/ats.js");
const taxonomy = await import("../server/job-search/taxonomy.js");
const repository = await import("../server/job-search/repository.js");
const providers = await import("../server/job-search/providers.js");
const schemas = await import("../server/job-search/schemas.js");
const cardFacts = await import("../server/job-search/card-facts.js");
const workflow = await import("../server/job-search/workflow.js");
const evaluationFramework = await import("../server/job-search/evaluation-framework.js");
const evaluationAudit = await import("../server/job-search/evaluation-audit.js");
const workerContract = await import("../server/job-search/worker-contract.js");
const targetProfile = await import("../server/job-search/profile.js");
const resourceGuard = await import("../scripts/job-search-windows-resource-guard.mjs");
const windowsCollector = await import("../server/job-search/windows-collector.js");
const windowsWorkerRuntime = await import("../server/job-search/windows-worker-runtime.js");

test.beforeEach(async () => {
  await rm(path.join(tempDir, "job-search-intelligence.json"), { force: true });
  await persistence.updateDb((draft) => {
    draft.users = [];
    draft.sessions = [];
    draft.workspaces = [];
    draft.workspaceMemberships = [];
    draft.workspaceInvites = [];
    return draft;
  });
});

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function sessionContextFor(user) {
  const [workspace] = await workspaces.listWorkspaces(user.id);
  const session = await auth.createSession(user.id, workspace.id);
  return auth.getSessionContext({ headers: { cookie: session.cookie.split(";")[0] } });
}

async function seedJob(overrides = {}) {
  return repository.upsertJob({
    sourceId: overrides.sourceId || `test_${Math.random()}`,
    canonicalUrl: overrides.canonicalUrl || "https://example.com/jobs/1",
    title: overrides.title || "AI Product Manager",
    normalizedTitle: taxonomy.normalizeTitle(overrides.title || "AI Product Manager"),
    company: overrides.company || "Example",
    location: overrides.location || "New York, NY",
    description: overrides.description || "Lead AI product strategy, experimentation, and cross-functional execution.",
    postedAt: null,
    sourceProvider: overrides.sourceProvider || "test",
    sourceQuery: "fixture",
    contentHash: overrides.contentHash || `hash_${Math.random()}`,
    roleFamilyId: overrides.roleFamilyId || "ai_product_platform",
    status: overrides.status || "deep_review_pending",
    disposition: overrides.disposition,
    details: overrides.details || {},
  });
}

function auditReadyJob(overrides = {}) {
  const job = {
    id: "audit-job-1",
    sourceId: "audit-source-1",
    canonicalUrl: "https://example.com/jobs/analytics-manager",
    title: "Senior Analytics Manager",
    normalizedTitle: "senior analytics manager",
    company: "Example",
    location: "New York, NY",
    description: "Lead product analytics, experimentation, and customer measurement. Interview and salary details are not provided.",
    sourceProvider: "test",
    roleFamilyId: "analytics_leadership",
    status: "needs_review",
    disposition: null,
    details: {},
    ...overrides,
  };
  const modelEvaluation = {
    verdict: "maybe",
    overallScore: 70,
    summary: "Strong analytics leadership fit; eligibility details require review.",
    dimensions: Object.fromEntries(Object.keys(evaluationFramework.EVALUATION_WEIGHTS).map((key) => [key, {
      score: key === "expertiseFit" ? 4 : null,
      evidenceStatus: key === "expertiseFit" ? "inferred" : "unknown",
      confidence: key === "expertiseFit" ? 0.85 : 0,
      reasoning: key === "expertiseFit" ? "Responsibilities directly use analytics leadership and experimentation experience." : "Evidence not established.",
    }])),
    mustHave: {
      expertiseFit: { status: "met", evidenceStatus: "inferred", reasoning: "Strong responsibility fit.", sourceUrl: job.canonicalUrl },
      workAuthorization: { status: "unknown", evidenceStatus: "unknown", reasoning: "Not verified.", sourceUrl: "" },
      compensation: { status: "unknown", evidenceStatus: "unknown", reasoning: "Not verified.", sourceUrl: "" },
      codingInterview: { status: "unknown", evidenceStatus: "unknown", reasoning: "Not verified.", sourceUrl: "" },
    },
    claims: [], redFlags: [], greenFlags: [], unknowns: [], outreachAngle: "",
  };
  const deepEvaluation = evaluationFramework.finalizeDeepEvaluation(job, modelEvaluation);
  job.details = {
    triageStatus: "complete",
    triagePromptVersion: workflow.PROMPT_VERSION,
    triage: { relevance: "relevant", confidence: 0.9 },
    deepStatus: "complete",
    evaluationFrameworkVersion: evaluationFramework.EVALUATION_FRAMEWORK_VERSION,
    deepEvaluation,
    claims: [],
    criticStatus: "complete",
    critic: {
      agrees: true,
      recommendedVerdict: deepEvaluation.verdict,
      confidence: 0.85,
      objections: [],
      unsupportedClaims: [],
      summary: "The evidence and provisional verdict are coherent.",
    },
    modelAgreement: "agree",
  };
  return job;
}

test("evaluation audit accepts a coherent current evaluator-and-critic result", () => {
  const job = auditReadyJob();
  assert.deepEqual(evaluationAudit.auditJobEvaluation(job, { promptVersion: workflow.PROMPT_VERSION }), []);
  const audit = evaluationAudit.buildEvaluationAudit([job], {
    sampleSize: 20,
    seed: "stable-audit-seed",
    promptVersion: workflow.PROMPT_VERSION,
  });
  assert.equal(audit.population.currentDeepAndCritic, 1);
  assert.equal(audit.population.automatedAnomalies, 0);
  assert.equal(audit.sample.length, 1);
  assert.equal(audit.sample[0].id, job.id);
});

test("evaluation audit detects stale, contradictory, ungrounded, and biased output", () => {
  const job = auditReadyJob();
  job.status = "passed";
  job.details.triagePromptVersion = "old-prompt";
  job.details.deepEvaluation.verdict = "pass";
  job.details.deepEvaluation.summary = "This public-sector role does not match because it is outside financial services and lacks remote-from-India flexibility.";
  job.details.deepEvaluation.dimensions.compensation = {
    score: 0,
    evidenceStatus: "unknown",
    confidence: 0,
    reasoning: "Compensation is missing.",
  };
  job.details.claims = [{
    claimType: "salary",
    value: "$200,000",
    sourceUrl: "",
    supportingPassage: "",
    sourceDate: "",
    confidence: 0.8,
    evidenceType: "inferred",
  }];
  job.details.critic = {
    ...job.details.critic,
    agrees: true,
    recommendedVerdict: "maybe",
  };
  const codes = new Set(evaluationAudit.auditJobEvaluation(job, { promptVersion: workflow.PROMPT_VERSION }).map((finding) => finding.code));
  assert.ok(codes.has("stale_triage_prompt"));
  assert.ok(codes.has("verdict_gate_contradiction"));
  assert.ok(codes.has("unknown_dimension_scored"));
  assert.ok(codes.has("ungrounded_claim"));
  assert.ok(codes.has("industry_used_as_fit_penalty"));
  assert.ok(codes.has("remote_used_as_fit_penalty"));
  assert.ok(codes.has("critic_agreement_contradiction"));
});

test("title normalization and all eight seeded families route deterministically", () => {
  const patterns = taxonomy.seedTitlePatterns();
  assert.equal(taxonomy.TITLE_FAMILIES.length, 8);
  assert.equal(taxonomy.normalizeTitle("Sr. VP, AI & Data Strategy"), "senior vice president ai and data strategy");
  for (const family of taxonomy.TITLE_FAMILIES) {
    const result = taxonomy.classifyTitle(family.aliases[0], patterns);
    assert.equal(result.familyId, family.id);
    assert.equal(result.lane, "title_family");
  }
});

test("unknown titles enter the exploratory lane and patterns treat metacharacters as data", () => {
  assert.equal(taxonomy.classifyTitle("Director of Decision Intelligence Commercialization").lane, "exploratory");
  const exact = taxonomy.compilePattern({ matchType: "exact", expression: "C++ Product (AI)" });
  assert.equal(exact("C++ Product (AI)"), true);
  assert.equal(exact("C Product AI Director"), false);
  const tokens = taxonomy.compilePattern({ matchType: "token_set", expression: "analytics strategy" });
  assert.equal(tokens("Senior Strategy and Analytics Lead"), true);
  assert.equal(tokens("Analytics Engineering Lead"), false);
});

test("title proposals auto-promote only with safe support and no positive regression", () => {
  const proposal = taxonomy.buildAliasProposal({
    title: "Director Decision Intelligence",
    familyId: "data_ai_strategy",
    familyLabel: "Data / AI strategy",
    confidence: 0.96,
  });
  proposal.supportCount = 3;
  assert.equal(taxonomy.evaluateProposalForPromotion(proposal, []).autoPromote, true);
  const labelled = [{ title: proposal.expression, disposition: "apply", roleFamilyId: "analytics_leadership" }];
  assert.equal(taxonomy.evaluateProposalForPromotion(proposal, labelled).autoPromote, false);
});

test("discovery uses eight high-recall Google Jobs bundles without negative terms", () => {
  const plan = discovery.buildSearchPlan({ date: new Date("2026-07-10T00:00:00Z") });
  assert.equal(plan.serpQueries.length, 8);
  assert.equal(plan.titleFamilies.length, 8);
  assert.match(plan.serpQueries.map((item) => item.query).join("\n"), /Product Scientist/);
  assert.match(plan.serpQueries.map((item) => item.query).join("\n"), /Business Manager/);
  assert.doesNotMatch(JSON.stringify(plan), /-\"|NOT backend|NOT software/i);
  assert.equal(plan.localBrowserQueries.length, 8);
  assert.equal(plan.braveQueries.length, 8);
  assert.match(plan.braveQueries.map((item) => item.query).join("\n"), /inurl:careers|myworkdayjobs|wellfound/);
  assert.ok(plan.portals.some((portal) => portal.id === "wellfound"));
  assert.ok(plan.portals.some((portal) => portal.id === "yc"));
});

test("metadata-first discovery retains incomplete URLs before page extraction", async () => {
  const records = await repository.recordDiscoveryLeads([
    {
      url: "https://www.linkedin.com/jobs/view/example-role-4437322106/?trk=search",
      title: "Senior Manager, Decision Science",
      sourceProvider: "linkedin",
      sourceQuery: "google:test",
      status: "extraction_pending",
      ontology: { eligible: true },
    },
    {
      url: "https://www.linkedin.com/jobs/view/example-role-4437322106/",
      title: "Senior Manager, Decision Science",
      company: "Travelers",
      sourceProvider: "linkedin",
      sourceQuery: "portal:test",
      status: "extraction_pending",
      ontology: { eligible: true },
    },
  ]);
  assert.equal(records.length, 1);
  const leads = await repository.listDiscoveryLeads({ limit: 10 });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].company, "Travelers");
  assert.equal(leads[0].status, "extraction_pending");
  const dashboard = await jobSearch.getJobSearchDashboard({ view: "discovery" });
  assert.equal(dashboard.discoveryLeads.length, 1);
  assert.match(dashboard.discoveryLeads[0].url, /4437322106/);
});

test("relative discovery timestamps normalize safely and preserve unreliable raw text", async () => {
  const [lead] = await repository.recordDiscoveryLeads([{
    url: "https://wellfound.com/jobs/1001",
    title: "Director, AI Strategy",
    company: "Example",
    sourceProvider: "wellfound",
    sourceQuery: "wellfound:test",
    postedAt: "30+ days ago",
    status: "extraction_pending",
    ontology: { eligible: true },
  }]);
  assert.equal(lead.postedAt, null);
  assert.equal(lead.raw.postedAtRaw, "30+ days ago");

  const [normalized] = await workflow.persistExtractedJobs([{
    sourceId: "relative_timestamp_job",
    title: "Director, AI Strategy",
    company: "Example",
    location: "Remote",
    description: "Lead AI strategy and analytics programs across global financial-services products.",
    url: "https://example.com/jobs/relative",
    postedAt: "6 hours ago",
    sourceProvider: "linkedin",
    sourceQuery: "linkedin:test",
    raw: {},
  }]);
  assert.match(normalized.postedAt, /^\d{4}-\d{2}-\d{2}T/);

  const [unreliable] = await workflow.persistExtractedJobs([{
    sourceId: "unreliable_timestamp_job",
    title: "Director, AI Strategy",
    company: "Example",
    location: "Remote",
    description: "Lead AI strategy and analytics programs across global financial-services products.",
    url: "https://example.com/jobs/unreliable",
    postedAt: "30+ days ago",
    sourceProvider: "linkedin",
    sourceQuery: "linkedin:test",
    raw: {},
  }]);
  assert.equal(unreliable.postedAt, null);
  assert.equal(unreliable.details.sourceMetadata.postedAtRaw, "30+ days ago");
});

test("Windows collector source selection, parsing, and dedupe prefer richer canonical jobs", () => {
  assert.deepEqual(windowsCollector.normalizeCollectorSources("linkedin,google"), ["linkedin", "google"]);
  assert.deepEqual(windowsCollector.normalizeCollectorSources(""), ["linkedin"]);
  assert.deepEqual(windowsCollector.normalizeCollectorSources("linkedin,wellfound,google,bing"), ["linkedin", "wellfound", "google", "bing"]);

  const directBingUrl = "https://wellfound.com/jobs/998877-director-ai-strategy";
  const encodedBingUrl = Buffer.from(directBingUrl).toString("base64url");
  assert.equal(
    windowsCollector.canonicalCollectorUrl(`https://www.bing.com/ck/a?u=a1${encodedBingUrl}&ntb=1`),
    directBingUrl,
  );

  const linkedInHtml = `
    <ul class="jobs-search__results-list">
      <li>
        <a href="https://www.linkedin.com/jobs/view/example-role-4437322106/?trk=public_jobs">
          <h3>Director, AI Strategy</h3>
          <h4>Example Fintech</h4>
          <span class="job-search-card__location">Remote</span>
          <time>6 hours ago</time>
        </a>
      </li>
    </ul>`;
  const wellfoundHtml = `
    <a href="https://wellfound.com/jobs/998877-director-ai-strategy">
      <h2>Director, AI Strategy</h2>
      <div data-test="StartupName">Example Fintech</div>
      <div data-test="Location">Remote</div>
      <time>yesterday</time>
    </a>`;
  const bingHtml = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${encodedBingUrl}&ntb=1">Director, AI Strategy</a></h2><p>Example Fintech is hiring.</p></li>`;
  const bingRss = `<?xml version="1.0"?><rss><channel><item><title>Director, AI Strategy</title><link>${directBingUrl}</link><description>Example Fintech is hiring.</description><pubDate>Mon, 13 Jul 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const linkedInJobs = windowsCollector.extractLinkedInJobsFromHtml(linkedInHtml, { sourceQuery: "linkedin:sample" });
  const wellfoundJobs = windowsCollector.extractWellfoundJobsFromHtml(wellfoundHtml, { sourceQuery: "wellfound:sample" });
  const bingJobs = windowsCollector.extractSearchResultsFromHtml(bingHtml, { engine: "bing", sourceQuery: "bing:sample" });
  const bingRssJobs = windowsCollector.extractBingRssResults(bingRss, { sourceQuery: "bing:rss" });
  assert.equal(linkedInJobs.length, 1);
  assert.equal(wellfoundJobs.length, 1);
  assert.equal(bingJobs.length, 1);
  assert.equal(bingRssJobs.length, 1);
  assert.equal(bingRssJobs[0].sourceProvider, "bing_rss_xray");
  assert.equal(linkedInJobs[0].company, "Example Fintech");
  assert.equal(wellfoundJobs[0].company, "Example Fintech");

  const deduped = windowsCollector.dedupeCollectorJobs([
    {
      ...linkedInJobs[0],
      url: "https://jobs.lever.co/example/abc123",
      canonicalUrl: "https://jobs.lever.co/example/abc123",
      raw: { collector: { portalId: "4437322106", atsId: "abc123" } },
      description: "Short description",
    },
    {
      ...linkedInJobs[0],
      url: "https://jobs.lever.co/example/abc123",
      canonicalUrl: "https://jobs.lever.co/example/abc123",
      raw: { collector: { portalId: "4437322106", atsId: "abc123" } },
      description: "Longer grounded description for the same job that should win the dedupe.",
    },
  ]);
  assert.equal(deduped.length, 1);
  assert.match(deduped[0].description, /Longer grounded description/);
});

test("Windows collector extracts a full JSON-LD job page before submission", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Director, AI Strategy",
    hiringOrganization: { name: "Example Fintech" },
    description: `<p>Lead enterprise AI strategy, analytics products, and responsible AI governance.</p>${"x".repeat(500)}`,
    datePosted: "2026-07-13",
    jobLocation: { address: { addressLocality: "New York", addressRegion: "NY", addressCountry: "US" } },
    baseSalary: { currency: "USD", value: { minValue: 180000, maxValue: 230000, unitText: "YEAR" } },
  })}</script></head><body></body></html>`;
  const job = windowsCollector.extractCollectorJobPage(html, "https://example.com/jobs/ai-strategy", {
    sourceId: "linkedin_4437322106",
    title: "AI Strategy",
    company: "Example",
    description: "Short search-card snippet.",
    sourceProvider: "linkedin",
    sourceQuery: "ai_strategy",
  });
  assert.equal(job.sourceId, "linkedin_4437322106");
  assert.equal(job.title, "Director, AI Strategy");
  assert.equal(job.company, "Example Fintech");
  assert.match(job.location, /New York, NY, US/);
  assert.match(job.description, /Lead enterprise AI strategy/);
  assert.match(job.description, /USD 180000-230000 YEAR/);
  assert.equal(job.raw.pageExtraction.jsonLd, true);
  assert.equal(job.raw.pageExtraction.structuredCompensation, true);
});

test("pre-deep extraction rejects challenge pages and accepts materially richer job text", () => {
  const job = {
    title: "Director, AI Strategy",
    description: "Lead AI strategy for a financial-services portfolio.",
  };
  assert.equal(workflow.isRicherExtractedDescription(job, {
    description: `Sign in to continue. Join LinkedIn to view this Director AI Strategy role. ${"x".repeat(1000)}`,
  }), false);
  assert.equal(workflow.isRicherExtractedDescription(job, {
    description: `About the role: the Director of AI Strategy will lead the portfolio. Responsibilities include enterprise AI planning. Qualifications include ten years of analytics leadership. ${"x".repeat(1000)}`,
  }), true);
});

test("local work queue is idempotent and leases one task at a time", async () => {
  const job = await seedJob({ sourceId: "local_queue" });
  const first = await repository.enqueueLocalTask({ jobId: job.id, taskType: "deep", revision: "hash:v1" });
  const duplicate = await repository.enqueueLocalTask({ jobId: job.id, taskType: "deep", revision: "hash:v1" });
  assert.equal(first.id, duplicate.id);
  const claimed = await repository.claimLocalTask({ workerId: "test-worker" });
  assert.equal(claimed.id, first.id);
  assert.equal(claimed.status, "processing");
  assert.match(claimed.leaseToken, /^lease_/);
  assert.equal(await repository.claimLocalTask({ workerId: "test-worker-2" }), null);
  await assert.rejects(
    repository.renewLocalTaskLease(first.id, { workerId: "test-worker", leaseToken: "lease_invalid_invalid_invalid" }),
    /lease token is invalid/,
  );
  const renewed = await repository.renewLocalTaskLease(first.id, {
    workerId: "test-worker",
    leaseToken: claimed.leaseToken,
  });
  assert.ok(new Date(renewed.leaseUntil) > new Date());
  const completed = await repository.completeLocalTask(first.id, { ok: true });
  assert.equal(completed.status, "completed");
});

test("new task revisions supersede stale stages and downstream work", async () => {
  const job = await seedJob({ sourceId: "local_queue_revision" });
  const critic = await repository.enqueueLocalTask({ jobId: job.id, taskType: "critic", revision: "critic:v1" });
  const firstDeep = await repository.enqueueLocalTask({ jobId: job.id, taskType: "deep", revision: "deep:v1" });
  const latestDeep = await repository.enqueueLocalTask({ jobId: job.id, taskType: "deep", revision: "deep:v2" });
  const tasks = await repository.listLocalTasks({ limit: 20 });

  assert.equal(tasks.find((task) => task.id === critic.id).status, "superseded");
  assert.equal(tasks.find((task) => task.id === firstDeep.id).status, "superseded");
  assert.equal(tasks.find((task) => task.id === latestDeep.id).status, "queued");
});

test("a new revision supersedes an expired lease but preserves a genuinely active lease", async () => {
  const expiredJob = await seedJob({ sourceId: "expired_processing_revision" });
  const expired = await repository.enqueueLocalTask({ jobId: expiredJob.id, taskType: "deep", revision: "deep:v1" });
  const claimedExpired = await repository.claimLocalTask({ workerId: "expired-worker", leaseSeconds: 60 });
  await repository.setLocalTaskStatus(claimedExpired.id, {
    status: "processing",
    availableAt: new Date(Date.now() - 120_000).toISOString(),
    clearLease: false,
  });
  const localPath = path.join(tempDir, "job-search-intelligence.json");
  const localState = JSON.parse(await readFile(localPath, "utf8"));
  localState.localTasks.find((item) => item.id === expired.id).leaseUntil = new Date(Date.now() - 60_000).toISOString();
  await writeFile(localPath, JSON.stringify(localState, null, 2));
  const replacement = await repository.enqueueLocalTask({ jobId: expiredJob.id, taskType: "triage", revision: "triage:v2" });
  const expiredTasks = await repository.listLocalTasks({ limit: 20 });
  assert.equal(expiredTasks.find((task) => task.id === expired.id).status, "superseded");
  assert.equal(expiredTasks.find((task) => task.id === replacement.id).status, "queued");

  await rm(path.join(tempDir, "job-search-intelligence.json"), { force: true });
  const activeJob = await seedJob({ sourceId: "active_processing_revision" });
  const active = await repository.enqueueLocalTask({ jobId: activeJob.id, taskType: "deep", revision: "deep:v1" });
  await repository.claimLocalTask({ workerId: "active-worker", leaseSeconds: 900 });
  await repository.enqueueLocalTask({ jobId: activeJob.id, taskType: "triage", revision: "triage:v2" });
  const activeTasks = await repository.listLocalTasks({ limit: 20 });
  assert.equal(activeTasks.find((task) => task.id === active.id).status, "processing");
});

test("every current deep evaluation, including a hard-blocked pass, receives an independent critic task", async () => {
  const job = await seedJob({
    sourceId: "blocked_job_needs_critic",
    status: "passed",
    details: {
      triageStatus: "complete",
      triagePromptVersion: workflow.PROMPT_VERSION,
      triage: { relevance: "irrelevant", confidence: 0.99, codingIntensity: "high" },
      deepStatus: "complete",
      evaluationFrameworkVersion: evaluationFramework.EVALUATION_FRAMEWORK_VERSION,
      deepEvaluation: {
        verdict: "pass",
        overallScore: 20,
        decision: { blockers: ["codingInterview"], unknowns: [] },
      },
      criticStatus: "pending",
    },
  });
  const task = await workflow.enqueueNextWindowsTask(job);
  assert.equal(task.taskType, "critic");
});

test("a prompt-version change re-triages every prior relevance class", async () => {
  for (const relevance of ["relevant", "uncertain", "irrelevant"]) {
    const job = await seedJob({
      sourceId: `stale_prompt_${relevance}`,
      details: {
        triageStatus: "complete",
        triagePromptVersion: "obsolete-prompt",
        triage: { relevance, confidence: 0.9, codingIntensity: "unknown" },
        deepStatus: "complete",
        evaluationFrameworkVersion: "obsolete-framework",
        deepEvaluation: { verdict: "maybe", overallScore: 50, dimensions: {} },
      },
    });
    const task = await workflow.enqueueNextWindowsTask(job);
    assert.equal(task.taskType, "triage", relevance);
  }
});

test("controlled release supersedes stale deep work with the current prompt revision", async () => {
  process.env.JOBSEARCH_LOCAL_WORKER_ENABLED = "true";
  try {
    const job = await seedJob({
      sourceId: "stale_active_calibration_job",
      details: {
        triageStatus: "complete",
        triagePromptVersion: "obsolete-prompt",
        triage: { relevance: "relevant", confidence: 0.95, codingIntensity: "low" },
        deepStatus: "complete",
        evaluationFrameworkVersion: "obsolete-framework",
        deepEvaluation: { verdict: "apply", overallScore: 85, dimensions: {} },
      },
    });
    const staleDeep = await repository.enqueueLocalTask({
      jobId: job.id,
      taskType: "deep",
      revision: `${job.contentHash}:obsolete-prompt:windows-deep-grounded-v1`,
    });
    await repository.setLocalQueueControl({
      holdNewTasks: true,
      holdReason: "prompt_migration",
      activeReleaseJobIds: [job.id],
    });
    await repository.holdLocalQueueTasks({ statuses: ["queued"], reason: "prompt_migration" });

    const release = await workflow.releaseHeldWindowsBacklog({
      operationKey: "release-current-prompt-revision",
      dryRun: false,
      limit: 1,
    });
    const tasks = await repository.listLocalTasks({ limit: 20 });
    const staleTask = tasks.find((task) => task.id === staleDeep.id);
    const currentTriage = tasks.find((task) => task.jobId === job.id
      && task.taskType === "triage"
      && task.status === "queued");

    assert.equal(release.selectedCount, 1);
    assert.equal(release.selected[0].taskType, "triage");
    assert.equal(release.activated.createdCount, 1);
    assert.equal(staleTask.status, "superseded");
    assert.ok(currentTriage);
    assert.notEqual(currentTriage.taskKey, staleTask.taskKey);
  } finally {
    delete process.env.JOBSEARCH_LOCAL_WORKER_ENABLED;
  }
});

test("queue hold and controlled release preserve history and only activate the released cohort", async () => {
  process.env.JOBSEARCH_LOCAL_WORKER_ENABLED = "true";
  try {
    for (let index = 0; index < 15; index += 1) {
      const job = await seedJob({
        sourceId: `held_deep_${index}`,
        status: "deep_review_pending",
        details: {
          triageStatus: "complete",
          triagePromptVersion: workflow.PROMPT_VERSION,
          triage: { relevance: index < 10 ? "relevant" : "uncertain", confidence: 0.8, codingIntensity: "low" },
        },
      });
      const task = await workflow.enqueueNextWindowsTask(job);
      assert.equal(task.status, "queued");
    }
    for (let index = 0; index < 5; index += 1) {
      const job = await seedJob({
        sourceId: `held_critic_${index}`,
        status: "critic_pending",
        details: {
          triageStatus: "complete",
          triagePromptVersion: workflow.PROMPT_VERSION,
          triage: { relevance: "relevant", confidence: 0.9, codingIntensity: "low" },
          deepStatus: "complete",
          evaluationFrameworkVersion: evaluationFramework.EVALUATION_FRAMEWORK_VERSION,
          deepEvaluation: { verdict: "apply", overallScore: 90 - index },
        },
      });
      await workflow.enqueueNextWindowsTask(job);
    }
    const pendingTriage = await seedJob({
      sourceId: "held_collector_triage",
      status: "local_triage_pending",
      details: { triageStatus: "pending" },
    });
    await workflow.enqueueNextWindowsTask(pendingTriage);
    const pendingOutreach = await seedJob({
      sourceId: "held_outreach",
      status: "needs_review",
      details: {
        triageStatus: "complete",
        triagePromptVersion: workflow.PROMPT_VERSION,
        triage: { relevance: "relevant", confidence: 0.95, codingIntensity: "low" },
        deepStatus: "complete",
        evaluationFrameworkVersion: evaluationFramework.EVALUATION_FRAMEWORK_VERSION,
        deepEvaluation: { verdict: "apply", overallScore: 92 },
        criticStatus: "complete",
        critic: { agrees: true, recommendedVerdict: "apply", confidence: 0.9 },
      },
    });
    await workflow.enqueueNextWindowsTask(pendingOutreach);
    const mismatch = await seedJob({
      sourceId: "clear_mismatch_not_promoted",
      status: "triage_rejected",
      details: {
        triageStatus: "complete",
        triagePromptVersion: workflow.PROMPT_VERSION,
        triage: { relevance: "irrelevant", confidence: 0.98, codingIntensity: "low" },
      },
    });
    await workflow.enqueueNextWindowsTask(mismatch);
    const promoted = await seedJob({
      sourceId: "clear_mismatch_promoted",
      status: "needs_review",
      disposition: "maybe",
      details: {
        triageStatus: "complete",
        triagePromptVersion: workflow.PROMPT_VERSION,
        triage: { relevance: "irrelevant", confidence: 0.95, codingIntensity: "low" },
      },
    });
    await workflow.enqueueNextWindowsTask(promoted);

    const held = await workflow.reconcileHeldWindowsQueue({
      operationKey: "hold-operation-001",
      dryRun: false,
      reason: "windows_migration_precalibration",
    });
    assert.equal(held.queueControlAfter.holdNewTasks, true);
    assert.equal(held.queueCounts.after.byStatus.held, 24);

    const release = await workflow.releaseHeldWindowsBacklog({
      operationKey: "release-operation-001",
      dryRun: false,
      limit: 20,
    });
    assert.equal(release.selectedCount, 20);
    assert.equal(release.candidateCounts.triagePending, 1);
    assert.equal(release.candidateCounts.outreachReady, 1);
    assert.equal(release.queueControlAfter.activeReleaseJobIds.length, 20);
    assert.equal(release.selected.some((item) => item.sourceId === "held_collector_triage"), true);
    assert.equal(release.selected.some((item) => item.sourceId === "held_outreach"), true);
    assert.equal(release.selected.some((item) => item.sourceId === "clear_mismatch_not_promoted"), true);
    assert.equal(release.selected.some((item) => item.sourceId === "clear_mismatch_promoted"), true);

    const claim = await repository.claimLocalTask({ workerId: "migration-test-worker" });
    assert.ok(release.queueControlAfter.activeReleaseJobIds.includes(claim.jobId));
    const status = await repository.getLocalWorkerStatus();
    assert.equal(status.queueControl.holdNewTasks, true);

    const resumed = await workflow.resumeWindowsQueue({
      operationKey: "resume-operation-001",
      dryRun: false,
    });
    assert.equal(resumed.queueControlAfter.holdNewTasks, false);
    assert.deepEqual(resumed.queueControlAfter.activeReleaseJobIds, []);
    const replay = await workflow.resumeWindowsQueue({
      operationKey: "resume-operation-001",
      dryRun: false,
    });
    assert.deepEqual(replay, resumed);
  } finally {
    delete process.env.JOBSEARCH_LOCAL_WORKER_ENABLED;
  }
});

test("queue task ordering accepts Neon Date values and local timestamp strings", () => {
  const earlier = { createdAt: new Date("2026-07-13T12:00:00.000Z") };
  const later = { createdAt: "2026-07-13T13:00:00.000Z" };
  assert.ok(workflow.compareQueueTaskCreatedAt(earlier, later) < 0);
  assert.ok(workflow.compareQueueTaskCreatedAt(later, earlier) > 0);
  assert.equal(workflow.compareQueueTaskCreatedAt({}, {}), 0);
});

test("Windows worker contract bounds evidence and requires grounded claims", async () => {
  const job = await seedJob({
    sourceId: "worker_contract",
    description: "A".repeat(20_000),
    details: {
      sourceEvidence: [{
        claimType: "remote",
        value: "Remote in India",
        sourceUrl: "https://example.com/jobs/1",
        supportingPassage: "This role may be performed remotely from India.",
        confidence: 1,
        evidenceType: "explicit",
      }],
      databaseUrl: "must-not-leave-server",
    },
  });
  const task = await repository.enqueueLocalTask({ jobId: job.id, taskType: "deep", revision: "worker-contract" });
  const packet = workerContract.buildWorkerPacket({ task: { ...task, attempts: 1 }, job, feedbackExamples: [] });
  assert.ok(packet.job.description.length <= workerContract.WORKER_LIMITS.maxDescriptionCharacters);
  assert.equal(JSON.stringify(packet).includes("must-not-leave-server"), false);
  assert.equal(packet.constraints.allowedModelTier, "qwen3-4b-q4_k_m");
  assert.throws(() => workerContract.parseWorkerOutput("deep", {
    extraction: { claims: [], unknowns: [] },
    evaluation: {
      verdict: "maybe",
      overallScore: 60,
      summary: "Potential fit.",
      dimensions: Object.fromEntries([
        "roleFit", "financialServicesAdvantage", "aiDataRelevance", "leadershipLevel",
        "codingInterviewRisk", "locationAuthorization", "compensationUpside", "companyQuality", "interviewVelocity",
      ].map((name) => [name, { score: 3, reasoning: "Uncertain." }])),
      claims: [{
        claimType: "visa",
        value: "Sponsorship available",
        sourceUrl: "",
        supportingPassage: "",
        sourceDate: "",
        confidence: 0.9,
        evidenceType: "inferred",
      }],
      redFlags: [], greenFlags: [], unknowns: [], outreachAngle: "",
    },
  }), /Invalid URL|Too small/i);
});

test("maximal Windows worker packet fits the 8192 context budget and retains priority evidence", () => {
  const priorityEvidence = [
    {
      claimType: "work_authorization",
      value: "India-based applicants must already be eligible to work for the employing entity.",
      sourceUrl: "https://example.com/jobs/maximal",
      supportingPassage: "Applicants must already be eligible to work for the employing entity from India.",
      confidence: 1,
      evidenceType: "explicit",
    },
    {
      claimType: "compensation",
      value: "The salary range is USD 170,000 to USD 210,000 plus equity.",
      sourceUrl: "https://example.com/jobs/maximal",
      supportingPassage: "Salary range: $170,000-$210,000 plus equity.",
      confidence: 1,
      evidenceType: "explicit",
    },
    {
      claimType: "coding_interview",
      value: "The interview includes a Python and SQL technical exercise.",
      sourceUrl: "https://example.com/jobs/maximal",
      supportingPassage: "Candidates complete a Python and SQL technical exercise.",
      confidence: 1,
      evidenceType: "explicit",
    },
  ];
  const lowerPriorityEvidence = Array.from({ length: 30 }, (_, index) => ({
    claimType: `general_${index}`,
    value: `General company detail ${index} ${"value ".repeat(35)}`,
    sourceUrl: `https://example.com/jobs/maximal?detail=${index}`,
    supportingPassage: `General background passage ${index}. ${"Background information. ".repeat(30)}`,
    confidence: 0.8,
    evidenceType: "explicit",
  }));
  const job = {
    id: "job_maximal_packet",
    sourceId: "maximal_packet",
    title: "Senior Director, AI Strategy and Financial Services",
    company: "Example Financial",
    location: "India / Global Remote",
    canonicalUrl: "https://example.com/jobs/maximal",
    description: Array.from({ length: 120 }, (_, index) => `Responsibility ${index}: lead cross-functional AI, analytics, risk, and product strategy programs.`).join("\n"),
    postedAt: "2026-07-13T12:00:00.000Z",
    roleFamilyId: "data_ai_strategy",
    details: { sourceEvidence: [...lowerPriorityEvidence, ...priorityEvidence], triage: { relevance: "relevant" } },
  };
  const packet = workerContract.buildWorkerPacket({
    task: { id: "task_maximal_packet", taskKey: "deep:maximal", taskType: "deep", attempts: 1, leaseUntil: "2026-07-13T13:00:00.000Z" },
    job,
    feedbackExamples: Array.from({ length: 6 }, (_, index) => ({
      title: `Prior role ${index}`,
      company: `Prior company ${index}`,
      disposition: index % 2 ? "pass" : "apply",
      reasons: ["Representative owner feedback"],
      note: "Use this only as preference evidence.",
    })),
  });

  assert.equal(workerContract.WORKER_LIMITS.contextTokens, 8192);
  assert.equal(workerContract.WORKER_LIMITS.concurrency, 1);
  assert.ok(JSON.stringify(packet).length <= workerContract.WORKER_LIMITS.maxPacketCharacters);
  assert.deepEqual(
    { title: packet.job.title, company: packet.job.company, location: packet.job.location, url: packet.job.url },
    { title: job.title, company: job.company, location: job.location, url: job.canonicalUrl },
  );
  assert.equal(packet.candidate.baseline, targetProfile.TARGET_PROFILE.baseline);
  assert.equal(packet.candidate.targetGeography, targetProfile.TARGET_PROFILE.targetGeography);
  assert.equal(packet.candidate.compensation, targetProfile.TARGET_PROFILE.compensation);
  assert.equal(packet.candidate.avoid, targetProfile.TARGET_PROFILE.avoid);
  assert.ok(priorityEvidence.every((expected) => packet.evidence.some((item) => item.claimType === expected.claimType)));
  assert.ok(packet.evidence.length < lowerPriorityEvidence.length + priorityEvidence.length);

  const extractionPass = workerContract.getWorkerPass("deep", "extract", packet);
  assert.ok(extractionPass.promptCharacters <= workerContract.WORKER_LIMITS.maxPromptCharacters);
  assert.equal(extractionPass.maxTokens, 1800);
  assert.throws(() => extractionPass.schema.parse({
    claims: [{
      claimType: "eligibility",
      value: "Unsupported eligibility claim",
      sourceUrl: "",
      supportingPassage: "",
      sourceDate: "",
      confidence: 0.9,
      evidenceType: "inferred",
    }],
    unknowns: [],
  }), /Invalid URL|Too small/i);
  assert.throws(() => extractionPass.schema.parse({
    claims: Array.from({ length: 7 }, (_, index) => ({
      claimType: `claim_${index}`,
      value: "Supported claim",
      sourceUrl: "https://example.com/jobs/maximal",
      supportingPassage: "Supported passage.",
      sourceDate: "2026-07-13",
      confidence: 0.9,
      evidenceType: "explicit",
    })),
    unknowns: [],
  }), /Too big|at most 6/i);

  const evaluationPass = workerContract.getWorkerPass("deep", "evaluate", packet, {
    extraction: { claims: packet.evidence, unknowns: Array.from({ length: 10 }, (_, index) => `Unknown ${index}`) },
  });
  assert.ok(evaluationPass.promptCharacters <= workerContract.WORKER_LIMITS.maxPromptCharacters);
  assert.equal(evaluationPass.maxTokens, 2400);
  assert.equal(extractionPass.thinking, false);
  assert.equal(evaluationPass.thinking, true);
  const criticPass = workerContract.getWorkerPass("critic", "evaluate", {
    ...packet,
    task: { ...packet.task, taskType: "critic" },
    job: { ...packet.job, deepEvaluation: { verdict: "maybe" } },
  });
  assert.equal(criticPass.thinking, true);
});

test("Windows collector launcher quotes paths and status uses the live resource phase", async () => {
  const collectorScript = await readFile(new URL("../scripts/windows/start-job-collector.ps1", import.meta.url), "utf8");
  const statusScript = await readFile(new URL("../scripts/windows/status-job-worker.ps1", import.meta.url), "utf8");
  const setupScript = await readFile(new URL("../scripts/windows/setup-job-worker.ps1", import.meta.url), "utf8");
  const startScript = await readFile(new URL("../scripts/windows/start-job-worker.ps1", import.meta.url), "utf8");
  const workerScript = await readFile(new URL("../scripts/job-search-windows-worker.mjs", import.meta.url), "utf8");
  assert.match(collectorScript, /ConvertTo-ProcessArgument/);
  assert.match(collectorScript, /ConvertTo-ProcessArgument "--chrome=\$\(\$config\.chromePath\)"/);
  assert.match(collectorScript, /ConvertTo-ProcessArgument '--run-label=Scheduled Windows collector'/);
  assert.match(statusScript, /if \(\$process\) \{ @\(\) \} else \{ @\('--startup'\) \}/);
  assert.match(setupScript, /thermalProfile = 'low-heat'/);
  assert.match(setupScript, /gpuLayers = 8/);
  assert.match(setupScript, /cpuThreads = 2/);
  assert.match(setupScript, /activeMinutes = 120/);
  assert.match(setupScript, /cooldownMinutes = 60/);
  assert.match(startScript, /JOBSEARCH_LOCAL_GPU_LAYERS/);
  assert.match(startScript, /JOBSEARCH_WORKER_ACTIVE_MINUTES/);
  assert.match(workerScript, /JOBSEARCH_LOCAL_GPU_LAYERS \|\| 8/);
  assert.match(workerScript, /scheduled_two_hour_limit/);
  assert.match(workerScript, /pass\.thinking \? "think" : "no_think"/);
  assert.match(workerScript, /resource_wait_before_claim/);
  assert.match(workerScript, /beginCooldown\("temperature_guard"\)/);
  assert.match(workerScript, /AbortSignal\.any/);
  assert.ok(workerScript.indexOf("resourcesReadyBeforeClaim()") < workerScript.indexOf('workerFetch("claim"'));
});

test("Windows updater preserves the protected credential and fast-forwards without model reinstallation", async () => {
  const script = await readFile(new URL("../scripts/windows/update-job-worker.ps1", import.meta.url), "utf8");
  assert.match(script, /Get-WorkerCredential/);
  assert.match(script, /status --porcelain/);
  assert.match(script, /merge --ff-only/);
  assert.match(script, /-RegisterScheduledTask/);
  assert.match(script, /Start-ScheduledTask/);
  assert.match(script, /supervised Windows worker/);
  assert.match(script, /credentialReused = \$true/);
  assert.doesNotMatch(script, /install-job-worker\.ps1/);
  assert.doesNotMatch(script, /ReplaceCredential/);
});

test("Windows resource guard permits this model tier and always rejects Qwen3-14B", () => {
  assert.equal(resourceGuard.assertApprovedWindowsModel("Qwen3-4B-Q4_K_M.gguf"), true);
  assert.throws(() => resourceGuard.assertApprovedWindowsModel("Qwen3-14B-Q4_K_M.gguf"), /prohibited/);
  assert.throws(() => resourceGuard.assertApprovedWindowsModel("Qwen3-8B-Q4_K_M.gguf"), /approved only/);
  const evaluation = resourceGuard.evaluateResourceGuard({
    memory: { totalBytes: 16 * (1024 ** 3), availableBytes: 8 * (1024 ** 3) },
    disk: { freeBytes: 100 * (1024 ** 3) },
    cpu: { loadPercent: 25 },
    nvidia: { name: "GTX 1660 Ti", totalVramMiB: 6144, freeVramMiB: 5500, temperatureCelsius: 65 },
  }, { phase: "startup" });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.summary.totalVramMiB, 6144);
  const runtime = resourceGuard.evaluateResourceGuard({
    memory: { totalBytes: 16 * (1024 ** 3), availableBytes: 3 * (1024 ** 3) },
    disk: { freeBytes: 100 * (1024 ** 3) },
    cpu: { loadPercent: 25 },
    nvidia: { name: "GTX 1660 Ti", totalVramMiB: 6144, freeVramMiB: 2300, temperatureCelsius: 75 },
  }, { phase: "runtime" });
  assert.equal(runtime.ok, true);
  const runtimeTooHot = resourceGuard.evaluateResourceGuard({
    memory: { totalBytes: 16 * (1024 ** 3), availableBytes: 8 * (1024 ** 3) },
    disk: { freeBytes: 100 * (1024 ** 3) },
    cpu: { loadPercent: 25 },
    nvidia: { name: "GTX 1660 Ti", totalVramMiB: 6144, freeVramMiB: 5500, temperatureCelsius: 78 },
  }, { phase: "runtime" });
  assert.equal(runtimeTooHot.ok, false);
  assert.equal(runtimeTooHot.summary.maximumGpuTemperatureCelsius, 78);
  const hot = resourceGuard.evaluateResourceGuard({
    memory: { totalBytes: 16 * (1024 ** 3), availableBytes: 8 * (1024 ** 3) },
    disk: { freeBytes: 100 * (1024 ** 3) },
    cpu: { loadPercent: 25 },
    nvidia: { name: "GTX 1660 Ti", totalVramMiB: 6144, freeVramMiB: 5500, temperatureCelsius: 80 },
  }, { phase: "startup" });
  assert.equal(hot.ok, false);
  assert.match(hot.reasons.join(" "), /GPU temperature/);
});

test("Windows worker circuit breaker distinguishes task output from infrastructure failure", () => {
  assert.equal(windowsWorkerRuntime.workerFailureCategory(new Error("Windows resource guard blocked task: available RAM")), "resource_pressure");
  assert.equal(windowsWorkerRuntime.workerFailureCategory(new Error("JSON did not match the triage schema")), "task_output");
  assert.equal(windowsWorkerRuntime.workerFailureCategory(new Error("Local model returned 503")), "infrastructure");
  assert.equal(windowsWorkerRuntime.isInfrastructureWorkerFailure(new Error("JSON did not match the triage schema")), false);
  assert.equal(windowsWorkerRuntime.isInfrastructureWorkerFailure(new Error("Windows resource guard blocked task")), false);
  assert.equal(windowsWorkerRuntime.isInfrastructureWorkerFailure(new Error("Local model returned 503")), true);
  assert.equal(windowsWorkerRuntime.isInfrastructureWorkerFailure(new Error("fetch failed: ECONNRESET")), true);
  assert.equal(windowsWorkerRuntime.shouldRetryWorkerTask({ attempt: 1 }), true);
  assert.equal(windowsWorkerRuntime.shouldRetryWorkerTask({ attempt: 3 }), false);
  const active = windowsWorkerRuntime.resolveThermalCycleState(null, { now: 1_000, activeMs: 7_200_000, cooldownMs: 3_600_000 });
  assert.deepEqual(active, { phase: "active", until: 7_201_000 });
  const cooling = windowsWorkerRuntime.resolveThermalCycleState({ phase: "active", until: new Date(500).toISOString() }, { now: 1_000, activeMs: 7_200_000, cooldownMs: 3_600_000 });
  assert.deepEqual(cooling, { phase: "cooldown", until: 3_601_000 });
  const resumed = windowsWorkerRuntime.resolveThermalCycleState({ phase: "cooldown", until: new Date(500).toISOString() }, { now: 1_000, activeMs: 7_200_000, cooldownMs: 3_600_000 });
  assert.deepEqual(resumed, { phase: "active", until: 7_201_000 });
});

test("ATS detector recognizes Greenhouse, Lever, Ashby, Workday, and SmartRecruiters", () => {
  assert.equal(ats.detectAtsFromUrl("https://boards.greenhouse.io/example/jobs/12345").provider, "greenhouse");
  assert.equal(ats.detectAtsFromUrl("https://jobs.lever.co/example/abc-123").provider, "lever");
  assert.equal(ats.detectAtsFromUrl("https://jobs.ashbyhq.com/example/def-456").provider, "ashby");
  assert.equal(ats.detectAtsFromUrl("https://acme.wd1.myworkdayjobs.com/en-US/External/job/New-York/Director_JR123").provider, "workday");
  assert.equal(ats.detectAtsFromUrl("https://jobs.smartrecruiters.com/Acme/744000012345-director-ai").provider, "smartrecruiters");
});

test("known company career boards are revisited and bounded to target plus exploratory titles", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /api\.lever\.co\/v0\/postings\/example/);
    return new Response(JSON.stringify([
      { id: "target", text: "Director of Analytics", hostedUrl: "https://jobs.lever.co/example/target", descriptionPlain: "Lead analytics strategy.", categories: { location: "Remote" } },
      { id: "unknown-1", text: "Studio Operations Partner", hostedUrl: "https://jobs.lever.co/example/unknown-1", descriptionPlain: "Run studio operations." },
      { id: "unknown-2", text: "Customer Education Partner", hostedUrl: "https://jobs.lever.co/example/unknown-2", descriptionPlain: "Build customer education." },
      { id: "unknown-3", text: "Office Coordinator", hostedUrl: "https://jobs.lever.co/example/unknown-3", descriptionPlain: "Coordinate office work." },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await ats.fetchKnownCompanyAtsJobs([{
      id: "company-1",
      name: "Example",
      atsProvider: "lever",
      atsIdentifier: "example",
      metadata: { atsDescriptor: { provider: "lever", company: "example" } },
    }]);
    assert.equal(result.provider.status, "live");
    assert.equal(result.provider.completed, 1);
    assert.deepEqual(result.jobs.map((job) => job.sourceId), ["lever_target", "lever_unknown-1", "lever_unknown-2"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("candidate review queues expose relevant, uncertain, and clear-mismatch jobs while hiding samples", async () => {
  await seedJob({ sourceId: "review_relevant", details: { triage: { relevance: "relevant" } } });
  await seedJob({ sourceId: "review_uncertain", details: { triage: { relevance: "uncertain" } } });
  await seedJob({
    sourceId: "review_mismatch", status: "triage_rejected",
    details: { triage: { relevance: "irrelevant" } },
  });
  await seedJob({
    sourceId: "legacy_sample", sourceProvider: "sample",
    details: { triage: { relevance: "relevant" } },
  });

  assert.equal((await repository.listJobs({ view: "all_candidates" })).length, 3);
  assert.equal((await repository.listJobs({ view: "relevant" })).length, 1);
  assert.equal((await repository.listJobs({ view: "uncertain" })).length, 1);
  assert.equal((await repository.listJobs({ view: "clear_mismatch" })).length, 1);
  assert.equal((await repository.listJobs({ view: "passed" })).length, 1);

  const dashboard = await jobSearch.getJobSearchDashboard({ view: "all_candidates" });
  assert.equal(dashboard.summary.total, 3);
  assert.equal(dashboard.summary.relevant, 1);
  assert.equal(dashboard.summary.uncertain, 1);
  assert.equal(dashboard.summary.clearMismatches, 1);
});

test("dashboard hides stale model summaries while a current-framework evaluation is pending", async () => {
  const job = await seedJob({
    sourceId: "stale_dashboard_evaluation",
    sourceProvider: "serpapi_google_jobs",
    status: "deep_review_pending",
    details: {
      triageStatus: "complete",
      triagePromptVersion: "legacy-prompt",
      triage: { relevance: "relevant", scopeSummary: "Legacy triage summary." },
      deepStatus: "pending",
      evaluationFrameworkVersion: "legacy-framework",
      deepEvaluation: { verdict: "pass", overallScore: 12, summary: "Legacy incorrect summary." },
      sourceEvidence: [],
    },
  });
  const dashboard = await jobSearch.getJobSearchDashboard({ view: "all_candidates" });
  const visible = dashboard.jobs.find((candidate) => candidate.id === job.id);

  assert.equal(visible.score, null);
  assert.equal(visible.verdict, null);
  assert.equal(visible.summary, "Awaiting evaluation under the current decision framework.");
  assert.equal(visible.triage, null);
});

test("job-search access is restricted to the configured owner", async () => {
  const owner = await auth.registerUser({ name: "Owner", email: "owner@example.com", password: "OwnerPass123!" });
  const outsider = await auth.registerUser({ name: "Outsider", email: "outsider@example.com", password: "OutsiderPass123!" });
  const ownerContext = await sessionContextFor(owner);
  const outsiderContext = await sessionContextFor(outsider);
  assert.equal(jobSearch.getJobSearchAccess(ownerContext).allowed, true);
  assert.equal(jobSearch.getJobSearchStatus(ownerContext).plan.discovery.serpQueries.length, 8);
  assert.equal(jobSearch.getJobSearchAccess(outsiderContext).allowed, false);
  assert.equal(jobSearch.getJobSearchStatus(outsiderContext).plan, undefined);
  assert.throws(() => jobSearch.requireJobSearchAccess(outsiderContext), /restricted/);
});

test("ingest returns queued immediately and missing providers end in partial without sample verdicts", async () => {
  const queued = await jobSearch.runJobSearchIngest({ trigger: "test" });
  assert.equal(queued.status, "queued");
  assert.equal(queued.queue.transport, "local-inline");
  let run;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    run = await jobSearch.getJobSearchRun(queued.runId);
    if (["partial", "completed", "failed", "blocked"].includes(run?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(run.status, "partial");
  assert.match(run.errors[0].message, /Missing providers/);
  assert.equal((await jobSearch.getJobSearchDashboard()).summary.total, 0);
});

test("structured and legacy feedback persist reasons and remain available as few-shot examples", async () => {
  const first = await seedJob({ sourceId: "feedback_apply" });
  const updated = await jobSearch.updateJobSearchFeedback(first.id, {
    disposition: "apply", reasons: ["domain", "domain", "invalid"], note: "Strong fintech fit.",
  });
  assert.equal(updated.disposition, "apply");
  assert.equal(updated.userFeedback, 1);
  assert.deepEqual(updated.feedbackReasons, ["domain"]);
  assert.equal(updated.feedbackNote, "Strong fintech fit.");

  const second = await seedJob({ sourceId: "feedback_pass", title: "AI Product Lead" });
  const legacy = await jobSearch.updateJobSearchFeedback(second.id, -1);
  assert.equal(legacy.disposition, "pass");
  assert.equal(legacy.userFeedback, -1);
  const examples = await repository.listFeedbackExamples("ai_product_platform");
  assert.equal(examples.length, 2);
});

test("the cost ledger blocks a paid call before either provider or total budget is crossed", async () => {
  await repository.recordProviderUsage({ provider: "zai", operation: "deep_fit", estimatedCostUsd: 3.99 });
  assert.equal(await repository.canSpend("zai", 0.02), false);
  assert.equal(await repository.canSpend("moonshot", 0.5), true);
  await repository.recordProviderUsage({ provider: "moonshot", operation: "critic", estimatedCostUsd: 0.99 });
  assert.equal(await repository.canSpend("moonshot", 0.02), false);
});

test("automatic shortlisting remains locked until calibration thresholds are met", async () => {
  for (let index = 0; index < 10; index += 1) {
    const job = await seedJob({
      sourceId: `calibration_${index}`,
      details: {
        deepEvaluation: { verdict: "apply", overallScore: 100 - index },
        claims: [],
      },
    });
    await repository.recordFeedback(job.id, { disposition: "apply", reasons: [], note: "" });
  }
  const calibration = await repository.getCalibrationStatus();
  assert.equal(calibration.precisionTopTen, 1);
  assert.equal(calibration.labelled, 10);
  assert.equal(calibration.active, false);
});

test("discovered companies are retained for future watchlist expansion", async () => {
  await repository.upsertCompany({ name: "Example Fintech", atsProvider: "greenhouse", atsIdentifier: "example" });
  await repository.upsertCompany({ name: "Example Fintech", metadata: { lastDiscoverySource: "serpapi" } });
  const [company] = await repository.listCompanies();
  assert.equal(company.name, "Example Fintech");
  assert.equal(company.atsProvider, "greenhouse");
  assert.equal(company.metadata.lastDiscoverySource, "serpapi");
});

test("canonical job URLs prevent duplicate records when a richer source replaces metadata", async () => {
  const url = "https://wellfound.com/jobs/998877-director-ai-strategy";
  const [metadata] = await workflow.persistExtractedJobs([{
    sourceId: "metadata_wellfound_998877",
    title: "Director, AI Strategy",
    company: "Unknown company",
    location: "",
    description: "Indexed search evidence for an AI strategy role.",
    url,
    sourceProvider: "brave",
    sourceQuery: "wellfound:xray",
    raw: { discoveryMetadataOnly: true },
  }]);
  const [richer] = await workflow.persistExtractedJobs([{
    sourceId: "collector_wellfound_998877",
    title: "Director, AI Strategy",
    company: "Example Fintech",
    location: "Remote",
    description: "Lead enterprise AI strategy and analytics products across financial services.",
    url,
    sourceProvider: "wellfound",
    sourceQuery: "wellfound:role",
    raw: {},
  }]);
  assert.equal(richer.id, metadata.id);
  assert.equal(richer.sourceId, metadata.sourceId);
  assert.equal((await repository.listJobs({ view: "all" })).length, 1);
  assert.equal(richer.company, "Example Fintech");
});

test("title pattern versions can be rolled back to the previous release", async () => {
  const proposal = taxonomy.buildAliasProposal({
    title: "AI Commercialization Director", familyId: "ai_product_platform",
    familyLabel: "AI product / platform", confidence: 0.95,
  });
  const saved = await repository.saveTitlePattern(proposal);
  const active = await repository.updateTitlePatternStatus(saved.id, "active");
  assert.equal(active.status, "active");
  assert.equal(active.version, 2);
  const rolledBack = await repository.rollbackTitlePattern(saved.id);
  assert.equal(rolledBack.status, "proposed");
  assert.equal(rolledBack.version, 3);
});

test("JSON-LD extraction preserves explicit job facts for downstream evidence", () => {
  const html = `<html><script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting", title: "Director, AI Strategy",
    hiringOrganization: { name: "FinCo" }, description: "Lead AI strategy across financial products and analytics teams.",
    datePosted: "2026-07-10", jobLocation: { address: { addressLocality: "New York" } },
  })}</script></html>`;
  const job = providers.extractJobFromHtml(html, "https://finco.example/jobs/123");
  assert.equal(job.title, "Director, AI Strategy");
  assert.equal(job.company, "FinCo");
  assert.equal(job.location, "New York");
  assert.equal(job.raw.jsonLd["@type"], "JobPosting");
});

test("job cards expose grounded compensation, sponsorship, company, and URL facts", async () => {
  const job = await seedJob({
    sourceId: "card_facts",
    canonicalUrl: "https://jobs.example.com/director-ai",
    company: "Example Fintech",
    description: "The base salary range is $170,000 - $215,000 per year. We will not offer visa sponsorship for this position.",
  });
  const facts = cardFacts.buildJobCardFacts(job);
  assert.equal(facts.company.label, "Example Fintech");
  assert.equal(facts.posting.url, "https://jobs.example.com/director-ai");
  assert.equal(facts.compensation.status, "listed");
  assert.match(facts.compensation.label, /\$170,000 - \$215,000/);
  assert.equal(facts.compensation.evidenceType, "explicit");
  assert.equal(facts.visa.status, "not_available");
  assert.match(facts.visa.evidence, /not offer visa sponsorship/i);

  const dashboard = await jobSearch.getJobSearchDashboard({ view: "all" });
  const publicRecord = dashboard.jobs.find((item) => item.id === job.id);
  assert.equal(publicRecord.cardFacts.posting.host, "jobs.example.com");
  assert.equal(publicRecord.cardFacts.visa.status, "not_available");
});

test("job cards preserve unknown eligibility and compensation instead of inventing facts", () => {
  const facts = cardFacts.buildJobCardFacts({
    canonicalUrl: "https://example.com/jobs/1",
    title: "AI Product Manager",
    company: "",
    description: "Lead AI product strategy and partner with analytics teams.",
    details: {},
  });
  assert.equal(facts.company.label, "Company not identified");
  assert.equal(facts.compensation.status, "not_listed");
  assert.equal(facts.visa.status, "unknown");
});

test("job cards surface explicit cannot-consider-sponsorship language", () => {
  const facts = cardFacts.buildJobCardFacts({
    canonicalUrl: "https://example.com/jobs/2",
    title: "Strategic Performance and Analytics Manager",
    company: "San Bernardino County",
    description: "San Bernardino County is not able to consider candidates who will require visa sponsorship at the time of application or in the future.",
    details: {},
  });
  assert.equal(facts.visa.status, "not_available");
  assert.equal(facts.visa.label, "Sponsorship not available");
});

test("Google Jobs URL selection prefers direct ATS links over aggregators", () => {
  const selected = providers.selectBestJobUrl({
    apply_options: [
      { link: "https://www.linkedin.com/jobs/view/123" },
      { link: "https://jobs.lever.co/example/abc" },
    ],
    share_link: "https://www.google.com/search?q=job",
  });
  assert.equal(selected, "https://jobs.lever.co/example/abc");
});

function mockModelResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function validTriagePayload() {
  return {
    jobs: [{
      sourceId: "router_job",
      evaluation: {
        roleFamilyId: "ai_product_platform",
        relevance: "relevant",
        confidence: 0.91,
        scopeSummary: "Own AI product strategy.",
        codingIntensity: "low",
        seniority: "aligned",
        reasons: ["Product ownership"],
        unknowns: [],
      },
    }],
  };
}

test("free model routing falls back from Cloudflare to Groq GPT-OSS", async () => {
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    GROQ_API_KEY: "test-groq",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "test-cloudflare",
  });
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ZAI_API_KEY;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("api.cloudflare.com")) {
      return mockModelResponse({ error: { message: "Provider unavailable" } }, 503);
    }
    return mockModelResponse({
      model: "openai/gpt-oss-120b",
      choices: [{ message: { content: JSON.stringify(validTriagePayload()) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 80 },
    });
  };
  try {
    const response = await providers.callTriageModel({
      operation: "router_test",
      schema: schemas.triageBatchSchema,
      messages: [{ role: "user", content: "Return the requested JSON for router_job." }],
    });
    assert.equal(response.status, "live");
    assert.equal(response.provider, "groq");
    assert.deepEqual(response.attempts.map((attempt) => attempt.status), ["provider_unavailable", "live"]);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
  }
});

test("invalid structured output falls through to the next free provider", async () => {
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    GROQ_API_KEY: "test-groq",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_API_TOKEN: "test-cloudflare",
  });
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ZAI_API_KEY;
  globalThis.fetch = async (url) => mockModelResponse({
    model: String(url).includes("groq") ? "openai/gpt-oss-120b" : "@cf/meta/llama-3.1-8b-instruct-fast",
    choices: [{
      message: { content: String(url).includes("cloudflare") ? "not-json" : JSON.stringify(validTriagePayload()) },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 100, completion_tokens: 60 },
  });
  try {
    const response = await providers.callTriageModel({
      operation: "invalid_output_test",
      schema: schemas.triageBatchSchema,
      messages: [{ role: "user", content: "Return JSON." }],
    });
    assert.equal(response.provider, "groq");
    assert.deepEqual(response.attempts.map((attempt) => attempt.status), ["invalid_response", "live"]);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
  }
});

test("local llama.cpp route uses schema-constrained OpenAI-compatible calls at zero cost", async () => {
  const originalFetch = globalThis.fetch;
  process.env.JOBSEARCH_LOCAL_LLM_BASE_URL = "http://127.0.0.1:8080/v1";
  process.env.JOBSEARCH_LOCAL_LLM_MODEL = "qwen3-14b";
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return mockModelResponse({
      model: "qwen3-14b",
      choices: [{ message: { content: JSON.stringify(validTriagePayload()) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 90, completion_tokens: 50 },
    });
  };
  try {
    const response = await providers.callLocalModel({
      stage: "triage",
      operation: "local_route_test",
      schema: schemas.triageBatchSchema,
      messages: [{ role: "user", content: "Evaluate router_job." }],
      maxTokens: 500,
    });
    assert.equal(response.status, "live");
    assert.equal(response.provider, "local");
    assert.equal(response.usage.estimatedCostUsd, 0);
    assert.equal(request.url, "http://127.0.0.1:8080/v1/chat/completions");
    assert.match(request.body.messages[0].content, /^\/no_think/);
    assert.equal(request.body.response_format.type, "json_schema");
    assert.equal(
      request.body.response_format.json_schema.schema.properties.jobs.items.properties.evaluation.properties.roleFamilyId.type,
      "string",
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.JOBSEARCH_LOCAL_LLM_BASE_URL;
    delete process.env.JOBSEARCH_LOCAL_LLM_MODEL;
  }
});

test("OpenRouter daily guard blocks before request and paid fallbacks stay disabled", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; return mockModelResponse({}); };
  process.env.OPENROUTER_API_KEY = "test-openrouter";
  process.env.ZAI_API_KEY = "test-zai";
  process.env.JOBSEARCH_OPENROUTER_REQUESTS_PER_DAY = "2";
  delete process.env.GROQ_API_KEY;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.JOBSEARCH_ENABLE_PAID_MODEL_FALLBACKS;
  await repository.recordProviderUsage({ provider: "openrouter", operation: "test", requestCount: 1 });
  await repository.recordProviderUsage({ provider: "openrouter", operation: "test", requestCount: 1 });
  try {
    const response = await providers.callDeepModel({
      operation: "quota_test",
      schema: schemas.deepEvaluationSchema,
      messages: [{ role: "user", content: "Evaluate." }],
    });
    assert.equal(response.status, "quota_blocked");
    assert.equal(fetchCount, 0);
    assert.equal(response.attempts.find((attempt) => attempt.provider === "openrouter").status, "quota_blocked");
    assert.equal(response.attempts.find((attempt) => attempt.provider === "zai").status, "paid_fallback_disabled");
    const quotas = await providers.getFreeProviderQuotaSummary();
    assert.equal(quotas.openrouter.requests, 2);
    assert.equal(quotas.openrouter.requestLimit, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ZAI_API_KEY;
    delete process.env.JOBSEARCH_OPENROUTER_REQUESTS_PER_DAY;
  }
});

test("deep finalist selection prioritizes known title families over exploratory confidence", async () => {
  const exploratory = await seedJob({
    sourceId: "exploratory_high_confidence",
    title: "Account Director",
    details: {
      titleClassification: { lane: "exploratory" },
      triage: { relevance: "relevant", confidence: 0.99, codingIntensity: "low" },
    },
  });
  const known = await seedJob({
    sourceId: "known_title_family",
    title: "AI Product Manager",
    details: {
      titleClassification: { lane: "title_family" },
      triage: { relevance: "relevant", confidence: 0.82, codingIntensity: "low" },
    },
  });
  const selected = await workflow.selectDeepJobIds({
    jobIds: [exploratory.id, known.id],
    includeBacklog: false,
  });
  assert.deepEqual(selected, [known.id, exploratory.id]);
});

test("structured model parsing rejects malformed outputs instead of inventing fallbacks", () => {
  assert.throws(() => schemas.parseStructuredContent(schemas.outreachSchema, "not json"), /JSON object/);
  assert.throws(() => schemas.parseStructuredContent(schemas.outreachSchema, '{"subject":"x"}'));
});

test("triage parsing supplies safe defaults for optional model fields", () => {
  const parsed = schemas.parseStructuredContent(schemas.triageBatchSchema, JSON.stringify({
    jobs: [{
      sourceId: "job_1",
      evaluation: { roleFamilyId: "exploratory", relevance: "uncertain", confidence: 0.7 },
    }],
  }));
  assert.deepEqual(parsed.jobs[0].evaluation.unknowns, []);
  assert.deepEqual(parsed.jobs[0].evaluation.reasons, []);
  assert.equal(parsed.jobs[0].evaluation.codingIntensity, "unknown");
});

test("model confidence accepts fractions, five-point scores, and percentages", () => {
  const base = {
    agrees: true,
    recommendedVerdict: "pass",
    objections: [],
    unsupportedClaims: [],
    summary: "Pass is supported.",
  };
  assert.equal(schemas.criticSchema.parse({ ...base, confidence: 0.8 }).confidence, 0.8);
  assert.equal(schemas.criticSchema.parse({ ...base, confidence: 4 }).confidence, 0.8);
  assert.equal(schemas.criticSchema.parse({ ...base, confidence: 80 }).confidence, 0.8);
});

test("model role-family labels normalize into the eight canonical families", () => {
  assert.equal(schemas.normalizeRoleFamilyId("analytics_manager"), "analytics_leadership");
  assert.equal(schemas.normalizeRoleFamilyId("AI Product Manager"), "ai_product_platform");
  assert.equal(schemas.normalizeRoleFamilyId("AI_Governance_Strategy"), "ai_governance_model_risk");
  assert.equal(schemas.normalizeRoleFamilyId("backend_infrastructure_engineer"), "exploratory");
});
