import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

let sharedTempDir = null;

async function startServer(options = {}) {
  const { resetPersistence = true, resetAnalytics = true } = options;

  if (!sharedTempDir) {
    sharedTempDir = await mkdtemp(path.join(os.tmpdir(), "tradegraph-api-"));
  }

  const tempDir = sharedTempDir;
  process.env.TRADEGRAPH_DATA_DIR = tempDir;
  delete process.env.DATABASE_URL;
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERT_FROM_EMAIL;
  delete process.env.STRIPE_SECRET_KEY;
  process.env.ALERT_DEFAULT_RECIPIENTS = "arkaprabhagoon95@gmail.com, roydiptopal1996@gmail.com";
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.JOBSEARCH_WORKER_TOKEN = "test-worker-token-with-at-least-32-characters";

  const appModule = await import(`${pathToFileURL(path.resolve("server/app.js")).href}?test=${Date.now()}`);
  const persistenceModule = await import(pathToFileURL(path.resolve("server/persistence.js")).href);
  const analyticsModule = await import(pathToFileURL(path.resolve("server/analytics.js")).href);

  if (resetPersistence) {
    await persistenceModule.updateDb((draft) => {
      draft.users = [];
      draft.sessions = [];
      draft.workspaces = [];
      draft.workspaceMemberships = [];
      draft.workspaceInvites = [];
      draft.state = [];
      draft.sources = [];
      draft.sourceHistory = [];
      draft.dailyMetrics = [];
      draft.alertRules = [];
      draft.subscriptions = [];
      return draft;
    });
    await rm(path.join(tempDir, "job-search-intelligence.json"), { force: true });
  }

  if (resetAnalytics) {
    await analyticsModule.resetAnalyticsStore();
  }

  const server = http.createServer((request, response) => {
    appModule.handleRequest(request, response);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    tempDir,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function jsonFetch(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const payload = await response.json();
  return {
    response,
    payload,
  };
}

async function loadInsightBackend(tempDir) {
  process.env.TRADEGRAPH_DATA_DIR = tempDir;
  delete process.env.DATABASE_URL;
  delete process.env.STRIPE_SECRET_KEY;
  process.env.CRON_SECRET = "test-cron-secret";

  const [persistence, sourceAdapters, insights, verifysme, tenderCatalog, exportCatalog] = await Promise.all([
    import(pathToFileURL(path.resolve("server/persistence.js")).href),
    import(pathToFileURL(path.resolve("server/source-adapters.js")).href),
    import(pathToFileURL(path.resolve("server/insights.js")).href),
    import(pathToFileURL(path.resolve("apps/verifysme/index.js")).href),
    import(pathToFileURL(path.resolve("apps/tenderradar/data/catalog.js")).href),
    import(pathToFileURL(path.resolve("apps/exportpulse/data/catalog.js")).href),
  ]);

  await persistence.updateDb((draft) => {
    draft.users = [];
    draft.sessions = [];
    draft.workspaces = [];
    draft.workspaceMemberships = [];
    draft.workspaceInvites = [];
    draft.state = [];
    draft.sources = [];
    draft.sourceHistory = [];
    draft.dailyMetrics = [];
    draft.alertRules = [];
    draft.subscriptions = [];
    return draft;
  });

  return {
    persistence,
    sourceAdapters,
    insights,
    verifysme,
    tenderCatalog,
    exportCatalog,
  };
}

test("Windows worker endpoints require a token and commit triage results idempotently", async () => {
  const server = await startServer();
  const token = process.env.JOBSEARCH_WORKER_TOKEN;
  const authorization = { authorization: `Bearer ${token}` };

  try {
    const unauthorized = await jsonFetch(server.baseUrl, "/api/job-search/worker/health");
    assert.equal(unauthorized.response.status, 401);

    const health = await jsonFetch(server.baseUrl, "/api/job-search/worker/health", { headers: authorization });
    assert.equal(health.response.status, 200);
    assert.equal(health.payload.concurrency, 1);
    assert.equal(health.payload.paidProvidersEnabled, false);

    const repository = await import(pathToFileURL(path.resolve("server/job-search/repository.js")).href);
    const contract = await import(pathToFileURL(path.resolve("server/job-search/worker-contract.js")).href);
    const workerVersion = contract.REQUIRED_WORKER_VERSION;
    const job = await repository.upsertJob({
      sourceId: `api_worker_${Date.now()}`,
      canonicalUrl: "https://example.com/jobs/windows-worker",
      title: "AI Product Lead",
      normalizedTitle: "ai product lead",
      company: "Example",
      location: "Remote",
      description: "Lead AI product strategy and work with engineering partners.",
      postedAt: null,
      sourceProvider: "test",
      sourceQuery: "fixture",
      contentHash: `api_worker_hash_${Date.now()}`,
      roleFamilyId: "ai_product_platform",
      status: "triage_pending",
      details: {},
    });
    await repository.enqueueLocalTask({ jobId: job.id, taskType: "triage", revision: "api-worker-test" });

    const claim = await jsonFetch(server.baseUrl, "/api/job-search/worker/claim", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ workerId: "test-windows-worker", version: "outdated-worker-v1" }),
    });
    assert.equal(claim.response.status, 409);

    const compatibleClaim = await jsonFetch(server.baseUrl, "/api/job-search/worker/claim", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ workerId: "test-windows-worker", version: workerVersion }),
    });
    assert.equal(compatibleClaim.response.status, 200);
    assert.equal(compatibleClaim.payload.task.taskType, "triage");
    assert.match(compatibleClaim.payload.task.leaseToken, /^lease_/);
    assert.equal(JSON.stringify(compatibleClaim.payload.packet).includes("DATABASE_URL"), false);

    const output = {
      triage: {
        roleFamilyId: "ai_product_platform",
        relevance: "relevant",
        confidence: 0.95,
        scopeSummary: "AI product leadership.",
        codingIntensity: "low",
        seniority: "aligned",
        reasons: ["Product leadership"],
        unknowns: ["Compensation"],
      },
    };
    const resultId = contract.workerResultId(compatibleClaim.payload.task.taskKey, output);
    const resultBody = {
      workerId: "test-windows-worker",
      version: workerVersion,
      taskId: compatibleClaim.payload.task.id,
      leaseToken: compatibleClaim.payload.task.leaseToken,
      resultId,
      model: "Qwen3-4B-Q4_K_M",
      output,
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const completion = await jsonFetch(server.baseUrl, "/api/job-search/worker/result", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify(resultBody),
    });
    assert.equal(completion.response.status, 200);
    assert.equal(completion.payload.idempotent, false);

    const replay = await jsonFetch(server.baseUrl, "/api/job-search/worker/result", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify(resultBody),
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.idempotent, true);
    assert.equal((await repository.getJob(job.id)).details.triageStatus, "complete");
  } finally {
    await server.close();
  }
});

test("worker token can hold and release a bounded calibration cohort", async () => {
  process.env.JOBSEARCH_LOCAL_WORKER_ENABLED = "true";
  const server = await startServer();
  const authorization = { authorization: `Bearer ${process.env.JOBSEARCH_WORKER_TOKEN}` };

  try {
    const repository = await import(pathToFileURL(path.resolve("server/job-search/repository.js")).href);
    const job = await repository.upsertJob({
      sourceId: `api_queue_control_${Date.now()}`,
      canonicalUrl: "https://example.com/jobs/calibration-control",
      title: "Director, AI Strategy",
      normalizedTitle: "director ai strategy",
      company: "Example Fintech",
      location: "Remote",
      description: "Lead AI strategy for a financial-services product portfolio.",
      postedAt: null,
      sourceProvider: "test",
      sourceQuery: "fixture",
      contentHash: `api_queue_control_hash_${Date.now()}`,
      roleFamilyId: "data_ai_strategy",
      status: "triaged",
      details: {
        triageStatus: "complete",
        triage: { relevance: "relevant", confidence: 0.9 },
      },
    });
    await repository.enqueueLocalTask({ jobId: job.id, taskType: "deep", revision: "api-queue-control-test" });

    const unauthorized = await jsonFetch(server.baseUrl, "/api/job-search/worker/queue/hold", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "worker-hold-unauthorized" }),
    });
    assert.equal(unauthorized.response.status, 401);

    const hold = await jsonFetch(server.baseUrl, "/api/job-search/worker/queue/hold", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "worker-hold-authorized" }),
    });
    assert.equal(hold.response.status, 200);
    assert.equal(hold.payload.queueControlAfter.holdNewTasks, true);
    assert.equal(hold.payload.queueCounts.after.byStatus.held, 1);

    const release = await jsonFetch(server.baseUrl, "/api/job-search/worker/queue/release", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "worker-release-authorized", limit: 1 }),
    });
    assert.equal(release.response.status, 200);
    assert.equal(release.payload.selectedCount, 1);
    assert.equal(release.payload.selected[0].jobId, job.id);

    const [releasedTask] = await repository.listLocalTasks({ taskTypes: ["deep"] });
    await repository.setLocalTaskStatus(releasedTask.id, {
      status: "failed",
      lastError: "Historic context-window failure",
    });
    const retryFailed = await jsonFetch(server.baseUrl, "/api/job-search/worker/queue/retry-failed", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "worker-retry-failed-authorized", limit: 10 }),
    });
    assert.equal(retryFailed.response.status, 200);
    assert.equal(retryFailed.payload.selectedCount, 1);
    assert.equal(retryFailed.payload.retriedCount, 1);
    const replay = await jsonFetch(server.baseUrl, "/api/job-search/worker/queue/retry-failed", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "worker-retry-failed-authorized", limit: 10 }),
    });
    assert.deepEqual(replay.payload, retryFailed.payload);

    const resume = await jsonFetch(server.baseUrl, "/api/job-search/worker/queue/resume", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "worker-resume-authorized" }),
    });
    assert.equal(resume.response.status, 200);
    assert.equal(resume.payload.queueControlAfter.holdNewTasks, false);

    await repository.setLocalTaskStatus(releasedTask.id, {
      status: "failed",
      lastError: "Recover after normal processing resumed",
    });
    const retryAfterResume = await jsonFetch(server.baseUrl, "/api/job-search/worker/queue/retry-failed", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "worker-retry-after-resume", limit: 10 }),
    });
    assert.equal(retryAfterResume.payload.selectedCount, 1);
    assert.equal(retryAfterResume.payload.retriedCount, 1);
  } finally {
    await server.close();
  }
});

test("collector batches stay server-side, idempotent, and respect held local queue state", async () => {
  process.env.JOBSEARCH_LOCAL_WORKER_ENABLED = "true";
  const server = await startServer();
  const token = process.env.JOBSEARCH_WORKER_TOKEN;
  const authorization = { authorization: `Bearer ${token}` };

  try {
    const repository = await import(pathToFileURL(path.resolve("server/job-search/repository.js")).href);
    await repository.setLocalQueueControl({
      holdNewTasks: true,
      holdReason: "windows_migration_precalibration",
      activeReleaseJobIds: [],
    });

    const batchBody = {
      operationKey: "collector-batch-001",
      collectorRunId: "jsrun_collector_fixture_001",
      collectorRunLabel: "Fixture collector",
      final: true,
      selectedSources: ["linkedin", "google"],
      sourceHealth: [
        { sourceId: "linkedin", status: "live", pagesVisited: 2, resultCount: 4, jobCount: 1, blocked: false, errors: [], notes: "", sampleUrls: ["https://www.linkedin.com/jobs/view/4437322106/"] },
        { sourceId: "google", status: "empty", pagesVisited: 1, resultCount: 0, jobCount: 0, blocked: false, errors: [], notes: "", sampleUrls: [] },
      ],
      leads: [{
        url: "https://www.linkedin.com/jobs/view/4437322106/",
        title: "Director, AI Strategy",
        company: "Example Fintech",
        location: "Remote",
        postedAt: null,
        postedAtRaw: "6 hours ago",
        sourceProvider: "linkedin",
        sourceQuery: "analytics",
        snippet: "Lead AI strategy and analytics programs.",
        externalId: "4437322106",
        status: "extraction_pending",
        ontology: { eligible: true },
        raw: {},
      }],
      jobs: [{
        sourceId: "collector_job_fixture_001",
        title: "Director, AI Strategy",
        company: "Example Fintech",
        description: "Lead AI strategy and analytics programs across financial-services products.",
        url: "https://jobs.lever.co/example/abc123",
        canonicalUrl: "https://jobs.lever.co/example/abc123",
        location: "Remote",
        postedAt: null,
        postedAtRaw: "6 hours ago",
        sourceProvider: "linkedin",
        sourceQuery: "analytics",
        raw: { collector: { portalId: "4437322106", atsId: "abc123" } },
      }],
      errors: [],
    };

    const first = await jsonFetch(server.baseUrl, "/api/job-search/worker/discovery-batch", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify(batchBody),
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.counts.changedJobs, 1);
    assert.equal(first.payload.counts.localQueued, 1);

    const replay = await jsonFetch(server.baseUrl, "/api/job-search/worker/discovery-batch", {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify(batchBody),
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.counts.changedJobs, 1);

    const tasks = await repository.listLocalTasks({ limit: 20 });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, "held");
    const run = await repository.getRun("jsrun_collector_fixture_001");
    assert.equal(run.providers.collector.sources.linkedin.status, "live");
    assert.equal(run.providers.collector.sources.google.status, "empty");
  } finally {
    delete process.env.JOBSEARCH_LOCAL_WORKER_ENABLED;
    await server.close();
  }
});

test("owner queue hold and release routes are authenticated, idempotent, and dry-run aware", async () => {
  process.env.JOBSEARCH_ALLOW_ANY_SIGNED_IN = "true";
  process.env.JOBSEARCH_LOCAL_WORKER_ENABLED = "true";
  const server = await startServer();

  try {
    const sessionResult = await jsonFetch(server.baseUrl, "/api/demo-login", { method: "POST" });
    const cookie = sessionResult.response.headers.get("set-cookie");
    const repository = await import(pathToFileURL(path.resolve("server/job-search/repository.js")).href);

    for (let index = 0; index < 22; index += 1) {
      const job = await repository.upsertJob({
        sourceId: `api_release_${index}`,
        canonicalUrl: `https://example.com/jobs/${index}`,
        title: "Director, AI Strategy",
        normalizedTitle: "director ai strategy",
        company: `Example ${index}`,
        location: "Remote",
        description: "Lead AI strategy and analytics programs across financial-services products.",
        postedAt: null,
        sourceProvider: "test",
        sourceQuery: "fixture",
        contentHash: `api_release_hash_${index}`,
        roleFamilyId: "ai_product_platform",
        status: index < 18 ? "deep_review_pending" : "critic_pending",
        details: index < 18
          ? { triageStatus: "complete", triage: { relevance: index < 12 ? "relevant" : "uncertain", confidence: 0.85, codingIntensity: "low" } }
          : {
            triageStatus: "complete",
            triage: { relevance: "relevant", confidence: 0.92, codingIntensity: "low" },
            deepStatus: "complete",
            deepEvaluation: { verdict: "apply", overallScore: 88 - index },
          },
      });
      await repository.enqueueLocalTask({ jobId: job.id, taskType: index < 18 ? "deep" : "critic", revision: `api_release_task_${index}` });
    }

    const hold = await jsonFetch(server.baseUrl, "/api/job-search/local-queue/hold", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "hold-route-001", dryRun: false }),
    });
    assert.equal(hold.response.status, 200);
    assert.equal(hold.payload.queueControlAfter.holdNewTasks, true);

    const dryRun = await jsonFetch(server.baseUrl, "/api/job-search/local-queue/release", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "release-route-dryrun-001", dryRun: true, limit: 20 }),
    });
    assert.equal(dryRun.response.status, 200);
    assert.equal(dryRun.payload.selectedCount, 20);

    const release = await jsonFetch(server.baseUrl, "/api/job-search/local-queue/release", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "release-route-001", dryRun: false, limit: 20 }),
    });
    assert.equal(release.response.status, 200);
    assert.equal(release.payload.selectedCount, 20);

    const replay = await jsonFetch(server.baseUrl, "/api/job-search/local-queue/release", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ operationKey: "release-route-001", dryRun: false, limit: 20 }),
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.selectedCount, 20);
    assert.equal(replay.payload.queueControlAfter.activeReleaseJobIds.length, 20);
  } finally {
    delete process.env.JOBSEARCH_ALLOW_ANY_SIGNED_IN;
    delete process.env.JOBSEARCH_LOCAL_WORKER_ENABLED;
    await server.close();
  }
});

test("workspace auth, alerts, and simulated billing work end to end", async () => {
  const server = await startServer();

  try {
    const sessionResult = await jsonFetch(server.baseUrl, "/api/demo-login", {
      method: "POST",
    });
    const cookie = sessionResult.response.headers.get("set-cookie");

    assert.equal(sessionResult.response.status, 200);
    assert.ok(cookie?.includes("tradegraph_session="));

    const alertsBefore = await jsonFetch(server.baseUrl, "/api/alerts", {
      headers: {
        cookie,
      },
    });

    assert.equal(alertsBefore.payload.rules.length, 0);

    const createAlertResult = await jsonFetch(server.baseUrl, "/api/alerts", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        label: "Cold chain watch",
        product: "tenderradar",
        filters: {
          query: "cold chain, reefer",
          sourceKeys: ["gem"],
        },
        recipients: ["demo@tradegraph.local"],
      }),
    });

    assert.equal(createAlertResult.response.status, 200);
    assert.equal(createAlertResult.payload.rule.label, "Cold chain watch");
    assert.deepEqual(createAlertResult.payload.rule.recipients, [
      "demo@tradegraph.local",
      "arkaprabhagoon95@gmail.com",
      "roydiptopal1996@gmail.com",
    ]);

    const alertsAfter = await jsonFetch(server.baseUrl, "/api/alerts", {
      headers: {
        cookie,
      },
    });

    assert.equal(alertsAfter.payload.rules.length, 1);
    assert.equal(alertsAfter.payload.subscription.planKey, "free");

    const checkoutResult = await jsonFetch(server.baseUrl, "/api/billing-checkout", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        planKey: "pro",
        billingEmail: "demo@tradegraph.local",
      }),
    });

    assert.equal(checkoutResult.response.status, 200);
    assert.equal(checkoutResult.payload.mode, "simulated");
    assert.equal(checkoutResult.payload.subscription.planKey, "pro");

    const billingResult = await jsonFetch(server.baseUrl, "/api/billing", {
      headers: {
        cookie,
      },
    });

    assert.equal(billingResult.response.status, 200);
    assert.equal(billingResult.payload.subscription.planKey, "pro");
    assert.equal(billingResult.payload.subscription.status, "active");
  } finally {
    await server.close();
  }
});

test("cross-site browser mutations are rejected", async () => {
  const server = await startServer();

  try {
    const sessionResult = await jsonFetch(server.baseUrl, "/api/demo-login", {
      method: "POST",
    });
    const cookie = sessionResult.response.headers.get("set-cookie");

    const blocked = await jsonFetch(server.baseUrl, "/api/alerts", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        label: "Blocked cross-site write",
        product: "tenderradar",
        filters: {
          query: "cold chain",
          sourceKeys: ["gem"],
        },
      }),
    });

    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.payload.error, "Cross-site mutation blocked.");
  } finally {
    await server.close();
  }
});

test("same-host local browser mutations work when APP_URL points at production", async () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://production.example";
  const server = await startServer();

  try {
    const result = await jsonFetch(server.baseUrl, "/api/demo-login", {
      method: "POST",
      headers: {
        origin: server.baseUrl,
      },
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.payload.ok, true);
  } finally {
    if (previousAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousAppUrl;
    }
    await server.close();
  }
});

test("lead capture persists even when email delivery is unavailable", async () => {
  const server = await startServer();

  try {
    const leadResult = await jsonFetch(server.baseUrl, "/api/leads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Operator Buyer",
        email: "buyer@example.com",
        company: "Northstar Exports",
        reason: "operator-buyer",
        product: "TradeGraph",
        sourcePage: "/contact.html",
        timeline: "This quarter",
        message: "Interested in the supplier -> tender -> export workflow for a live team.",
      }),
    });

    assert.equal(leadResult.response.status, 200);
    assert.equal(leadResult.payload.ok, true);
    assert.ok(leadResult.payload.requestId.startsWith("TG-"));
    assert.equal(leadResult.payload.delivery.mode, "saved_only");
  } finally {
    await server.close();
  }
});

test("analytics events persist, infer products, and summarize authenticated vs anonymous usage", async () => {
  const server = await startServer();

  try {
    const anonymousIngest = await jsonFetch(server.baseUrl, "/api/analytics/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "tenderradar_viewed",
        anonymousId: "anon_public_1",
        path: "/tradegraph/app/tenderradar/pipeline.html",
        payload: {
          page: "pipeline",
        },
        createdAt: "2026-04-18T12:00:00.000Z",
      }),
    });

    assert.equal(anonymousIngest.response.status, 200);
    assert.equal(anonymousIngest.payload.event.product, "tenderradar");
    assert.equal(anonymousIngest.payload.event.workspaceId, null);

    const sessionResult = await jsonFetch(server.baseUrl, "/api/demo-login", {
      method: "POST",
    });
    const cookie = sessionResult.response.headers.get("set-cookie");

    const authenticatedIngest = await jsonFetch(server.baseUrl, "/api/analytics/events", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        product: "tenderradar",
        name: "tenderradar_shortlist_toggled",
        path: "/tradegraph/app/tenderradar/opportunities.html",
        payload: {
          saved: true,
        },
        createdAt: "2026-04-18T12:05:00.000Z",
      }),
    });

    assert.equal(authenticatedIngest.response.status, 200);
    assert.equal(authenticatedIngest.payload.event.product, "tenderradar");
    assert.ok(authenticatedIngest.payload.event.workspaceId);

    const suiteIngest = await jsonFetch(server.baseUrl, "/api/analytics/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "suite_profile_switched",
        payload: {
          profileId: "atlaspack",
        },
        createdAt: "2026-04-18T12:10:00.000Z",
      }),
    });

    assert.equal(suiteIngest.response.status, 200);
    assert.equal(suiteIngest.payload.event.product, "tradegraph");

    const summaryResult = await jsonFetch(server.baseUrl, "/api/analytics/summary");

    assert.equal(summaryResult.response.status, 200);
    assert.equal(summaryResult.payload.summary.totalEvents, 3);
    assert.equal(summaryResult.payload.summary.authenticatedEvents, 1);
    assert.equal(summaryResult.payload.summary.anonymousEvents, 2);
    assert.equal(summaryResult.payload.summary.uniqueProducts, 2);
    assert.equal(summaryResult.payload.summary.latestEvent.name, "suite_profile_switched");
    assert.equal(summaryResult.payload.summary.timeline.length, 1);
    assert.deepEqual(summaryResult.payload.summary.timeline[0], {
      day: "2026-04-18",
      count: 3,
    });
    assert.deepEqual(summaryResult.payload.summary.byProduct, [
      {
        product: "tenderradar",
        count: 2,
        lastEventAt: "2026-04-18T12:05:00.000Z",
      },
      {
        product: "tradegraph",
        count: 1,
        lastEventAt: "2026-04-18T12:10:00.000Z",
      },
    ]);

    const filteredSummary = await jsonFetch(server.baseUrl, "/api/analytics/summary?product=tenderradar");

    assert.equal(filteredSummary.response.status, 200);
    assert.equal(filteredSummary.payload.filters.product, "tenderradar");
    assert.equal(filteredSummary.payload.summary.totalEvents, 2);
    assert.equal(filteredSummary.payload.summary.authenticatedEvents, 1);
    assert.equal(filteredSummary.payload.summary.anonymousEvents, 1);
    assert.equal(filteredSummary.payload.summary.latestEvent.name, "tenderradar_shortlist_toggled");
    assert.deepEqual(filteredSummary.payload.summary.byEvent, [
      {
        product: "tenderradar",
        name: "tenderradar_shortlist_toggled",
        count: 1,
        lastEventAt: "2026-04-18T12:05:00.000Z",
      },
      {
        product: "tenderradar",
        name: "tenderradar_viewed",
        count: 1,
        lastEventAt: "2026-04-18T12:00:00.000Z",
      },
    ]);
  } finally {
    await server.close();
  }
});

test("analytics validation failures return 400s", async () => {
  const server = await startServer();

  try {
    const missingName = await jsonFetch(server.baseUrl, "/api/analytics/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        product: "tenderradar",
        payload: {},
      }),
    });

    assert.equal(missingName.response.status, 400);
    assert.equal(missingName.payload.error, "Event name is required.");

    const badSummaryRange = await jsonFetch(
      server.baseUrl,
      "/api/analytics/summary?since=2026-04-19T00:00:00.000Z&until=2026-04-18T00:00:00.000Z",
    );

    assert.equal(badSummaryRange.response.status, 400);
    assert.equal(badSummaryRange.payload.error, "since must be before until.");
  } finally {
    await server.close();
  }
});

test("analytics ingestion is idempotent when the browser retries an event", async () => {
  const server = await startServer();

  try {
    const event = {
      id: "evt_retry_fixture",
      product: "tradegraph",
      name: "workspace_signed_in",
      path: "/job-search",
      createdAt: "2026-07-11T13:30:00.000Z",
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await jsonFetch(server.baseUrl, "/api/analytics/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
      assert.equal(result.response.status, 200);
    }

    const summary = await jsonFetch(server.baseUrl, "/api/analytics/summary");
    assert.equal(summary.payload.summary.totalEvents, 1);
  } finally {
    await server.close();
  }
});

test("analytics summaries survive a server restart when the local JSON fallback is in use", async () => {
  let server = await startServer();

  try {
    const ingestResult = await jsonFetch(server.baseUrl, "/api/analytics/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        product: "exportpulse",
        name: "exportpulse_viewed",
        path: "/tradegraph/app/exportpulse/route-pipeline.html",
        createdAt: "2026-04-18T14:30:00.000Z",
      }),
    });

    assert.equal(ingestResult.response.status, 200);
  } finally {
    await server.close();
  }

  server = await startServer({ resetAnalytics: false });

  try {
    const summaryResult = await jsonFetch(server.baseUrl, "/api/analytics/summary");

    assert.equal(summaryResult.response.status, 200);
    assert.equal(summaryResult.payload.summary.totalEvents, 1);
    assert.deepEqual(summaryResult.payload.summary.byProduct, [
      {
        product: "exportpulse",
        count: 1,
        lastEventAt: "2026-04-18T14:30:00.000Z",
      },
    ]);
    assert.equal(summaryResult.payload.summary.latestEvent.name, "exportpulse_viewed");
  } finally {
    await server.close();
  }
});

test("signed-in users can parse copied official MCA master-data content", async () => {
  const server = await startServer();

  try {
    const sessionResult = await jsonFetch(server.baseUrl, "/api/demo-login", {
      method: "POST",
    });
    const cookie = sessionResult.response.headers.get("set-cookie");

    const parseResult = await jsonFetch(server.baseUrl, "/api/mca-parse", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: `
          CIN
          U74140DL2011PTC275905
          Company Name
          ASCLEPIUS WELLNESS PRIVATE LIMITED
          ROC Code
          RoC-Delhi
          Company Status(for efiling)
          Active
          Directors/Signatory Details
          DIN/PAN
          Name
          Begin date
          End date
          Surrendered DIN
          01234567
          ROY DEY
          12/10/2011
          -
          No
        `,
      }),
    });

    assert.equal(parseResult.response.status, 200);
    assert.equal(parseResult.payload.cin, "U74140DL2011PTC275905");
    assert.equal(parseResult.payload.companyName, "ASCLEPIUS WELLNESS PRIVATE LIMITED");
    assert.equal(parseResult.payload.directors.length, 1);
  } finally {
    await server.close();
  }
});

test("signed-in users can parse copied official MCA Find CIN results", async () => {
  const server = await startServer();

  try {
    const sessionResult = await jsonFetch(server.baseUrl, "/api/demo-login", {
      method: "POST",
    });
    const cookie = sessionResult.response.headers.get("set-cookie");

    const parseResult = await jsonFetch(server.baseUrl, "/api/mca-find-cin-parse", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: `
          Company Name
          CIN
          Status
          ASCLEPIUS WELLNESS PRIVATE LIMITED
          U74140DL2011PTC275905
          Active
        `,
      }),
    });

    assert.equal(parseResult.response.status, 200);
    assert.equal(parseResult.payload.candidateCount, 1);
    assert.equal(parseResult.payload.candidates[0].cin, "U74140DL2011PTC275905");
  } finally {
    await server.close();
  }
});

test("signed-in users can parse copied official Udyam certificate content", async () => {
  const server = await startServer();

  try {
    const sessionResult = await jsonFetch(server.baseUrl, "/api/demo-login", {
      method: "POST",
    });
    const cookie = sessionResult.response.headers.get("set-cookie");

    const parseResult = await jsonFetch(server.baseUrl, "/api/udyam-certificate-parse", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: `
          UDYAM REGISTRATION NUMBER
          UDYAM-DL-10-0006405
          NAME OF ENTERPRISE
          ASCLEPIUS WELLNESS PRIVATE LIMITED
          ORGANISATION TYPE
          Private Limited Company
          MAJOR ACTIVITY
          Manufacturing
          OFFICAL ADDRESS OF ENTERPRISE
          A-1, Example Road, New Delhi, Delhi, 110001
          DATE OF UDYAM REGISTRATION
          27/01/2021
        `,
      }),
    });

    assert.equal(parseResult.response.status, 200);
    assert.equal(parseResult.payload.registrationNumber, "UDYAM-DL-10-0006405");
    assert.equal(parseResult.payload.enterpriseName, "ASCLEPIUS WELLNESS PRIVATE LIMITED");
  } finally {
    await server.close();
  }
});

test("source sync appends source history and daily metrics on every run", async () => {
  const server = await startServer();
  const backend = await loadInsightBackend(server.tempDir);

  try {
    const fakeAdapters = [
      async () => ({
        key: "gem",
        label: "GeM BidPlus",
        status: "live",
        checkedAt: "2026-03-31T10:00:00.000Z",
        itemCount: 3,
        items: [{ id: "gem-1" }, { id: "gem-2" }, { id: "gem-3" }],
        note: "Live feed",
        evidence: "Fixture",
      }),
      async () => ({
        key: "cppp",
        label: "CPPP ePublishing",
        status: "restricted",
        checkedAt: "2026-03-31T10:00:00.000Z",
        itemCount: 2,
        items: [{ id: "cppp-1" }, { id: "cppp-2" }],
        note: "Restricted feed",
        evidence: "Fixture",
      }),
    ];

    await backend.sourceAdapters.syncAllSources({ adapters: fakeAdapters });
    let db = await backend.persistence.readDb();

    assert.equal(db.sources.length, 2);
    assert.equal(db.sourceHistory.length, 2);
    assert.equal(db.dailyMetrics.length, 4);
    assert.ok(db.sourceHistory.every((item) => item.syncId));
    assert.ok(db.dailyMetrics.every((item) => item.syncId));

    await backend.sourceAdapters.syncAllSources({ adapters: fakeAdapters });
    db = await backend.persistence.readDb();

    assert.equal(db.sources.length, 2);
    assert.equal(db.sourceHistory.length, 4);
    assert.equal(db.dailyMetrics.length, 8);
  } finally {
    await server.close();
  }
});

test("insight helpers keep a frontend-friendly fallback and persisted shape", async () => {
  const server = await startServer();
  const backend = await loadInsightBackend(server.tempDir);

  try {
    const verifyFallback = await backend.insights.buildProductInsightResponse("verifysme", {
      searchParams: new URLSearchParams(),
    });
    const tenderFallback = await backend.insights.buildProductInsightResponse("tenderradar", {
      searchParams: new URLSearchParams(),
    });
    const exportFallback = await backend.insights.buildProductInsightResponse("exportpulse", {
      searchParams: new URLSearchParams(),
    });

    assert.equal(verifyFallback.charts.evidenceFreshness.data[0].label, "No synced sources yet");
    assert.equal(tenderFallback.charts.closingBuckets.data[0].bucket, "0-7 days");
    assert.equal(exportFallback.charts.noticeTimeline.data[0].title, "No DGFT notices synced yet");
    assert.equal(verifyFallback.provenance.dataMode, "fallback");
    assert.equal(tenderFallback.provenance.dataMode, "fallback");
    assert.equal(exportFallback.provenance.dataMode, "fallback");

    const verifySupplier = backend.verifysme.supplierProfiles[1] || backend.verifysme.supplierProfiles[0];
    const tenderProfile = backend.tenderCatalog.tenderProfiles[1] || backend.tenderCatalog.tenderProfiles[0];
    const exportProfile = backend.exportCatalog.exportProfiles[1] || backend.exportCatalog.exportProfiles[0];
    const workspaceId = "ws_demo";
    const userId = "user_demo";
    const now = "2026-03-31T10:00:00.000Z";

    await backend.persistence.updateDb((draft) => {
      draft.users.push({
        id: userId,
        name: "Demo User",
        email: "demo@example.com",
        passwordSalt: "salt",
        passwordHash: "hash",
        createdAt: now,
      });
      draft.workspaces.push({
        id: workspaceId,
        ownerUserId: userId,
        userId,
        name: "Demo Workspace",
        isDefault: false,
        createdAt: now,
      });
      draft.workspaceMemberships.push({
        id: "membership_demo",
        workspaceId,
        userId,
        role: "owner",
        createdAt: now,
      });
      draft.state.push({
        workspaceId,
        namespace: "verifysme.workspace",
        value: {
          selectedSupplierId: verifySupplier.id,
          shortlistIds: [verifySupplier.id],
          filters: {
            sector: verifySupplier.sector,
            state: verifySupplier.state,
          },
        },
        updatedAt: now,
      });
      draft.state.push({
        workspaceId,
        namespace: "tenderradar.workspace",
        value: {
          profileId: tenderProfile.id,
          shortlistIds: [tenderProfile.id],
          workflow: {},
        },
        updatedAt: now,
      });
      draft.state.push({
        workspaceId,
        namespace: "exportpulse.workspace",
        value: {
          profileId: exportProfile.id,
          shortlistIds: [exportProfile.id],
          workflow: {},
        },
        updatedAt: now,
      });
      return draft;
    });

    await backend.sourceAdapters.syncAllSources({
      adapters: [
        async () => ({
          key: "gem",
          label: "GeM BidPlus",
          status: "live",
          checkedAt: "2026-03-31T10:00:00.000Z",
          itemCount: 3,
          items: [
            {
              id: "gem-1",
              externalId: "9015237",
              bidNumber: "GEM/2026/B/7264989",
              ministry: "Ministry of Education",
              department: "Department of Higher Education",
              category: "GlobalTenderCategory",
              documentUrl: "https://bidplus-global.gem.gov.in/showbidDocument/9015237/FebQ126/3",
            },
          ],
          note: "Live feed",
          evidence: "Fixture",
        }),
        async () => ({
          key: "cppp",
          label: "CPPP ePublishing",
          status: "live",
          checkedAt: "2026-03-31T10:00:00.000Z",
          itemCount: 2,
          items: [
            {
              id: "cppp-1",
              serial: 1,
              publishedAt: "25-Mar-2026 05:00 PM",
              closingAt: "01-Apr-2026 09:00 AM",
              openingAt: "01-Apr-2026 09:00 AM",
              detailUrl: "https://www.eprocure.gov.in/epublish/app?tender=1",
              title: "Supply Installation and Commissioning of Vertical Turbine Pump Sets",
              referenceNumber: "RGCB/PUR/1835/25/1756",
              tenderId: "2026_MST_833413_1",
              organization: "Rajiv Gandhi Centre for Biotechnology",
            },
          ],
          note: "Live feed",
          evidence: "Fixture",
        }),
        async () => ({
          key: "dgft",
          label: "DGFT Trade Notices",
          status: "live",
          checkedAt: "2026-03-31T10:00:00.000Z",
          itemCount: 2,
          items: [
            {
              noticeNumber: "31/2025-2026",
              noticeYear: "2025-2026",
              title: "Guidelines for Credit Assistance for E-Commerce Exporters under Export Promotion Mission (EPM)",
              noticeDate: "06/03/2026",
              pdfUrl: "https://content.dgft.gov.in/notice-31.pdf",
            },
            {
              noticeNumber: "26/2025-26",
              noticeYear: "2025-26",
              title: "Guidelines for Trade Regulations, Accreditation and Compliance Enablement (TRACE) under Export Promotion Mission (EPM)",
              noticeDate: "20/02/2026",
              pdfUrl: "https://content.dgft.gov.in/notice-26.pdf",
            },
          ],
          note: "Live feed",
          evidence: "Fixture",
        }),
      ],
    });

    const sessionContext = {
      user: {
        id: userId,
        name: "Demo User",
        email: "demo@example.com",
      },
      workspace: {
        id: workspaceId,
      },
      workspaces: [
        {
          id: workspaceId,
        },
      ],
    };
    const query = new URLSearchParams({ workspaceId });

    const [verify, tender, exportPulse] = await Promise.all([
      backend.insights.buildProductInsightResponse("verifysme", {
        sessionContext,
        searchParams: query,
      }),
      backend.insights.buildProductInsightResponse("tenderradar", {
        sessionContext,
        searchParams: query,
      }),
      backend.insights.buildProductInsightResponse("exportpulse", {
        sessionContext,
        searchParams: query,
      }),
    ]);

    assert.equal(verify.filters.workspaceId, workspaceId);
    assert.equal(verify.filters.profileId, verifySupplier.id);
    assert.equal(tender.filters.workspaceId, workspaceId);
    assert.equal(tender.filters.profileId, tenderProfile.id);
    assert.equal(exportPulse.filters.workspaceId, workspaceId);
    assert.equal(exportPulse.filters.profileId, exportProfile.id);
    assert.equal(verify.provenance.dataMode, "source-derived");
    assert.equal(verify.provenance.sourceHistoryCount, 3);
    assert.equal(tender.provenance.sourceHistoryCount, 3);
    assert.equal(exportPulse.provenance.sourceHistoryCount, 3);
    assert.equal(tender.provenance.dataMode, "source-derived");
    assert.equal(exportPulse.provenance.dataMode, "source-derived");
    assert.ok(verify.summary);
    assert.ok(Array.isArray(verify.explainability.factors));
    assert.ok(Array.isArray(verify.nextActions));
    assert.ok(verify.charts.trustFunnel.data.length > 0);
    assert.ok(verify.charts.factorContributions.data.length > 0);
    assert.ok(verify.charts.queueAging.data.length > 0);
    assert.ok(verify.entities.inventory.length > 0);
    assert.ok(verify.entities.visible.length > 0);
    assert.ok(tender.summary);
    assert.ok(Array.isArray(tender.explainability.factors));
    assert.ok(Array.isArray(tender.nextActions));
    assert.ok(tender.charts.qualificationFunnel.data.length > 0);
    assert.ok(tender.charts.valueVsCapacity.data.length > 0);
    assert.ok(tender.charts.factorContributions.data.length > 0);
    assert.ok(tender.entities.visible.length > 0);
    assert.ok(exportPulse.summary);
    assert.ok(Array.isArray(exportPulse.explainability.factors));
    assert.ok(Array.isArray(exportPulse.nextActions));
    assert.ok(exportPulse.charts.readinessMatrix.data.length > 0);
    assert.ok(exportPulse.charts.actionBurnup.data.length > 0);
    assert.ok(exportPulse.charts.factorContributions.data.length > 0);
    assert.ok(exportPulse.entities.visible.length > 0);
  } finally {
    await server.close();
  }
});
