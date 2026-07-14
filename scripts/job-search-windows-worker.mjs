#!/usr/bin/env node

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { assertApprovedWindowsModel, assertResourcesSafe } from "./job-search-windows-resource-guard.mjs";
import { getWorkerPass, getWorkerPasses, REQUIRED_WORKER_VERSION, WORKER_LIMITS, workerResultId } from "../server/job-search/worker-contract.js";
import { parseStructuredContent } from "../server/job-search/schemas.js";
import { cooldownDurationForReason, resolveThermalCycleState, shouldRetryWorkerTask, workerFailureCategory } from "../server/job-search/windows-worker-runtime.js";

const args = new Set(process.argv.slice(2));
const RUNTIME_RESOURCE_CHECK_MS = 5_000;
const MODEL_PASS_TIMEOUT_MS = 30 * 60_000;
const valueArg = (name, fallback) => {
  const item = [...args].find((argument) => argument.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
};

const once = args.has("--once");
const maxTasks = Math.max(0, Number(valueArg("--max-tasks", once ? "1" : "0")) || 0);
const pollMs = Math.max(5_000, Number(valueArg("--poll-ms", "15000")) || 15_000);
const activeMinutes = Math.max(1, Number(valueArg("--active-minutes", process.env.JOBSEARCH_WORKER_ACTIVE_MINUTES || "120")) || 120);
const cooldownMinutes = Math.max(1, Number(valueArg("--cooldown-minutes", process.env.JOBSEARCH_WORKER_COOLDOWN_MINUTES || "60")) || 60);
const temperatureCooldownMinutes = Math.max(5, Number(valueArg("--temperature-cooldown-minutes", process.env.JOBSEARCH_WORKER_TEMPERATURE_COOLDOWN_MINUTES || "15")) || 15);
const endpoint = String(process.env.JOBSEARCH_WORKER_BASE_URL || "").replace(/\/$/, "");
const token = String(process.env.JOBSEARCH_WORKER_TOKEN || "");
const workerId = String(process.env.JOBSEARCH_WORKER_ID || `${os.hostname().toLowerCase()}:${process.pid}`).replace(/[^a-z0-9_.:-]/gi, "-");
const version = REQUIRED_WORKER_VERSION;
const modelName = process.env.JOBSEARCH_LOCAL_LLM_MODEL || "Qwen3-4B-Q4_K_M";
const modelPath = process.env.JOBSEARCH_LOCAL_MODEL_PATH || "";
const llamaServerPath = process.env.JOBSEARCH_LLAMA_SERVER_PATH || "";
const modelBaseUrl = String(process.env.JOBSEARCH_LOCAL_LLM_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, "");
const requestedGpuLayers = Number(process.env.JOBSEARCH_LOCAL_GPU_LAYERS ?? "0");
const gpuLayers = Number.isFinite(requestedGpuLayers)
  ? Math.max(0, Math.min(20, requestedGpuLayers))
  : 0;
const cpuThreads = Math.max(1, Math.min(8, Number(process.env.JOBSEARCH_LOCAL_CPU_THREADS || 2) || 2));
const runtimeDir = process.env.JOBSEARCH_WORKER_RUNTIME_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "DiptopalJobWorker");
const logDir = path.join(runtimeDir, "logs");
const thermalStatePath = path.join(runtimeDir, "thermal-cycle.json");

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

const activeMs = activeMinutes * 60_000;
const cooldownMs = cooldownMinutes * 60_000;
const temperatureCooldownMs = temperatureCooldownMinutes * 60_000;

async function readThermalState() {
  try {
    const state = JSON.parse(await readFile(thermalStatePath, "utf8"));
    return resolveThermalCycleState(state, { activeMs, cooldownMs });
  } catch {
    // A missing or malformed state safely starts a fresh bounded active window.
  }
  return resolveThermalCycleState(null, { activeMs, cooldownMs });
}

let thermalState = await readThermalState();

async function persistThermalState() {
  await writeFile(thermalStatePath, JSON.stringify({
    phase: thermalState.phase,
    until: new Date(thermalState.until).toISOString(),
    activeMinutes,
    cooldownMinutes,
    temperatureCooldownMinutes,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

async function beginActiveWindow() {
  thermalState = { phase: "active", until: Date.now() + activeMs };
  await persistThermalState();
  log("thermal_active_started", { activeMinutes, activeUntil: new Date(thermalState.until).toISOString() });
}

async function beginCooldown(reason) {
  if (thermalState.phase === "cooldown" && thermalState.until > Date.now()) return;
  const durationMinutes = reason === "temperature_guard" ? temperatureCooldownMinutes : cooldownMinutes;
  const durationMs = cooldownDurationForReason(reason, {
    scheduledMs: cooldownMs,
    temperatureMs: temperatureCooldownMs,
  });
  thermalState = { phase: "cooldown", until: Date.now() + durationMs };
  await persistThermalState();
  await stopModel(reason);
  log("thermal_cooldown_started", { reason, cooldownMinutes: durationMinutes, cooldownUntil: new Date(thermalState.until).toISOString() });
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
      "--threads", String(cpuThreads),
      "--n-gpu-layers", String(gpuLayers),
      ...(gpuLayers === 0 ? ["--device", "none", "--no-kv-offload"] : []),
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
  log("model_starting", { pid: modelProcess.pid, gpuLayers, cpuThreads, resources: evaluation.summary });
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
      ? { ...message, content: `/${pass.thinking ? "think" : "no_think"}\n${message.content}` }
      : message
  ));
  const usage = { inputTokens: 0, outputTokens: 0, repairAttempts: 0 };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    let pressureError = null;
    let monitorInFlight = false;
    const monitor = setInterval(async () => {
      if (monitorInFlight || pressureError) return;
      monitorInFlight = true;
      try {
        await assertResourcesSafe({ phase: "runtime" });
      } catch (error) {
        if (workerFailureCategory(error) === "resource_pressure") {
          pressureError = error;
          controller.abort();
        }
      } finally {
        monitorInFlight = false;
      }
    }, RUNTIME_RESOURCE_CHECK_MS);
    monitor.unref();
    let response;
    try {
      response = await fetch(`${modelBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature: 0.1,
          max_tokens: pass.maxTokens,
          reasoning_budget_tokens: pass.thinking ? (pass.name === "critic" ? 512 : 768) : 0,
          cache_prompt: true,
          response_format: responseFormat(pass.schema, `windows_${pass.name}`),
        }),
        signal: AbortSignal.any([AbortSignal.timeout(MODEL_PASS_TIMEOUT_MS), controller.signal]),
      });
    } catch (error) {
      throw pressureError || error;
    } finally {
      clearInterval(monitor);
    }
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
      if (attempt === 2) throw error;
      usage.repairAttempts += 1;
      const issues = Array.isArray(error.issues)
        ? error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : String(error.message || error).slice(0, 1000);
      messages = [
        ...messages,
        {
          role: "user",
          content: `/${pass.thinking ? "think" : "no_think"}\nYour previous JSON failed validation: ${issues}. Return the complete corrected JSON object. Explicit and inferred claims require a non-empty sourceUrl and an exact non-empty supportingPassage from the supplied evidence. Move unsupported facts to unknowns instead of guessing.`,
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
    await assertResourcesSafe({ phase: "runtime" });
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

async function resourcesReadyBeforeClaim() {
  const modelRunning = await modelHealth();
  try {
    await assertResourcesSafe({ phase: modelRunning ? "runtime" : "startup" });
    return true;
  } catch (error) {
    const category = workerFailureCategory(error);
    if (category !== "resource_pressure") throw error;
    const temperaturePressure = /temperature/i.test(String(error.message || error));
    if (modelRunning || modelProcess) await stopModel("resource_wait_before_claim");
    if (temperaturePressure) await beginCooldown("temperature_guard");
    const retryInSeconds = temperaturePressure
      ? Math.max(1, Math.ceil((thermalState.until - Date.now()) / 1000))
      : 30;
    const gpuTemperatureCelsius = error.evaluation?.summary?.gpuTemperatureCelsius ?? null;
    const maximumGpuTemperatureCelsius = error.evaluation?.summary?.maximumGpuTemperatureCelsius ?? null;
    log("resource_wait_before_claim", { error: String(error.message || error).slice(0, 500), retryInSeconds });
    await workerFetch("heartbeat", {
      method: "POST",
      body: {
        workerId,
        version,
        status: temperaturePressure ? "cooling_down" : "resource_waiting",
        metadata: {
          processed,
          completed,
          failed,
          reason: String(error.message || error).slice(0, 300),
          gpuTemperatureCelsius,
          maximumGpuTemperatureCelsius,
          ...(temperaturePressure ? { cooldownUntil: new Date(thermalState.until).toISOString() } : {}),
        },
      },
    }).catch(() => null);
    if (!temperaturePressure) await sleep(30_000);
    return false;
  }
}

async function thermalWindowReady() {
  if (once) return true;
  const now = Date.now();
  if (thermalState.phase === "active" && now < thermalState.until) return true;
  if (thermalState.phase === "active") await beginCooldown("scheduled_two_hour_limit");
  if (thermalState.phase === "cooldown" && Date.now() >= thermalState.until) {
    await beginActiveWindow();
    return true;
  }
  await stopModel("thermal_cooldown");
  const remainingSeconds = Math.max(1, Math.ceil((thermalState.until - Date.now()) / 1000));
  await workerFetch("heartbeat", {
    method: "POST",
    body: {
      workerId,
      version,
      status: "cooling_down",
      metadata: {
        model: modelName,
        processed,
        completed,
        failed,
        cooldownUntil: new Date(thermalState.until).toISOString(),
      },
    },
  }).catch(() => null);
  await sleep(Math.min(60_000, remainingSeconds * 1000));
  return false;
}

await waitForWorkerApi();
await persistThermalState();
log("worker_started", {
  workerId,
  endpoint,
  model: modelName,
  context: WORKER_LIMITS.contextTokens,
  concurrency: WORKER_LIMITS.concurrency,
  cpuThreads,
  activeMinutes,
  cooldownMinutes,
  temperatureCooldownMinutes,
  thermalPhase: thermalState.phase,
  thermalUntil: new Date(thermalState.until).toISOString(),
});

while (!stopping && (!maxTasks || processed < maxTasks)) {
  if (!await thermalWindowReady()) continue;
  if (!await resourcesReadyBeforeClaim()) continue;
  let claim;
  try {
    claim = await workerFetch("claim", {
      method: "POST",
      timeoutMs: 120_000,
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
    await assertResourcesSafe({ phase: await modelHealth() ? "runtime" : "startup" });
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
    const failureCategory = workerFailureCategory(error);
    const infrastructureFailure = failureCategory === "infrastructure";
    consecutiveModelFailures = infrastructureFailure ? consecutiveModelFailures + 1 : 0;
    const retry = shouldRetryWorkerTask(task);
    if (failureCategory === "resource_pressure") {
      await stopModel("resource_pressure");
      if (/temperature/i.test(String(error.message || error))) await beginCooldown("temperature_guard");
      else await sleep(15_000);
    }
    await workerFetch("failure", {
      method: "POST",
      body: {
        workerId,
        version,
        taskId: task.id,
        leaseToken: task.leaseToken,
        error: String(error.message || error).slice(0, 1000),
        retry,
      },
    }).catch(() => null);
    log("task_failed", {
      taskId: task.id,
      taskType: task.taskType,
      error: String(error.message || error).slice(0, 500),
      failureCategory,
      retry,
      consecutiveModelFailures,
    });
    if (infrastructureFailure && consecutiveModelFailures >= 3) {
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
