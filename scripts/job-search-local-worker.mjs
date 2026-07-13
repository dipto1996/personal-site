#!/usr/bin/env node

import os from "node:os";
import path from "node:path";

import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env.local"), override: false, quiet: true });
loadEnv({ path: path.join(process.cwd(), ".env"), override: false, quiet: true });

process.env.JOBSEARCH_LOCAL_LLM_BASE_URL ||= "http://127.0.0.1:8080/v1";
process.env.JOBSEARCH_LOCAL_LLM_MODEL ||= "qwen3-14b";

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const item = [...args].find((argument) => argument.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
};
const once = args.has("--once");
const enqueueOnly = args.has("--enqueue-only");
const maxTasks = Number(valueArg("--max-tasks", once ? "1" : "0"));
const pollMs = Number(valueArg("--poll-ms", "15000"));
const workerId = valueArg("--worker-id", `${os.hostname()}:${process.pid}`);
const WORKER_VERSION = "local-qwen-worker-2026-07-11.v1";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Run `vercel env pull .env.local` before starting the worker.");
}

const [repository, workflow] = await Promise.all([
  import("../server/job-search/repository.js"),
  import("../server/job-search/workflow.js"),
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function modelHealth() {
  const base = process.env.JOBSEARCH_LOCAL_LLM_BASE_URL.replace(/\/v1\/?$/, "");
  const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!response?.ok) throw new Error(`llama.cpp is not reachable at ${base}. Start the local model server first.`);
  return response.json().catch(() => ({ status: "ok" }));
}

async function waitForModelRecovery(counters) {
  while (!stopping) {
    try {
      await modelHealth();
      return;
    } catch {
      await repository.recordWorkerHeartbeat({
        workerId,
        status: "blocked",
        version: WORKER_VERSION,
        metadata: {
          model: process.env.JOBSEARCH_LOCAL_LLM_MODEL,
          reason: "Waiting for the local model server",
          ...counters(),
        },
      }).catch(() => null);
      await sleep(30000);
    }
  }
}

async function enqueueForJob(job) {
  const revision = `${job.contentHash}:${workflow.PROMPT_VERSION}`;
  if (job.details?.triageStatus !== "complete") {
    return repository.enqueueLocalTask({
      jobId: job.id, taskType: "triage", priority: 100,
      revision: `${revision}:triage`, payload: { sourceId: job.sourceId },
    });
  }
  if (job.details?.deepStatus !== "complete") {
    return repository.enqueueLocalTask({
      jobId: job.id, taskType: "deep", priority: job.details?.triage?.relevance === "relevant" ? 80 : job.details?.triage?.relevance === "uncertain" ? 70 : 50,
      revision: `${revision}:deep-direct-evidence-v1`, payload: { sourceId: job.sourceId },
    });
  }
  if (job.details?.deepEvaluation && job.details?.criticStatus !== "complete") {
    return repository.enqueueLocalTask({
      jobId: job.id, taskType: "critic", priority: 60,
      revision: `${revision}:critic-all-v1:${job.details.deepEvaluation.overallScore}`, payload: { sourceId: job.sourceId },
    });
  }
  if (job.details?.deepEvaluation?.verdict === "apply" && !job.details?.outreach) {
    return repository.enqueueLocalTask({
      jobId: job.id, taskType: "outreach", priority: 30,
      revision: `${revision}:outreach:${job.details.deepEvaluation.overallScore}`, payload: { sourceId: job.sourceId },
    });
  }
  return null;
}

async function enqueueBacklog() {
  const jobs = await repository.listJobs({ view: "all", limit: 5000 });
  let enqueued = 0;
  for (const job of jobs) {
    if (await enqueueForJob(job)) enqueued += 1;
  }
  return { jobs: jobs.length, enqueued };
}

async function processTask(task, runId) {
  if (task.taskType === "triage") return workflow.runLocalTriageEvaluation({ jobId: task.jobId, runId });
  if (task.taskType === "deep") return workflow.runLocalDeepEvaluation({ jobId: task.jobId, runId });
  if (task.taskType === "critic") return workflow.runLocalCriticEvaluation({ jobId: task.jobId, runId });
  if (task.taskType === "outreach") return workflow.runLocalOutreachDraft({ jobId: task.jobId, runId });
  throw new Error(`Unsupported local task type: ${task.taskType}`);
}

function startProcessingHeartbeat(task, counters) {
  let updating = false;
  const update = async () => {
    if (updating) return;
    updating = true;
    try {
      await repository.recordWorkerHeartbeat({
        workerId,
        status: "processing",
        version: WORKER_VERSION,
        currentTaskId: task.id,
        metadata: {
          model: process.env.JOBSEARCH_LOCAL_LLM_MODEL,
          taskType: task.taskType,
          ...counters(),
        },
      });
    } catch {
      // A transient heartbeat failure must not discard an in-flight model result.
    } finally {
      updating = false;
    }
  };
  const timer = setInterval(update, 30000);
  timer.unref();
  return () => clearInterval(timer);
}

const backlog = await enqueueBacklog();
if (enqueueOnly) {
  process.stdout.write(`${JSON.stringify(backlog)}\n`);
  process.exit(0);
}
await modelHealth();

const run = await repository.createRun({ trigger: "local-worker", status: "running", phase: "local_inference" });
await repository.recordWorkerHeartbeat({
  workerId, status: "idle", version: WORKER_VERSION,
  metadata: { model: process.env.JOBSEARCH_LOCAL_LLM_MODEL, baseUrl: process.env.JOBSEARCH_LOCAL_LLM_BASE_URL, backlog },
});

let processed = 0;
let completed = 0;
let failed = 0;
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

while (!stopping && (!maxTasks || processed < maxTasks)) {
  const task = await repository.claimLocalTask({ workerId, leaseSeconds: 1200 });
  if (!task) {
    await repository.recordWorkerHeartbeat({
      workerId, status: "idle", version: WORKER_VERSION,
      metadata: { model: process.env.JOBSEARCH_LOCAL_LLM_MODEL, processed, completed, failed },
    });
    if (once) break;
    await sleep(pollMs);
    await enqueueBacklog();
    continue;
  }

  processed += 1;
  await repository.recordWorkerHeartbeat({
    workerId, status: "processing", version: WORKER_VERSION, currentTaskId: task.id,
    metadata: { model: process.env.JOBSEARCH_LOCAL_LLM_MODEL, taskType: task.taskType, processed, completed, failed },
  });
  const stopProcessingHeartbeat = startProcessingHeartbeat(task, () => ({ processed, completed, failed }));
  try {
    const job = await processTask(task, run.id);
    await repository.completeLocalTask(task.id, { jobId: job.id, status: job.status });
    completed += 1;
    await enqueueForJob(job);
  } catch (error) {
    failed += 1;
    const retry = task.attempts < 3;
    await repository.failLocalTask(task.id, error, {
      retry,
      delaySeconds: Math.min(1800, 60 * (2 ** Math.max(0, task.attempts - 1))),
    });
    try {
      await modelHealth();
    } catch {
      await waitForModelRecovery(() => ({ processed, completed, failed }));
    }
  } finally {
    stopProcessingHeartbeat();
  }
}

await repository.recordWorkerHeartbeat({
  workerId, status: "stopped", version: WORKER_VERSION,
  metadata: { model: process.env.JOBSEARCH_LOCAL_LLM_MODEL, processed, completed, failed },
});
await repository.updateRun(run.id, {
  status: failed ? "partial" : "completed", phase: "complete",
  stats: { processed, completed, failed },
  providers: { local: { model: process.env.JOBSEARCH_LOCAL_LLM_MODEL, status: "live" } },
  errors: failed ? [{ stage: "local_inference", message: `${failed} local tasks failed or are waiting to retry.` }] : [],
});
process.stdout.write(`${JSON.stringify({ runId: run.id, processed, completed, failed })}\n`);
