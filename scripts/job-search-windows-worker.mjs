#!/usr/bin/env node

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { assertApprovedWindowsModel, assertResourcesSafe } from "./job-search-windows-resource-guard.mjs";
import { getWorkerPass, getWorkerPasses, WORKER_LIMITS, WORKER_PROTOCOL_VERSION, workerResultId } from "../server/job-search/worker-contract.js";
import { parseStructuredContent } from "../server/job-search/schemas.js";

const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback) => {
  const item = [...args].find((argument) => argument.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
};

const once = args.has("--once");
const maxTasks = Math.max(0, Number(valueArg("--max-tasks", once ? "1" : "0")) || 0);
const pollMs = Math.max(5_000, Number(valueArg("--poll-ms", "15000")) || 15_000);
const endpoint = String(process.env.JOBSEARCH_WORKER_BASE_URL || "").replace(/\/$/, "");
const token = String(process.env.JOBSEARCH_WORKER_TOKEN || "");
const workerId = String(process.env.JOBSEARCH_WORKER_ID || `${os.hostname().toLowerCase()}:${process.pid}`).replace(/[^a-z0-9_.:-]/gi, "-");
const version = `windows-qwen-worker-${WORKER_PROTOCOL_VERSION}`;
const modelName = process.env.JOBSEARCH_LOCAL_LLM_MODEL || "Qwen3-4B-Q4_K_M";
const modelPath = process.env.JOBSEARCH_LOCAL_MODEL_PATH || "";
const llamaServerPath = process.env.JOBSEARCH_LLAMA_SERVER_PATH || "";
const modelBaseUrl = String(process.env.JOBSEARCH_LOCAL_LLM_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, "");
const runtimeDir = process.env.JOBSEARCH_WORKER_RUNTIME_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "DiptopalJobWorker");
const logDir = path.join(runtimeDir, "logs");

if (!endpoint || (!endpoint.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(endpoint))) {
  throw new Error("JOBSEARCH_WORKER_BASE_URL must use HTTPS (loopback HTTP is allowed only for local calibration). ");
}
if (token.length < 32) throw new Error("JOBSEARCH_WORKER_TOKEN must contain at least 32 characters.");
assertApprovedWindowsModel(`${modelName} ${modelPath}`);
if (!llamaServerPath || !modelPath) throw new Error("JOBSEARCH_LLAMA_SERVER_PATH and JOBSEARCH_LOCAL_MODEL_PATH are required.");
await mkdir(logDir, { recursive: true });

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workerFetch(pathname, { method = "GET", body, timeoutMs = 30_000 } = {}) {
  const response = await fetch(`${endpoint}/api/job-search/worker/${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Worker API ${pathname} returned ${response.status}: ${payload.error || "request failed"}`);
  return payload;
}

async function modelHealth() {
  const response = await fetch(`${modelBaseUrl.replace(/\/v1$/, "")}/health`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  return Boolean(response?.ok);
}

let modelProcess = null;
let lastModelUseAt = 0;

async function lowerProcessPriority(pid) {
  const command = `try { (Get-Process -Id ${Number(pid)}).PriorityClass='BelowNormal' } catch {}`;
  const process = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    stdio: "ignore",
  });
  process.unref();
}

async function startModel() {
  if (await modelHealth()) return;
  const { evaluation } = await assertResourcesSafe({ phase: "startup" });
  const logPath = path.join(logDir, "llama-server.log");
  const logFd = openSync(logPath, "a");
  const url = new URL(modelBaseUrl);
  const port = Number(url.port || 8080);
  try {
    modelProcess = spawn(llamaServerPath, [
      "--model", modelPath,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--ctx-size", String(WORKER_LIMITS.contextTokens),
      "--parallel", String(WORKER_LIMITS.concurrency),
      "--threads", "6",
      "--n-gpu-layers", "99",
      "--no-webui",
    ], {
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
  modelProcess.once("exit", () => { modelProcess = null; });
  lowerProcessPriority(modelProcess.pid);
  log("model_starting", { pid: modelProcess.pid, resources: evaluation.summary });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await modelHealth()) {
      lastModelUseAt = Date.now();
      log("model_ready", { pid: modelProcess?.pid || null });
      return;
    }
    if (!modelProcess) throw new Error("llama.cpp exited before becoming healthy.");
    await sleep(2_000);
  }
  throw new Error("llama.cpp did not become healthy within three minutes.");
}

async function stopModel(reason) {
  if (!modelProcess) return;
  const pid = modelProcess.pid;
  modelProcess.kill("SIGTERM");
  const deadline = Date.now() + 15_000;
  while (modelProcess && Date.now() < deadline) await sleep(250);
  if (modelProcess) modelProcess.kill("SIGKILL");
  modelProcess = null;
  log("model_stopped", { pid, reason });
}

function responseFormat(schema, name) {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  delete jsonSchema.$schema;
  return { type: "json_schema", json_schema: { name, strict: false, schema: jsonSchema } };
}

async function callLocalPass(pass) {
  let messages = pass.messages.map((message, index) => (
    index === pass.messages.length - 1 && message.role === "user"
      ? { ...message, content: `/no_think\n${message.content}` }
      : message
  ));
  const usage = { inputTokens: 0, outputTokens: 0, repairAttempts: 0 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${modelBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: 0.1,
        max_tokens: pass.maxTokens,
        reasoning_budget_tokens: 0,
        cache_prompt: true,
        response_format: responseFormat(pass.schema, `windows_${pass.name}`),
      }),
      signal: AbortSignal.timeout(600_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Local model returned ${response.status}: ${payload.error?.message || "request failed"}`);
    const choice = payload.choices?.[0];
    usage.inputTokens += Number(payload.usage?.prompt_tokens) || 0;
    usage.outputTokens += Number(payload.usage?.completion_tokens) || 0;
    if (choice?.finish_reason === "length") throw new Error(`Local model truncated the ${pass.name} pass.`);
    try {
      const result = parseStructuredContent(pass.schema, choice?.message?.content);
      lastModelUseAt = Date.now();
      return { result, usage };
    } catch (error) {
      if (attempt === 1) throw error;
      usage.repairAttempts += 1;
      const issues = Array.isArray(error.issues)
        ? error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : String(error.message || error).slice(0, 1000);
      messages = [
        ...messages,
        {
          role: "user",
          content: `/no_think\nYour previous JSON failed validation: ${issues}. Return the complete corrected JSON object. Explicit and inferred claims require a non-empty sourceUrl and an exact non-empty supportingPassage from the supplied evidence. Move unsupported facts to unknowns instead of guessing.`,
        },
      ];
    }
  }
  throw new Error(`Local model could not complete the ${pass.name} pass.`);
}

async function evaluateTask(task, packet) {
  const output = {};
  const usage = { inputTokens: 0, outputTokens: 0, passes: [] };
  for (const passName of getWorkerPasses(task.taskType)) {
    const pass = getWorkerPass(task.taskType, passName, packet, output);
    const response = await callLocalPass(pass);
    output[pass.name] = response.result;
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    usage.passes.push({ name: pass.name, ...response.usage });
  }
  return { output, usage };
}

function startHeartbeat(task, counters) {
  let active = true;
  let inFlight = false;
  const tick = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      await workerFetch("heartbeat", {
        method: "POST",
        body: {
          workerId,
          version,
          taskId: task.id,
          leaseToken: task.leaseToken,
          status: "processing",
          metadata: { model: modelName, taskType: task.taskType, ...counters() },
        },
      });
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => tick().catch(() => null), WORKER_LIMITS.heartbeatSeconds * 1000);
  timer.unref();
  return () => { active = false; clearInterval(timer); };
}

let stopping = false;
let processed = 0;
let completed = 0;
let failed = 0;
let consecutiveModelFailures = 0;
let consecutiveApiFailures = 0;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function waitForWorkerApi() {
  while (!stopping) {
    try {
      await workerFetch("health");
      consecutiveApiFailures = 0;
      return;
    } catch (error) {
      consecutiveApiFailures += 1;
      const delaySeconds = Math.min(60, 5 * (2 ** Math.min(4, consecutiveApiFailures - 1)));
      log("worker_api_unavailable", { error: String(error.message || error).slice(0, 500), retryInSeconds: delaySeconds });
      await sleep(delaySeconds * 1000);
    }
  }
  throw new Error("Worker stopped before the control plane became available.");
}

await waitForWorkerApi();
log("worker_started", { workerId, endpoint, model: modelName, context: WORKER_LIMITS.contextTokens, concurrency: WORKER_LIMITS.concurrency });

while (!stopping && (!maxTasks || processed < maxTasks)) {
  let claim;
  try {
    claim = await workerFetch("claim", {
      method: "POST",
      body: { workerId, version, metadata: { platform: process.platform, architecture: process.arch, model: modelName } },
    });
    consecutiveApiFailures = 0;
  } catch (error) {
    consecutiveApiFailures += 1;
    const delaySeconds = Math.min(60, 5 * (2 ** Math.min(4, consecutiveApiFailures - 1)));
    log("worker_api_unavailable", { error: String(error.message || error).slice(0, 500), retryInSeconds: delaySeconds });
    await sleep(delaySeconds * 1000);
    continue;
  }
  if (!claim.task) {
    if (modelProcess && Date.now() - lastModelUseAt >= WORKER_LIMITS.idleShutdownSeconds * 1000) await stopModel("idle_timeout");
    if (once) break;
    await sleep(Math.max(pollMs, Number(claim.pollAfterSeconds || 15) * 1000));
    continue;
  }

  const task = claim.task;
  processed += 1;
  const stopHeartbeat = startHeartbeat(task, () => ({ processed, completed, failed }));
  try {
    await assertResourcesSafe({ phase: "task" });
    await startModel();
    const evaluation = await evaluateTask(task, claim.packet);
    const resultId = workerResultId(task.taskKey, evaluation.output);
    await workerFetch("result", {
      method: "POST",
      timeoutMs: 120_000,
      body: { workerId, version, taskId: task.id, leaseToken: task.leaseToken, resultId, model: modelName, ...evaluation },
    });
    completed += 1;
    consecutiveModelFailures = 0;
    log("task_completed", { taskId: task.id, taskType: task.taskType, processed, completed, failed });
  } catch (error) {
    failed += 1;
    consecutiveModelFailures += 1;
    await workerFetch("failure", {
      method: "POST",
      body: {
        workerId,
        version,
        taskId: task.id,
        leaseToken: task.leaseToken,
        error: String(error.message || error).slice(0, 1000),
        retry: consecutiveModelFailures < 3,
      },
    }).catch(() => null);
    log("task_failed", { taskId: task.id, taskType: task.taskType, error: String(error.message || error).slice(0, 500), consecutiveModelFailures });
    if (consecutiveModelFailures >= 3) {
      log("circuit_breaker_open", { failed });
      stopping = true;
    }
  } finally {
    stopHeartbeat();
  }
}

await workerFetch("heartbeat", {
  method: "POST",
  body: { workerId, version, status: "idle", metadata: { processed, completed, failed, stopped: true } },
}).catch(() => null);
await stopModel("worker_exit");
log("worker_stopped", { processed, completed, failed });
process.exitCode = failed ? 1 : 0;
