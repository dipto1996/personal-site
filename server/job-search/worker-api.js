import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  claimLocalTask,
  completeLocalTask,
  failLocalTask,
  getJob,
  getLocalTask,
  getLocalWorkerStatus,
  listFeedbackExamples,
  recordWorkerHeartbeat,
  renewLocalTaskLease,
} from "./repository.js";
import { buildWorkerPacket, WORKER_LIMITS, WORKER_PROTOCOL_VERSION, workerResultId } from "./worker-contract.js";
import { applyWindowsWorkerResult, enqueueNextWindowsTask, prepareWindowsDeepJob } from "./workflow.js";

const workerIdSchema = z.string().trim().min(3).max(200).regex(/^[a-z0-9_.:-]+$/i);
const workerIdentitySchema = z.object({
  workerId: workerIdSchema,
  version: z.string().trim().min(1).max(120).default("unknown"),
});
const leaseIdentitySchema = workerIdentitySchema.extend({
  taskId: z.string().trim().min(1).max(200),
  leaseToken: z.string().trim().min(20).max(200),
});

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function bearerToken(request) {
  return String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function digest(value) {
  return createHash("sha256").update(String(value || "")).digest();
}

export function requireJobSearchWorkerToken(request) {
  const expected = String(process.env.JOBSEARCH_WORKER_TOKEN || "").trim();
  if (expected.length < 32) throw httpError(503, "Job-search worker authentication is not configured.");
  const provided = bearerToken(request);
  if (!provided || !timingSafeEqual(digest(provided), digest(expected))) {
    throw httpError(401, "Invalid worker token.");
  }
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|authorization|database|api.?key/i.test(key)) continue;
    if (["string", "number", "boolean"].includes(typeof item)) output[key] = typeof item === "string" ? item.slice(0, 500) : item;
  }
  return JSON.stringify(output).length <= 4000 ? output : {};
}

export function getWindowsWorkerHealth() {
  return {
    ok: true,
    protocolVersion: WORKER_PROTOCOL_VERSION,
    leaseSeconds: WORKER_LIMITS.leaseSeconds,
    heartbeatSeconds: WORKER_LIMITS.heartbeatSeconds,
    contextTokens: WORKER_LIMITS.contextTokens,
    concurrency: WORKER_LIMITS.concurrency,
    paidProvidersEnabled: false,
  };
}

export async function getWindowsWorkerQueue() {
  const status = await getLocalWorkerStatus();
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    tasks: status.tasks,
    workers: status.workers.map((worker) => ({
      workerId: worker.workerId,
      status: worker.status,
      version: worker.version,
      currentTaskId: worker.currentTaskId,
      lastSeenAt: worker.lastSeenAt,
    })),
  };
}

export async function claimWindowsWorkerTask(input) {
  const identity = workerIdentitySchema.parse(input || {});
  const metadata = sanitizeMetadata(input?.metadata);
  await recordWorkerHeartbeat({
    ...identity,
    status: "claiming",
    metadata: { ...metadata, protocolVersion: WORKER_PROTOCOL_VERSION },
  });
  const task = await claimLocalTask({ workerId: identity.workerId, leaseSeconds: WORKER_LIMITS.leaseSeconds });
  if (!task) {
    await recordWorkerHeartbeat({ ...identity, status: "idle", metadata });
    return { task: null, pollAfterSeconds: 15, protocolVersion: WORKER_PROTOCOL_VERSION };
  }
  let job = await getJob(task.jobId);
  if (!job) {
    await failLocalTask(task.id, "Claimed task references a missing job.", {
      retry: false,
      workerId: identity.workerId,
      leaseToken: task.leaseToken,
    });
    throw httpError(409, "Claimed task references a missing job.");
  }
  if (task.taskType === "deep") {
    try {
      job = await prepareWindowsDeepJob({ jobId: job.id, runId: task.payload?.runId || null });
    } catch (error) {
      job = await getJob(task.jobId);
      await recordWorkerHeartbeat({
        ...identity,
        status: "claiming",
        currentTaskId: task.id,
        metadata: { ...metadata, taskType: task.taskType, researchStatus: "partial", researchError: String(error.message || error).slice(0, 300) },
      });
    }
  }
  const feedbackExamples = await listFeedbackExamples(job.roleFamilyId);
  const packet = buildWorkerPacket({ task, job, feedbackExamples });
  await recordWorkerHeartbeat({
    ...identity,
    status: "processing",
    currentTaskId: task.id,
    metadata: { ...metadata, taskType: task.taskType },
  });
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    task: {
      id: task.id,
      taskKey: task.taskKey,
      taskType: task.taskType,
      attempt: task.attempts,
      leaseUntil: task.leaseUntil,
      leaseToken: task.leaseToken,
    },
    packet,
  };
}

export async function heartbeatWindowsWorkerTask(input) {
  const identity = workerIdentitySchema.parse(input || {});
  const taskId = String(input?.taskId || "").trim();
  let task = null;
  if (taskId) {
    const lease = leaseIdentitySchema.parse(input);
    task = await renewLocalTaskLease(lease.taskId, {
      workerId: lease.workerId,
      leaseToken: lease.leaseToken,
      leaseSeconds: WORKER_LIMITS.leaseSeconds,
    });
  }
  await recordWorkerHeartbeat({
    ...identity,
    status: input?.status === "blocked" ? "blocked" : taskId ? "processing" : "idle",
    currentTaskId: taskId,
    metadata: sanitizeMetadata(input?.metadata),
  });
  return { ok: true, leaseUntil: task?.leaseUntil || null };
}

export async function completeWindowsWorkerTask(input) {
  const identity = leaseIdentitySchema.parse(input || {});
  const task = await getLocalTask(identity.taskId);
  if (!task) throw httpError(404, "Worker task was not found.");
  const computedResultId = workerResultId(task.taskKey, input.output);
  const submittedResultId = String(input.resultId || computedResultId);
  if (submittedResultId !== computedResultId) throw httpError(400, "Worker result id does not match its output.");
  if (task.status === "completed") {
    if (task.resultId !== computedResultId) throw httpError(409, "Worker task already has a different result.");
    return { ok: true, idempotent: true, taskId: task.id, resultId: task.resultId };
  }
  await renewLocalTaskLease(task.id, {
    workerId: identity.workerId,
    leaseToken: identity.leaseToken,
    leaseSeconds: WORKER_LIMITS.leaseSeconds,
  });
  const updatedJob = await applyWindowsWorkerResult({
    task,
    output: input.output,
    resultId: computedResultId,
    model: String(input.model || "qwen3-4b-q4_k_m").slice(0, 120),
    usage: input.usage || {},
  });
  const completed = await completeLocalTask(task.id, {
    jobId: updatedJob.id,
    status: updatedJob.status,
    resultId: computedResultId,
  }, {
    workerId: identity.workerId,
    leaseToken: identity.leaseToken,
    resultId: computedResultId,
  });
  if (!completed) throw httpError(409, "Worker result could not be committed.");
  const nextTask = await enqueueNextWindowsTask(updatedJob);
  await recordWorkerHeartbeat({
    workerId: identity.workerId,
    version: identity.version,
    status: "idle",
    metadata: { completedTaskType: task.taskType },
  });
  return {
    ok: true,
    idempotent: false,
    taskId: task.id,
    resultId: computedResultId,
    job: { id: updatedJob.id, status: updatedJob.status },
    nextTask: nextTask ? { id: nextTask.id, taskType: nextTask.taskType } : null,
  };
}

export async function failWindowsWorkerTask(input) {
  const identity = leaseIdentitySchema.parse(input || {});
  const task = await getLocalTask(identity.taskId);
  if (!task) throw httpError(404, "Worker task was not found.");
  const retry = input.retry !== false && task.attempts < 3;
  const failed = await failLocalTask(task.id, String(input.error || "Windows worker task failed."), {
    retry,
    delaySeconds: Math.min(1800, 60 * (2 ** Math.max(0, task.attempts - 1))),
    workerId: identity.workerId,
    leaseToken: identity.leaseToken,
  });
  await recordWorkerHeartbeat({
    workerId: identity.workerId,
    version: identity.version,
    status: retry ? "idle" : "blocked",
    metadata: { failedTaskType: task.taskType, retry },
  });
  return { ok: true, taskId: task.id, status: failed?.status, retry };
}
