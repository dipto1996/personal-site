import { Inngest } from "inngest";

import { createRun, listRuns, updateRun } from "./repository.js";
import { providerConfiguration } from "./providers.js";
import {
  executeJobSearchRun,
  enqueueJobsForLocalProcessing,
  runCriticStage,
  runDeepStage,
  runDiscoveryStage,
  runOutreachStage,
  selectCriticJobIds,
  selectDeepJobIds,
  runTaxonomyStage,
  runTriageStage,
} from "./workflow.js";

export const jobSearchInngest = new Inngest({ id: "personal-site-job-search" });

function batches(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function runDurablePipeline({ step, runId, trigger, slot, discoveryUrls = [] }) {
  const stats = { discovered: 0, changed: 0, triaged: 0, deepEvaluated: 0, criticised: 0, shortlisted: 0, taxonomyProposals: 0, localQueued: 0 };

  await step.run("mark-running", () => updateRun(runId, { status: "running", phase: "discovery", stats }));
  const discovery = await step.run("discover-and-persist", () => runDiscoveryStage({ runId, trigger, slot, discoveryUrls }));
  stats.discovered = discovery.discoveredCount;
  stats.changed = discovery.changedCount;
  if (process.env.JOBSEARCH_LOCAL_WORKER_ENABLED === "true") {
    const local = await step.run("queue-local-inference", () => enqueueJobsForLocalProcessing({ runId, jobIds: discovery.jobIds }));
    stats.localQueued = local.queuedCount;
    return step.run("complete-cloud-control-plane", () => updateRun(runId, {
      status: "completed",
      phase: "queued_local",
      stats,
      providers: { ...discovery.providers, local: { status: "queued", queued: local.queuedCount } },
      errors: [],
    }));
  }
  await step.run("mark-triage", () => updateRun(runId, { status: "running", phase: "triage", stats, providers: discovery.providers }));

  const triageJobIds = [];
  for (const [index, jobIds] of batches(discovery.jobIds, 6).entries()) {
    const triage = await step.run(`free-model-triage-${index + 1}`, () => runTriageStage({ runId, jobIds }));
    triageJobIds.push(...triage.jobIds);
    stats.triaged += triage.triagedCount;
  }
  await step.run("mark-deep", () => updateRun(runId, { status: "running", phase: "deep_evaluation", stats, providers: discovery.providers }));

  const deepCandidateIds = await step.run("select-deep-candidates", () => selectDeepJobIds({ jobIds: triageJobIds }));
  const deepJobIds = [];
  let deepBlocked = 0;
  for (const [index, jobId] of deepCandidateIds.entries()) {
    if (index > 0) await step.sleep(`pace-free-deep-model-${index + 1}`, "65s");
    const deep = await step.run(`free-deep-evaluation-${index + 1}`, () => runDeepStage({
      runId, jobIds: [jobId], includeBacklog: false,
    }));
    deepJobIds.push(...deep.jobIds);
    stats.deepEvaluated += deep.evaluatedCount;
    deepBlocked += deep.blockedCount;
  }
  await step.run("mark-critic", () => updateRun(runId, { status: "running", phase: "criticism", stats, providers: discovery.providers }));

  const criticCandidateIds = await step.run("select-critic-candidates", () => selectCriticJobIds({ jobIds: deepJobIds }));
  const shortlistIds = [];
  let criticBlocked = 0;
  for (const [index, jobId] of criticCandidateIds.entries()) {
    const critic = await step.run(`independent-model-critic-${index + 1}`, () => runCriticStage({
      runId, jobIds: [jobId], includeBacklog: false,
    }));
    stats.criticised += critic.reviewedCount;
    criticBlocked += critic.blockedCount;
    shortlistIds.push(...critic.shortlistIds);
  }
  stats.shortlisted = shortlistIds.length;
  for (const [index, jobId] of shortlistIds.entries()) {
    await step.run(`draft-outreach-${index + 1}`, () => runOutreachStage({ runId, jobIds: [jobId] }));
  }

  const taxonomy = await step.run("taxonomy-learning", () => runTaxonomyStage({ runId, slot }));
  stats.taxonomyProposals = taxonomy.proposalCount;

  const configuration = providerConfiguration();
  const missing = ["serpapi", "brave", "tavily"].filter((key) => !configuration[key]);
  if (!["groq", "cloudflare", "openrouter", "zai"].some((key) => configuration[key])) missing.push("model_router");
  const providerBlocked = deepBlocked + criticBlocked;
  const status = missing.length || providerBlocked ? "partial" : "completed";
  return step.run("complete-run", () => updateRun(runId, {
    status,
    phase: "complete",
    stats,
    providers: discovery.providers,
    errors: [
      ...(missing.length ? [{ stage: "configuration", message: `Missing providers: ${missing.join(", ")}` }] : []),
      ...(providerBlocked ? [{ stage: "models", message: `${providerBlocked} model evaluations exhausted configured free routes or quotas.` }] : []),
    ],
  }));
}

async function runCalibrationPipeline({ step, runId, jobIds }) {
  const cohortJobIds = [...new Set((Array.isArray(jobIds) ? jobIds : []).map(String).filter(Boolean))].slice(0, 20);
  const stats = {
    cohortJobIds,
    requested: cohortJobIds.length,
    triaged: 0,
    deepEvaluated: 0,
    criticised: 0,
    blocked: 0,
  };
  if (!cohortJobIds.length) throw new Error("A calibration cohort is required.");

  await step.run("mark-calibration-triage", () => updateRun(runId, {
    status: "running",
    phase: "calibration_triage",
    stats,
  }));
  for (const [index, batch] of batches(cohortJobIds, 3).entries()) {
    const triage = await step.run(`calibration-triage-${index + 1}`, () => runTriageStage({
      runId,
      jobIds: batch,
    }));
    stats.triaged += triage.triagedCount;
    await step.run(`record-calibration-triage-progress-${index + 1}`, () => updateRun(runId, {
      status: "running",
      phase: "calibration_triage",
      stats,
    }));
  }

  await step.run("mark-calibration-deep", () => updateRun(runId, {
    status: "running",
    phase: "calibration_deep_evaluation",
    stats,
  }));
  const deepCompletedJobIds = [];
  for (const [index, jobId] of cohortJobIds.entries()) {
    if (index > 0) await step.sleep(`pace-calibration-deep-${index + 1}`, "65s");
    const deep = await step.run(`calibration-deep-${index + 1}`, () => runDeepStage({
      runId,
      jobIds: [jobId],
      includeBacklog: false,
    }));
    stats.deepEvaluated += deep.evaluatedCount;
    stats.blocked += deep.blockedCount;
    if (deep.evaluatedCount === 1) deepCompletedJobIds.push(jobId);
    await step.run(`record-calibration-deep-progress-${index + 1}`, () => updateRun(runId, {
      status: "running",
      phase: "calibration_deep_evaluation",
      stats,
    }));
  }

  await step.run("mark-calibration-critic", () => updateRun(runId, {
    status: "running",
    phase: "calibration_criticism",
    stats,
  }));
  for (const [index, jobId] of deepCompletedJobIds.entries()) {
    if (index > 0) await step.sleep(`pace-calibration-critic-${index + 1}`, "20s");
    const critic = await step.run(`calibration-critic-${index + 1}`, () => runCriticStage({
      runId,
      jobIds: [jobId],
      includeBacklog: false,
    }));
    stats.criticised += critic.reviewedCount;
    stats.blocked += critic.blockedCount;
    await step.run(`record-calibration-critic-progress-${index + 1}`, () => updateRun(runId, {
      status: "running",
      phase: "calibration_criticism",
      stats,
    }));
  }

  const status = stats.deepEvaluated === stats.requested && stats.criticised === stats.requested
    ? "completed"
    : "partial";
  return step.run("complete-calibration", () => updateRun(runId, {
    status,
    phase: "complete",
    stats,
    providers: { configuration: providerConfiguration(), paidFallbacks: "disabled" },
    errors: status === "completed" ? [] : [{
      stage: "models",
      message: `${stats.blocked} evaluator or critic calls exhausted configured free routes or quotas.`,
    }],
  }));
}

export const requestedJobSearchRun = jobSearchInngest.createFunction(
  {
    id: "requested-job-search-run",
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [{ event: "job-search/run.requested" }],
    onFailure: async ({ event, error }) => {
      const runId = event.data?.event?.data?.runId;
      if (runId) {
        await updateRun(runId, {
          status: "failed",
          phase: "failed",
          errors: [{ stage: "workflow", message: error?.message || "Inngest workflow exhausted retries." }],
        });
      }
    },
  },
  async ({ event, step }) => runDurablePipeline({
    step,
    runId: event.data.runId,
    trigger: event.data.trigger || "manual",
    slot: event.data.slot || "morning",
    discoveryUrls: event.data.discoveryUrls || [],
  }),
);

export const requestedJobSearchCalibration = jobSearchInngest.createFunction(
  {
    id: "requested-job-search-calibration",
    retries: 2,
    concurrency: { limit: 1 },
    triggers: [{ event: "job-search/calibration.requested" }],
    onFailure: async ({ event, error }) => {
      const runId = event.data?.event?.data?.runId;
      if (runId) {
        await updateRun(runId, {
          status: "failed",
          phase: "failed",
          errors: [{ stage: "calibration", message: error?.message || "Calibration workflow exhausted retries." }],
        });
      }
    },
  },
  async ({ event, step }) => runCalibrationPipeline({
    step,
    runId: event.data.runId,
    jobIds: event.data.jobIds,
  }),
);

function scheduledFunction(id, cron, slot) {
  return jobSearchInngest.createFunction(
    {
      id,
      retries: 2,
      concurrency: { limit: 1 },
      triggers: [{ cron }],
      onFailure: async ({ error }) => {
        const running = (await listRuns(20)).find((run) => (
          run.trigger === `schedule:${slot}` && ["queued", "running"].includes(run.status)
        ));
        if (running) {
          await updateRun(running.id, {
            status: "failed",
            phase: "failed",
            errors: [{ stage: "workflow", message: error?.message || "Scheduled workflow exhausted retries." }],
          });
        }
      },
    },
    async ({ step }) => {
      const run = await step.run("create-run", () => createRun({ trigger: `schedule:${slot}`, status: "queued", phase: "queued" }));
      return runDurablePipeline({ step, runId: run.id, trigger: "schedule", slot });
    },
  );
}

export const morningJobSearchRun = scheduledFunction("morning-job-search-run", "0 6 * * *", "morning");
export const eveningJobSearchRun = scheduledFunction("evening-job-search-run", "0 18 * * *", "evening");

export const jobSearchFunctions = [
  requestedJobSearchRun,
  requestedJobSearchCalibration,
  morningJobSearchRun,
  eveningJobSearchRun,
];

export async function enqueueJobSearchRun({ runId, trigger = "manual", slot = "morning", discoveryUrls = [] }) {
  if (!process.env.INNGEST_EVENT_KEY) {
    if (process.env.NODE_ENV === "production") {
      const error = new Error("Inngest is not configured for production job-search runs.");
      error.statusCode = 503;
      throw error;
    }
    queueMicrotask(() => {
      executeJobSearchRun({ runId, trigger, slot, discoveryUrls }).catch(() => undefined);
    });
    return { queued: true, transport: "local-inline" };
  }
  const result = await jobSearchInngest.send({
    name: "job-search/run.requested",
    data: { runId, trigger, slot, discoveryUrls },
  });
  return { queued: true, transport: "inngest", eventIds: result.ids || [] };
}

export async function enqueueJobSearchCalibrationRun({ runId, jobIds, operationKey }) {
  if (!process.env.INNGEST_EVENT_KEY) {
    const error = new Error("Inngest is required for durable calibration runs.");
    error.statusCode = 503;
    throw error;
  }
  const result = await jobSearchInngest.send({
    id: `calibration-${String(operationKey || runId).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80)}`,
    name: "job-search/calibration.requested",
    data: { runId, jobIds },
  });
  return { queued: true, transport: "inngest", eventIds: result.ids || [] };
}
