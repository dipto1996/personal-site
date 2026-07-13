#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { inspectWindowsResources } from "./job-search-windows-resource-guard.mjs";

const runtimeDir = process.env.JOBSEARCH_WORKER_RUNTIME_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "DiptopalJobWorker");
const calibrationDir = path.join(runtimeDir, "calibration");
const reportsDir = path.join(runtimeDir, "reports");
const nodePath = process.execPath;
const workerScript = path.resolve("scripts", "job-search-windows-worker.mjs");
const llamaServerPath = process.env.JOBSEARCH_LLAMA_SERVER_PATH || path.join(runtimeDir, "llama.cpp", "llama-server.exe");
const modelPath = process.env.JOBSEARCH_LOCAL_MODEL_PATH || path.join(runtimeDir, "models", "Qwen3-4B-Q4_K_M.gguf");
const workerToken = randomBytes(32).toString("hex");

await rm(calibrationDir, { recursive: true, force: true });
await mkdir(calibrationDir, { recursive: true });
await mkdir(reportsDir, { recursive: true });
process.env.TRADEGRAPH_DATA_DIR = calibrationDir;
process.env.JOBSEARCH_WORKER_TOKEN = workerToken;
delete process.env.DATABASE_URL;

const [{ handleRequest }, repository] = await Promise.all([
  import("../server/app.js"),
  import("../server/job-search/repository.js"),
]);

const fixtures = [
  {
    label: "positive",
    disposition: "apply",
    sourceId: "windows_calibration_positive",
    title: "Director, AI Product Strategy",
    company: "Calibrated Fintech",
    location: "Remote - India eligible",
    description: "Lead AI product strategy, model governance, experimentation, and cross-functional delivery for a financial-services platform. This role is explicitly remote from India. Base compensation is USD 160,000-190,000. The role partners with engineering and does not own production coding or on-call services.",
    evidence: [
      ["remote", "Remote from India", "This role is explicitly remote from India."],
      ["compensation", "USD 160,000-190,000", "Base compensation is USD 160,000-190,000."],
      ["scope", "AI product strategy leadership", "Lead AI product strategy, model governance, experimentation, and cross-functional delivery for a financial-services platform."],
    ],
  },
  {
    label: "negative",
    disposition: "pass",
    sourceId: "windows_calibration_negative",
    title: "Senior Backend Machine Learning Engineer",
    company: "Calibrated Systems",
    location: "San Francisco, CA - onsite",
    description: "This onsite San Francisco role requires US citizenship. The engineer writes production backend services daily, owns pager duty, and completes a live algorithms and data-structures coding interview. No remote work is offered.",
    evidence: [
      ["location", "San Francisco onsite", "This onsite San Francisco role requires US citizenship."],
      ["work_authorization", "US citizenship required", "This onsite San Francisco role requires US citizenship."],
      ["coding", "Daily backend coding and algorithms interview", "The engineer writes production backend services daily, owns pager duty, and completes a live algorithms and data-structures coding interview."],
      ["remote", "No remote work", "No remote work is offered."],
    ],
  },
];

for (const fixture of fixtures) {
  const url = `https://example.com/jobs/${fixture.sourceId}`;
  const job = await repository.upsertJob({
    sourceId: fixture.sourceId,
    canonicalUrl: url,
    title: fixture.title,
    normalizedTitle: fixture.title.toLowerCase(),
    company: fixture.company,
    location: fixture.location,
    description: fixture.description,
    postedAt: new Date().toISOString(),
    sourceProvider: "calibration",
    sourceQuery: "windows-local-calibration",
    contentHash: `calibration-${fixture.sourceId}-v1`,
    roleFamilyId: fixture.label === "positive" ? "ai_product_platform" : "exploratory",
    status: "triage_pending",
    disposition: fixture.disposition,
    details: {
      calibrationLabel: fixture.label,
      sourceEvidence: fixture.evidence.map(([claimType, value, supportingPassage]) => ({
        claimType,
        value,
        sourceUrl: url,
        supportingPassage,
        sourceDate: "",
        confidence: 1,
        evidenceType: "explicit",
      })),
    },
  });
  await repository.enqueueLocalTask({ jobId: job.id, taskType: "triage", priority: 100, revision: "windows-calibration-v1" });
}

const server = http.createServer((request, response) => handleRequest(request, response));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const startedAt = Date.now();
let workerExitCode = null;
let minAvailableRamBytes = Number.POSITIVE_INFINITY;
let minFreeVramMiB = Number.POSITIVE_INFINITY;

const monitor = setInterval(async () => {
  try {
    const inventory = await inspectWindowsResources();
    minAvailableRamBytes = Math.min(minAvailableRamBytes, inventory.memory.availableBytes);
    if (inventory.nvidia) minFreeVramMiB = Math.min(minFreeVramMiB, inventory.nvidia.freeVramMiB);
  } catch {
    // Calibration continues if one inventory sample fails.
  }
}, 5_000);
monitor.unref();

try {
  const child = spawn(nodePath, [workerScript, "--max-tasks=6", "--poll-ms=5000"], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      JOBSEARCH_WORKER_BASE_URL: `http://127.0.0.1:${port}`,
      JOBSEARCH_WORKER_TOKEN: workerToken,
      JOBSEARCH_LLAMA_SERVER_PATH: llamaServerPath,
      JOBSEARCH_LOCAL_MODEL_PATH: modelPath,
      JOBSEARCH_LOCAL_LLM_MODEL: "Qwen3-4B-Q4_K_M",
      JOBSEARCH_LOCAL_LLM_BASE_URL: "http://127.0.0.1:8080/v1",
      JOBSEARCH_WORKER_RUNTIME_DIR: runtimeDir,
    },
  });
  workerExitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
} finally {
  clearInterval(monitor);
  await new Promise((resolve) => server.close(resolve));
  delete process.env.JOBSEARCH_WORKER_TOKEN;
}

const jobs = await repository.listJobs({ view: "all", limit: 20 });
const localData = JSON.parse(await readFile(path.join(calibrationDir, "job-search-intelligence.json"), "utf8"));
const resultRows = fixtures.map((fixture) => {
  const job = jobs.find((candidate) => candidate.sourceId === fixture.sourceId);
  const claims = job?.details?.claims || [];
  return {
    label: fixture.label,
    expectedDisposition: fixture.disposition,
    title: fixture.title,
    triage: job?.details?.triage?.relevance || "missing",
    deepVerdict: job?.details?.deepEvaluation?.verdict || "missing",
    deepScore: job?.details?.deepEvaluation?.overallScore ?? null,
    criticVerdict: job?.details?.critic?.recommendedVerdict || "missing",
    criticAgrees: job?.details?.critic?.agrees ?? null,
    groundedClaims: claims.filter((claim) => ["explicit", "inferred"].includes(claim.evidenceType))
      .every((claim) => Boolean(claim.sourceUrl && claim.supportingPassage)),
    finalStatus: job?.status || "missing",
  };
});
const positive = resultRows.find((row) => row.label === "positive");
const negative = resultRows.find((row) => row.label === "negative");
const report = {
  generatedAt: new Date().toISOString(),
  scope: "preliminary two-job synthetic calibration; not the 20-job production release gate",
  workerExitCode,
  model: "Qwen3-4B-Q4_K_M",
  contextTokens: 4096,
  concurrency: 1,
  durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  tasks: localData.localTasks.map((task) => ({ taskType: task.taskType, status: task.status, attempts: task.attempts })),
  evaluations: localData.evaluations.length,
  results: resultRows,
  resources: {
    minimumAvailableRamGiB: Number.isFinite(minAvailableRamBytes) ? Number((minAvailableRamBytes / (1024 ** 3)).toFixed(2)) : null,
    minimumFreeVramMiB: Number.isFinite(minFreeVramMiB) ? minFreeVramMiB : null,
  },
  gates: {
    workerExitedCleanly: workerExitCode === 0,
    positiveNotRejected: Boolean(positive && ["apply", "maybe"].includes(positive.deepVerdict)),
    clearNegativeRejected: Boolean(negative && negative.deepVerdict === "pass"),
    citationsComplete: resultRows.every((row) => row.groundedClaims),
    stableAvailableMemory: Number.isFinite(minAvailableRamBytes) && minAvailableRamBytes >= 4 * (1024 ** 3),
  },
};
report.passed = Object.values(report.gates).every(Boolean);

const stamp = report.generatedAt.replace(/[:.]/g, "-");
const jsonPath = path.join(reportsDir, `calibration-${stamp}.json`);
const markdownPath = path.join(reportsDir, `calibration-${stamp}.md`);
await writeFile(jsonPath, JSON.stringify(report, null, 2));
await writeFile(markdownPath, [
  "# Windows Job Worker Preliminary Calibration",
  "",
  `- Generated: ${report.generatedAt}`,
  `- Scope: ${report.scope}`,
  `- Model: ${report.model}`,
  `- Context/concurrency: ${report.contextTokens} / ${report.concurrency}`,
  `- Duration: ${report.durationSeconds} seconds`,
  `- Result: ${report.passed ? "PASS" : "FAIL"}`,
  `- Minimum available RAM: ${report.resources.minimumAvailableRamGiB} GiB`,
  `- Minimum free VRAM: ${report.resources.minimumFreeVramMiB} MiB`,
  "",
  "## Results",
  "",
  ...report.results.map((row) => `- ${row.label}: triage=${row.triage}, deep=${row.deepVerdict} (${row.deepScore}), critic=${row.criticVerdict}, grounded=${row.groundedClaims}`),
  "",
  "## Gates",
  "",
  ...Object.entries(report.gates).map(([name, passed]) => `- ${name}: ${passed ? "PASS" : "FAIL"}`),
  "",
  "This synthetic run does not authorize or replace the required 20 owner-labelled job calibration.",
  "",
].join("\n"));

process.stdout.write(`${JSON.stringify({ report, jsonPath, markdownPath }, null, 2)}\n`);
process.exitCode = report.passed ? 0 : 2;
