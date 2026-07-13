import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

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
const workerContract = await import("../server/job-search/worker-contract.js");
const resourceGuard = await import("../scripts/job-search-windows-resource-guard.mjs");
const windowsCollector = await import("../server/job-search/windows-collector.js");

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
  assert.deepEqual(windowsCollector.normalizeCollectorSources(""), ["linkedin", "wellfound", "google", "bing"]);

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
  const linkedInJobs = windowsCollector.extractLinkedInJobsFromHtml(linkedInHtml, { sourceQuery: "linkedin:sample" });
  const wellfoundJobs = windowsCollector.extractWellfoundJobsFromHtml(wellfoundHtml, { sourceQuery: "wellfound:sample" });
  assert.equal(linkedInJobs.length, 1);
  assert.equal(wellfoundJobs.length, 1);
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

test("queue hold and controlled release preserve history and only activate the released cohort", async () => {
  process.env.JOBSEARCH_LOCAL_WORKER_ENABLED = "true";
  try {
    for (let index = 0; index < 15; index += 1) {
      const job = await seedJob({
        sourceId: `held_deep_${index}`,
        status: "deep_review_pending",
        details: {
          triageStatus: "complete",
          triage: { relevance: index < 10 ? "relevant" : "uncertain", confidence: 0.8, codingIntensity: "low" },
        },
      });
      const task = await repository.enqueueLocalTask({ jobId: job.id, taskType: "deep", revision: `deep_${index}` });
      assert.equal(task.status, "queued");
    }
    for (let index = 0; index < 5; index += 1) {
      const job = await seedJob({
        sourceId: `held_critic_${index}`,
        status: "critic_pending",
        details: {
          triageStatus: "complete",
          triage: { relevance: "relevant", confidence: 0.9, codingIntensity: "low" },
          deepStatus: "complete",
          deepEvaluation: { verdict: "apply", overallScore: 90 - index },
        },
      });
      await repository.enqueueLocalTask({ jobId: job.id, taskType: "critic", revision: `critic_${index}` });
    }
    const mismatch = await seedJob({
      sourceId: "clear_mismatch_not_promoted",
      status: "triage_rejected",
      details: {
        triageStatus: "complete",
        triage: { relevance: "irrelevant", confidence: 0.98, codingIntensity: "low" },
      },
    });
    await repository.enqueueLocalTask({ jobId: mismatch.id, taskType: "deep", revision: "mismatch_should_hold" });
    const promoted = await seedJob({
      sourceId: "clear_mismatch_promoted",
      status: "needs_review",
      disposition: "maybe",
      details: {
        triageStatus: "complete",
        triage: { relevance: "irrelevant", confidence: 0.95, codingIntensity: "low" },
      },
    });
    await repository.enqueueLocalTask({ jobId: promoted.id, taskType: "deep", revision: "mismatch_promoted" });

    const held = await workflow.reconcileHeldWindowsQueue({
      operationKey: "hold-operation-001",
      dryRun: false,
      reason: "windows_migration_precalibration",
    });
    assert.equal(held.queueControlAfter.holdNewTasks, true);
    assert.equal(held.queueCounts.after.byStatus.held, 22);

    const release = await workflow.releaseHeldWindowsBacklog({
      operationKey: "release-operation-001",
      dryRun: false,
      limit: 20,
    });
    assert.equal(release.selectedCount, 20);
    assert.equal(release.queueControlAfter.activeReleaseJobIds.length, 20);
    assert.equal(release.selected.some((item) => item.sourceId === "clear_mismatch_not_promoted"), false);
    assert.equal(release.selected.some((item) => item.sourceId === "clear_mismatch_promoted"), true);

    const claim = await repository.claimLocalTask({ workerId: "migration-test-worker" });
    assert.ok(release.queueControlAfter.activeReleaseJobIds.includes(claim.jobId));
    const status = await repository.getLocalWorkerStatus();
    assert.equal(status.queueControl.holdNewTasks, true);
  } finally {
    delete process.env.JOBSEARCH_LOCAL_WORKER_ENABLED;
  }
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
  assert.equal(packet.job.description.length, workerContract.WORKER_LIMITS.maxDescriptionCharacters);
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

test("Windows resource guard permits this model tier and always rejects Qwen3-14B", () => {
  assert.equal(resourceGuard.assertApprovedWindowsModel("Qwen3-4B-Q4_K_M.gguf"), true);
  assert.throws(() => resourceGuard.assertApprovedWindowsModel("Qwen3-14B-Q4_K_M.gguf"), /prohibited/);
  assert.throws(() => resourceGuard.assertApprovedWindowsModel("Qwen3-8B-Q4_K_M.gguf"), /approved only/);
  const evaluation = resourceGuard.evaluateResourceGuard({
    memory: { totalBytes: 16 * (1024 ** 3), availableBytes: 8 * (1024 ** 3) },
    disk: { freeBytes: 100 * (1024 ** 3) },
    cpu: { loadPercent: 25 },
    nvidia: { name: "GTX 1660 Ti", totalVramMiB: 6144, freeVramMiB: 5500 },
  }, { phase: "startup" });
  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.summary.totalVramMiB, 6144);
});

test("ATS detector recognizes Greenhouse, Lever, Ashby, Workday, and SmartRecruiters", () => {
  assert.equal(ats.detectAtsFromUrl("https://boards.greenhouse.io/example/jobs/12345").provider, "greenhouse");
  assert.equal(ats.detectAtsFromUrl("https://jobs.lever.co/example/abc-123").provider, "lever");
  assert.equal(ats.detectAtsFromUrl("https://jobs.ashbyhq.com/example/def-456").provider, "ashby");
  assert.equal(ats.detectAtsFromUrl("https://acme.wd1.myworkdayjobs.com/en-US/External/job/New-York/Director_JR123").provider, "workday");
  assert.equal(ats.detectAtsFromUrl("https://jobs.smartrecruiters.com/Acme/744000012345-director-ai").provider, "smartrecruiters");
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
