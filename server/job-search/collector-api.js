import { z } from "zod";

import {
  createRun,
  getControlOperation,
  getRun,
  recordDiscoveryLeads,
  saveControlOperation,
  updateRun,
} from "./repository.js";
import { enqueueJobsForLocalProcessing, persistExtractedJobs } from "./workflow.js";

const MAX_BATCH_BYTES = 900_000;
const MAX_BATCH_LEADS = 250;
const MAX_BATCH_JOBS = 120;
const MAX_SOURCE_HEALTH = 12;

const sourceHealthSchema = z.object({
  sourceId: z.string().trim().min(1).max(80),
  status: z.enum(["live", "empty", "blocked", "error", "partial"]),
  pagesVisited: z.number().int().min(0).max(500).default(0),
  resultCount: z.number().int().min(0).max(5000).default(0),
  jobCount: z.number().int().min(0).max(5000).default(0),
  blocked: z.boolean().default(false),
  errors: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  notes: z.string().trim().max(1000).default(""),
  sampleUrls: z.array(z.string().url()).max(5).default([]),
});

const collectorLeadSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().max(300).default(""),
  company: z.string().trim().max(300).default(""),
  location: z.string().trim().max(300).default(""),
  postedAt: z.string().datetime().nullable().optional(),
  postedAtRaw: z.string().trim().max(120).default(""),
  sourceProvider: z.string().trim().min(1).max(120),
  sourceQuery: z.string().trim().max(200).default(""),
  snippet: z.string().trim().max(3000).default(""),
  externalId: z.string().trim().max(200).default(""),
  status: z.string().trim().max(80).default("extraction_pending"),
  ontology: z.object({
    eligible: z.boolean().optional(),
    lane: z.string().trim().max(80).optional(),
    familyId: z.string().trim().max(80).optional(),
    reason: z.string().trim().max(500).optional(),
  }).passthrough().default({}),
  raw: z.record(z.string(), z.any()).default({}),
});

const collectorJobSchema = z.object({
  sourceId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(24000),
  url: z.string().url(),
  canonicalUrl: z.string().url().optional(),
  location: z.string().trim().max(300).default(""),
  postedAt: z.string().datetime().nullable().optional(),
  postedAtRaw: z.string().trim().max(120).default(""),
  sourceProvider: z.string().trim().min(1).max(120),
  sourceQuery: z.string().trim().max(200).default(""),
  raw: z.record(z.string(), z.any()).default({}),
});

const collectorBatchSchema = z.object({
  operationKey: z.string().trim().min(8).max(160),
  collectorRunId: z.string().trim().min(8).max(120),
  collectorRunLabel: z.string().trim().max(200).default("Windows collector"),
  final: z.boolean().default(true),
  selectedSources: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  sourceHealth: z.array(sourceHealthSchema).max(MAX_SOURCE_HEALTH).default([]),
  leads: z.array(collectorLeadSchema).max(MAX_BATCH_LEADS).default([]),
  jobs: z.array(collectorJobSchema).max(MAX_BATCH_JOBS).default([]),
  errors: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
});

function ensurePayloadSize(input) {
  const bytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (bytes > MAX_BATCH_BYTES) {
    const error = new Error(`Collector batch exceeded ${MAX_BATCH_BYTES} bytes.`);
    error.statusCode = 413;
    throw error;
  }
}

function mergeCollectorProviders(existing = {}, batch) {
  const previousSources = existing.collector?.sources || {};
  const nextSources = { ...previousSources };
  batch.sourceHealth.forEach((source) => {
    nextSources[source.sourceId] = {
      status: source.status,
      pagesVisited: source.pagesVisited,
      resultCount: source.resultCount,
      jobCount: source.jobCount,
      blocked: source.blocked,
      errors: source.errors,
      notes: source.notes,
      sampleUrls: source.sampleUrls,
      updatedAt: new Date().toISOString(),
    };
  });
  return {
    ...existing,
    collector: {
      selectedSources: batch.selectedSources,
      batchesProcessed: Number(existing.collector?.batchesProcessed || 0) + 1,
      lastBatchAt: new Date().toISOString(),
      sources: nextSources,
    },
  };
}

function mergeCollectorErrors(existing = [], batch) {
  const combined = [...existing];
  batch.errors.forEach((item) => combined.push({ stage: "collector", message: item }));
  batch.sourceHealth
    .filter((source) => source.status === "blocked" || source.status === "error")
    .forEach((source) => {
      combined.push({
        stage: `collector:${source.sourceId}`,
        message: source.errors[0] || `${source.sourceId} reported ${source.status}.`,
      });
    });
  if (!batch.leads.length && !batch.jobs.length && !batch.sourceHealth.some((source) => source.status !== "empty")) {
    combined.push({
      stage: "collector",
      message: "Collector returned zero leads and zero jobs; source-health metrics were persisted for inspection.",
    });
  }
  return combined.slice(-40);
}

function mergeCollectorStats(existing = {}, counts) {
  return {
    ...existing,
    discovered: Number(existing.discovered || 0) + counts.discovered,
    changed: Number(existing.changed || 0) + counts.changed,
    localQueued: Number(existing.localQueued || 0) + counts.localQueued,
  };
}

export async function submitCollectorBatch(input) {
  ensurePayloadSize(input);
  const batch = collectorBatchSchema.parse(input || {});
  const existingOperation = await getControlOperation("collector_batch", batch.operationKey);
  if (existingOperation?.result) return existingOperation.result;

  const run = await createRun({
    id: batch.collectorRunId,
    trigger: "windows-collector",
    status: "running",
    phase: "discovery",
  });
  const existingRun = await getRun(run.id);

  const recordedLeads = await recordDiscoveryLeads(batch.leads.map((lead) => ({
    ...lead,
    runId: run.id,
    status: lead.status || (lead.title ? "extraction_pending" : "metadata_pending"),
  })));
  const changedJobs = await persistExtractedJobs(batch.jobs);
  const queued = process.env.JOBSEARCH_LOCAL_WORKER_ENABLED === "true"
    ? await enqueueJobsForLocalProcessing({ runId: run.id, jobIds: changedJobs.map((job) => job.id) })
    : { queuedCount: 0, taskIds: [] };

  const counts = {
    discovered: recordedLeads.length,
    changed: changedJobs.length,
    localQueued: queued.queuedCount,
  };
  const providers = mergeCollectorProviders(existingRun?.providers || {}, batch);
  const errors = mergeCollectorErrors(existingRun?.errors || [], batch);
  const status = batch.final
    ? errors.length ? "partial" : "completed"
    : "running";
  const phase = batch.final ? "queued_local" : "discovery";
  const stats = mergeCollectorStats(existingRun?.stats || {}, counts);
  const updatedRun = await updateRun(run.id, { status, phase, stats, providers, errors });

  const result = {
    ok: true,
    runId: run.id,
    operationKey: batch.operationKey,
    counts: {
      recordedLeads: recordedLeads.length,
      changedJobs: changedJobs.length,
      localQueued: queued.queuedCount,
    },
    queueTaskIds: queued.taskIds,
    run: updatedRun,
  };
  await saveControlOperation("collector_batch", batch.operationKey, { result });
  return result;
}
