import { neon } from "@neondatabase/serverless";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { seedTitlePatterns } from "./taxonomy.js";
import { normalizeTimestampInput } from "./utils.js";

const DATABASE_URL = process.env.DATABASE_URL || "";
const DATA_DIR = process.env.TRADEGRAPH_DATA_DIR
  ? path.resolve(process.env.TRADEGRAPH_DATA_DIR)
  : path.join(process.cwd(), ".data");
const LOCAL_PATH = path.join(DATA_DIR, "job-search-intelligence.json");
const EMPTY_LOCAL = {
  jobs: [],
  discoveryLeads: [],
  snapshots: [],
  claims: [],
  evaluations: [],
  feedbackEvents: [],
  titlePatterns: [],
  titlePatternHistory: [],
  titleObservations: [],
  companies: [],
  researchCache: [],
  runs: [],
  providerUsage: [],
  localTasks: [],
  workerHeartbeats: [],
  metadata: {},
};

const QUEUE_CONTROL_KEY = "local_queue_control_v1";
const CONTROL_OPERATION_KEY_PREFIX = "control_operation_v1";
const DEFAULT_QUEUE_CONTROL = Object.freeze({
  holdNewTasks: false,
  holdReason: "",
  activeReleaseJobIds: [],
  updatedAt: null,
});

let schemaReady = false;
let localWriteChain = Promise.resolve();

function hasDatabase() {
  return Boolean(DATABASE_URL);
}

function getSql() {
  return neon(DATABASE_URL);
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function canonicalLeadUrl(value) {
  try {
    const url = new URL(value);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId"].forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return String(value || "").trim();
  }
}

function leadDedupeKey(lead) {
  const identity = canonicalLeadUrl(lead.url)
    || `${lead.sourceProvider || "unknown"}|${lead.externalId || ""}|${lead.title || ""}|${lead.company || ""}|${lead.location || ""}`;
  return createHash("md5").update(identity.toLowerCase()).digest("hex");
}

function metadataKey(type, operationKey) {
  return `${CONTROL_OPERATION_KEY_PREFIX}:${type}:${String(operationKey || "").trim()}`;
}

function normalizeQueueControl(value = {}) {
  const activeReleaseJobIds = [...new Set((Array.isArray(value.activeReleaseJobIds) ? value.activeReleaseJobIds : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean))].slice(0, 5000);
  return {
    holdNewTasks: value.holdNewTasks === true,
    holdReason: String(value.holdReason || "").trim().slice(0, 500),
    activeReleaseJobIds,
    updatedAt: value.updatedAt || null,
  };
}

async function readMetadataValue(key) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return (await readLocal()).metadata?.[key] ?? null;
  }
  const sql = getSql();
  const [row] = await sql`SELECT value FROM js_schema_meta WHERE key=${key}`;
  return row?.value ?? null;
}

async function writeMetadataValue(key, value) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      db.metadata = { ...(db.metadata || {}), [key]: value };
      return value;
    });
  }
  const sql = getSql();
  await sql`INSERT INTO js_schema_meta (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`;
  return value;
}

async function ensureLocal() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(LOCAL_PATH, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await writeFile(LOCAL_PATH, JSON.stringify(EMPTY_LOCAL, null, 2));
  }
}

async function readLocal() {
  await ensureLocal();
  const parsed = JSON.parse(await readFile(LOCAL_PATH, "utf8"));
  return { ...structuredClone(EMPTY_LOCAL), ...parsed };
}

async function mutateLocal(mutator) {
  const task = localWriteChain.then(async () => {
    const snapshot = await readLocal();
    const result = await mutator(snapshot);
    const temp = `${LOCAL_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(snapshot, null, 2));
    await rename(temp, LOCAL_PATH);
    return result;
  });
  localWriteChain = task.catch(() => undefined);
  return task;
}

async function ensureDatabaseSchema() {
  if (!hasDatabase() || schemaReady) {
    return;
  }
  const sql = getSql();
  await sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS js_schema_meta (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,
      canonical_url TEXT,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      description TEXT NOT NULL,
      posted_at TIMESTAMPTZ,
      source_provider TEXT NOT NULL,
      source_query TEXT,
      content_hash TEXT NOT NULL,
      role_family_id TEXT,
      status TEXT NOT NULL,
      disposition TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE INDEX IF NOT EXISTS js_jobs_status_idx ON js_jobs(status, updated_at DESC)`,
    sql`CREATE TABLE IF NOT EXISTS js_discovery_leads (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      run_id TEXT,
      external_id TEXT,
      url TEXT NOT NULL,
      title TEXT,
      company TEXT,
      location TEXT,
      posted_at TIMESTAMPTZ,
      source_provider TEXT NOT NULL,
      source_query TEXT,
      snippet TEXT,
      status TEXT NOT NULL,
      ontology JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE INDEX IF NOT EXISTS js_discovery_leads_status_idx
      ON js_discovery_leads(status, last_seen_at DESC)`,
    sql`CREATE TABLE IF NOT EXISTS js_job_snapshots (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES js_jobs(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      captured_at TIMESTAMPTZ NOT NULL,
      UNIQUE(job_id, content_hash)
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_claims (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES js_jobs(id) ON DELETE CASCADE,
      evaluation_id TEXT,
      claim_type TEXT NOT NULL,
      value TEXT NOT NULL,
      source_url TEXT,
      supporting_passage TEXT,
      source_date TEXT,
      confidence DOUBLE PRECISION NOT NULL,
      evidence_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_evaluations (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES js_jobs(id) ON DELETE CASCADE,
      run_id TEXT,
      stage TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      verdict TEXT,
      score DOUBLE PRECISION,
      output JSONB NOT NULL DEFAULT '{}'::jsonb,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_feedback_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES js_jobs(id) ON DELETE CASCADE,
      disposition TEXT NOT NULL,
      reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      note TEXT,
      legacy_feedback INTEGER,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_title_patterns (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      family_label TEXT NOT NULL,
      match_type TEXT NOT NULL,
      expression TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      support_count INTEGER NOT NULL DEFAULT 0,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE(family_id, match_type, expression)
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_title_pattern_history (
      id TEXT PRIMARY KEY,
      pattern_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE INDEX IF NOT EXISTS js_title_pattern_history_pattern_idx
      ON js_title_pattern_history(pattern_id, version DESC)`,
    sql`CREATE TABLE IF NOT EXISTS js_title_observations (
      normalized_title TEXT PRIMARY KEY,
      raw_title TEXT NOT NULL,
      family_id TEXT,
      matched_pattern_id TEXT,
      discovery_source TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      domain TEXT,
      ats_provider TEXT,
      ats_identifier TEXT,
      watchlist BOOLEAN NOT NULL DEFAULT FALSE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_research_cache (
      cache_key TEXT PRIMARY KEY,
      company TEXT,
      topic TEXT NOT NULL,
      result JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_runs (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      stats JSONB NOT NULL DEFAULT '{}'::jsonb,
      providers JSONB NOT NULL DEFAULT '{}'::jsonb,
      errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE TABLE IF NOT EXISTS js_provider_usage (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      provider TEXT NOT NULL,
      operation TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 1,
      estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      occurred_at TIMESTAMPTZ NOT NULL
    )`,
    sql`CREATE INDEX IF NOT EXISTS js_provider_usage_month_idx ON js_provider_usage(occurred_at, provider)`,
    sql`CREATE TABLE IF NOT EXISTS js_local_tasks (
      id TEXT PRIMARY KEY,
      task_key TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL REFERENCES js_jobs(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error TEXT,
      available_at TIMESTAMPTZ NOT NULL,
      lease_until TIMESTAMPTZ,
      leased_by TEXT,
      lease_token TEXT,
      result_id TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ
    )`,
    sql`ALTER TABLE js_local_tasks ADD COLUMN IF NOT EXISTS lease_token TEXT`,
    sql`ALTER TABLE js_local_tasks ADD COLUMN IF NOT EXISTS result_id TEXT`,
    sql`CREATE INDEX IF NOT EXISTS js_local_tasks_queue_idx
      ON js_local_tasks(status, available_at, priority DESC, created_at)`,
    sql`CREATE TABLE IF NOT EXISTS js_worker_heartbeats (
      worker_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      version TEXT,
      current_task_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL
    )`,
  ]);

  await sql`WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY LOWER(url)
      ORDER BY CASE WHEN status='extracted' THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(company, '') <> '' THEN 0 ELSE 1 END,
        updated_at DESC
    ) AS duplicate_rank
    FROM js_discovery_leads
  ) DELETE FROM js_discovery_leads
    WHERE id IN (SELECT id FROM ranked WHERE duplicate_rank > 1)`;
  await sql`UPDATE js_discovery_leads SET dedupe_key=MD5(LOWER(url))
    WHERE dedupe_key <> MD5(LOWER(url))`;

  await sql`INSERT INTO js_discovery_leads (
    id, dedupe_key, run_id, external_id, url, title, company, location, posted_at,
    source_provider, source_query, snippet, status, ontology, raw,
    first_seen_at, last_seen_at, created_at, updated_at
  ) SELECT
    'jslead_backfill_' || MD5(id), MD5(LOWER(canonical_url)), NULL, source_id,
    canonical_url, title, company, location, posted_at, source_provider, source_query,
    LEFT(description, 3000), 'extracted', COALESCE(details->'titleClassification'->'ontology', '{}'::jsonb),
    jsonb_build_object('backfilledFromJobId', id), first_seen_at, last_seen_at, created_at, updated_at
  FROM js_jobs
  WHERE COALESCE(canonical_url, '') <> ''
  ON CONFLICT (dedupe_key) DO NOTHING`;

  await sql`WITH salary_snapshots AS (
    SELECT DISTINCT ON (job_id)
      job_id,
      COALESCE(
        NULLIF(raw #>> '{detected_extensions,salary}', ''),
        NULLIF(raw #>> '{extensions,salary}', ''),
        NULLIF(raw ->> 'compensation', '')
      ) AS salary
    FROM js_job_snapshots
    WHERE COALESCE(
      NULLIF(raw #>> '{detected_extensions,salary}', ''),
      NULLIF(raw #>> '{extensions,salary}', ''),
      NULLIF(raw ->> 'compensation', '')
    ) IS NOT NULL
    ORDER BY job_id, captured_at DESC
  )
  UPDATE js_jobs AS job
  SET details = COALESCE(job.details, '{}'::jsonb) || jsonb_build_object(
    'sourceMetadata',
    COALESCE(job.details->'sourceMetadata', '{}'::jsonb) || jsonb_build_object('compensation', salary_snapshots.salary)
  )
  FROM salary_snapshots
  WHERE job.id = salary_snapshots.job_id
    AND COALESCE(job.details #>> '{sourceMetadata,compensation}', '') = ''`;

  const patterns = seedTitlePatterns();
  for (const pattern of patterns) {
    await sql`INSERT INTO js_title_patterns (
      id, family_id, family_label, match_type, expression, status, source, version,
      support_count, metrics, created_at, updated_at
    ) VALUES (
      ${pattern.id}, ${pattern.familyId}, ${pattern.familyLabel}, ${pattern.matchType},
      ${pattern.expression}, ${pattern.status}, ${pattern.source}, ${pattern.version},
      ${pattern.supportCount}, ${JSON.stringify(pattern.metrics)}, ${pattern.createdAt}, ${pattern.updatedAt}
    ) ON CONFLICT (id) DO UPDATE SET
      family_label=EXCLUDED.family_label,
      updated_at=CASE WHEN js_title_patterns.source='seed' THEN EXCLUDED.updated_at ELSE js_title_patterns.updated_at END`;
  }

  const migration = await sql`SELECT value FROM js_schema_meta WHERE key = 'legacy_import_v1'`;
  if (!migration.length) {
    const legacyExists = await sql`SELECT to_regclass('public.tg_job_search_jobs') AS table_name`;
    if (legacyExists[0]?.table_name) {
      await sql`INSERT INTO js_jobs (
        id, source_id, canonical_url, title, normalized_title, company, location, description,
        posted_at, source_provider, source_query, content_hash, role_family_id, status,
        disposition, details, first_seen_at, last_seen_at, created_at, updated_at
      ) SELECT
        id, source_id, url, title, LOWER(REGEXP_REPLACE(title, '[^a-zA-Z0-9]+', ' ', 'g')),
        company, location, description, posted_at, source_provider, source_query,
        MD5(COALESCE(title,'') || COALESCE(company,'') || COALESCE(description,'')),
        raw->'jobSearch'->'rules'->'roleFamily'->>'id',
        CASE WHEN is_match THEN 'shortlisted' ELSE 'passed' END,
        CASE WHEN user_feedback = 1 THEN 'apply' WHEN user_feedback = -1 THEN 'pass' ELSE NULL END,
        jsonb_build_object('legacy', true, 'legacyRaw', raw, 'llmScore', llm_score, 'llmReasoning', llm_reasoning),
        created_at, updated_at, created_at, updated_at
      FROM tg_job_search_jobs
      ON CONFLICT (source_id) DO NOTHING`;
      await sql`INSERT INTO js_feedback_events (
        id, job_id, disposition, reasons, note, legacy_feedback, created_at
      ) SELECT
        'legacy_feedback_' || MD5(id), id,
        CASE WHEN user_feedback = 1 THEN 'apply' ELSE 'pass' END,
        '[]'::jsonb, 'Imported from the legacy job-search tool.', user_feedback, updated_at
      FROM tg_job_search_jobs
      WHERE user_feedback IN (-1, 1)
      ON CONFLICT (id) DO NOTHING`;
    }
    await sql`INSERT INTO js_schema_meta (key, value, updated_at)
      VALUES ('legacy_import_v1', ${JSON.stringify({ completedAt: nowIso() })}, NOW())
      ON CONFLICT (key) DO NOTHING`;
  }

  schemaReady = true;
}

export async function ensureJobSearchRepository() {
  if (hasDatabase()) {
    await ensureDatabaseSchema();
    return;
  }
  await mutateLocal((db) => {
    if (!db.titlePatterns.length) {
      db.titlePatterns = seedTitlePatterns();
    }
    return true;
  });
}

export async function getLocalQueueControl() {
  return normalizeQueueControl(await readMetadataValue(QUEUE_CONTROL_KEY) || DEFAULT_QUEUE_CONTROL);
}

export async function setLocalQueueControl(patch = {}) {
  const current = await getLocalQueueControl();
  const next = normalizeQueueControl({ ...current, ...patch, updatedAt: nowIso() });
  await writeMetadataValue(QUEUE_CONTROL_KEY, next);
  return next;
}

export async function getControlOperation(type, operationKey) {
  if (!String(type || "").trim() || !String(operationKey || "").trim()) return null;
  return await readMetadataValue(metadataKey(type, operationKey));
}

export async function saveControlOperation(type, operationKey, value) {
  if (!String(type || "").trim() || !String(operationKey || "").trim()) {
    throw new Error("A control operation type and key are required.");
  }
  return writeMetadataValue(metadataKey(type, operationKey), {
    ...value,
    type,
    operationKey: String(operationKey).trim(),
    storedAt: nowIso(),
  });
}

export async function createRun({ id: providedId = "", trigger = "manual", status = "queued", phase = "queued" } = {}) {
  await ensureJobSearchRepository();
  if (providedId) {
    const existing = await getRun(providedId);
    if (existing) return existing;
  }
  const run = {
    id: providedId || id("jsrun"),
    trigger,
    status,
    phase,
    stats: {},
    providers: {},
    errors: [],
    startedAt: nowIso(),
    completedAt: null,
    updatedAt: nowIso(),
  };
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      db.runs.push(run);
      return run;
    });
  }
  const sql = getSql();
  await sql`INSERT INTO js_runs (id, trigger, status, phase, stats, providers, errors, started_at, completed_at, updated_at)
    VALUES (${run.id}, ${run.trigger}, ${run.status}, ${run.phase}, ${JSON.stringify(run.stats)},
    ${JSON.stringify(run.providers)}, ${JSON.stringify(run.errors)}, ${run.startedAt}, NULL, ${run.updatedAt})`;
  return run;
}

export async function updateRun(runId, patch = {}) {
  await ensureJobSearchRepository();
  const completedAt = patch.completedAt || (["completed", "partial", "failed", "blocked"].includes(patch.status) ? nowIso() : null);
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const index = db.runs.findIndex((run) => run.id === runId);
      if (index < 0) return null;
      db.runs[index] = { ...db.runs[index], ...patch, ...(completedAt ? { completedAt } : {}), updatedAt: nowIso() };
      return db.runs[index];
    });
  }
  const sql = getSql();
  const [existing] = await sql`SELECT * FROM js_runs WHERE id = ${runId}`;
  if (!existing) return null;
  const next = {
    status: patch.status || existing.status,
    phase: patch.phase || existing.phase,
    stats: patch.stats || existing.stats,
    providers: patch.providers || existing.providers,
    errors: patch.errors || existing.errors,
  };
  const [row] = await sql`UPDATE js_runs SET status=${next.status}, phase=${next.phase},
    stats=${JSON.stringify(next.stats)}, providers=${JSON.stringify(next.providers)}, errors=${JSON.stringify(next.errors)},
    completed_at=${completedAt || existing.completed_at}, updated_at=NOW() WHERE id=${runId}
    RETURNING id, trigger, status, phase, stats, providers, errors, started_at AS "startedAt",
    completed_at AS "completedAt", updated_at AS "updatedAt"`;
  return row;
}

export async function getRun(runId) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) return (await readLocal()).runs.find((run) => run.id === runId) || null;
  const sql = getSql();
  const [row] = await sql`SELECT id, trigger, status, phase, stats, providers, errors,
    started_at AS "startedAt", completed_at AS "completedAt", updated_at AS "updatedAt"
    FROM js_runs WHERE id=${runId}`;
  return row || null;
}

export async function listRuns(limit = 20) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return (await readLocal()).runs.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }
  const sql = getSql();
  return sql`SELECT id, trigger, status, phase, stats, providers, errors,
    started_at AS "startedAt", completed_at AS "completedAt", updated_at AS "updatedAt"
    FROM js_runs ORDER BY started_at DESC LIMIT ${limit}`;
}

export async function upsertJob(job) {
  await ensureJobSearchRepository();
  const now = nowIso();
  const timestamp = normalizeTimestampInput(job.postedAt);
  const sourceMetadata = {
    ...(job.details?.sourceMetadata || {}),
    ...(job.postedAtRaw || (!timestamp.iso && timestamp.raw) ? {
      postedAtRaw: String(job.postedAtRaw || timestamp.raw || "").trim().slice(0, 200),
    } : {}),
  };
  const record = {
    id: job.id || id("jsjob"),
    sourceId: job.sourceId,
    canonicalUrl: job.canonicalUrl || job.url || "",
    title: job.title,
    normalizedTitle: job.normalizedTitle,
    company: job.company,
    location: job.location || "",
    description: job.description,
    postedAt: timestamp.iso,
    sourceProvider: job.sourceProvider || "unknown",
    sourceQuery: job.sourceQuery || "",
    contentHash: job.contentHash,
    roleFamilyId: job.roleFamilyId || null,
    status: job.status || "discovered",
    disposition: job.disposition || null,
    details: Object.keys(sourceMetadata).length
      ? { ...(job.details || {}), sourceMetadata }
      : (job.details || {}),
    firstSeenAt: job.firstSeenAt || now,
    lastSeenAt: now,
    createdAt: job.createdAt || now,
    updatedAt: now,
  };
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const index = db.jobs.findIndex((item) => item.sourceId === record.sourceId);
      if (index >= 0) {
        record.id = db.jobs[index].id;
        record.createdAt = db.jobs[index].createdAt;
        record.firstSeenAt = db.jobs[index].firstSeenAt;
        record.disposition = record.disposition || db.jobs[index].disposition;
        db.jobs[index] = { ...db.jobs[index], ...record };
      } else {
        db.jobs.push(record);
      }
      return record;
    });
  }
  const sql = getSql();
  const [row] = await sql`INSERT INTO js_jobs (
    id, source_id, canonical_url, title, normalized_title, company, location, description, posted_at,
    source_provider, source_query, content_hash, role_family_id, status, disposition, details,
    first_seen_at, last_seen_at, created_at, updated_at
  ) VALUES (
    ${record.id}, ${record.sourceId}, ${record.canonicalUrl}, ${record.title}, ${record.normalizedTitle},
    ${record.company}, ${record.location}, ${record.description}, ${record.postedAt}, ${record.sourceProvider},
    ${record.sourceQuery}, ${record.contentHash}, ${record.roleFamilyId}, ${record.status}, ${record.disposition},
    ${JSON.stringify(record.details)}, ${record.firstSeenAt}, ${record.lastSeenAt}, ${record.createdAt}, ${record.updatedAt}
  ) ON CONFLICT (source_id) DO UPDATE SET
    canonical_url=EXCLUDED.canonical_url, title=EXCLUDED.title, normalized_title=EXCLUDED.normalized_title,
    company=EXCLUDED.company, location=EXCLUDED.location, description=EXCLUDED.description,
    posted_at=EXCLUDED.posted_at, source_provider=EXCLUDED.source_provider, source_query=EXCLUDED.source_query,
    content_hash=EXCLUDED.content_hash, role_family_id=EXCLUDED.role_family_id, status=EXCLUDED.status,
    disposition=COALESCE(EXCLUDED.disposition, js_jobs.disposition), details=EXCLUDED.details,
    last_seen_at=EXCLUDED.last_seen_at, updated_at=EXCLUDED.updated_at
  RETURNING id, source_id AS "sourceId", canonical_url AS "canonicalUrl", title,
    normalized_title AS "normalizedTitle", company, location, description, posted_at AS "postedAt",
    source_provider AS "sourceProvider", source_query AS "sourceQuery", content_hash AS "contentHash",
    role_family_id AS "roleFamilyId", status, disposition, details, first_seen_at AS "firstSeenAt",
    last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"`;
  return row;
}

export async function updateJobClassification(jobId, classification) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const job = db.jobs.find((item) => item.id === jobId);
      if (!job) return null;
      job.normalizedTitle = classification.normalizedTitle;
      job.roleFamilyId = classification.roleFamilyId;
      job.details = {
        ...(job.details || {}),
        titleClassification: classification.titleClassification,
      };
      job.updatedAt = timestamp;
      return structuredClone(job);
    });
  }
  const sql = getSql();
  const [row] = await sql`UPDATE js_jobs SET
    normalized_title=${classification.normalizedTitle},
    role_family_id=${classification.roleFamilyId},
    details=jsonb_set(COALESCE(details, '{}'::jsonb), '{titleClassification}', ${JSON.stringify(classification.titleClassification)}::jsonb, true),
    updated_at=${timestamp}
    WHERE id=${jobId}
    RETURNING id, source_id AS "sourceId", canonical_url AS "canonicalUrl", title,
      normalized_title AS "normalizedTitle", company, location, description, posted_at AS "postedAt",
      source_provider AS "sourceProvider", source_query AS "sourceQuery", content_hash AS "contentHash",
      role_family_id AS "roleFamilyId", status, disposition, details, first_seen_at AS "firstSeenAt",
      last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"`;
  return row || null;
}

export async function getJob(jobId) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return (await readLocal()).jobs.find((job) => job.id === jobId || job.sourceId === jobId) || null;
  }
  const sql = getSql();
  const [row] = await sql`SELECT id, source_id AS "sourceId", canonical_url AS "canonicalUrl", title,
    normalized_title AS "normalizedTitle", company, location, description, posted_at AS "postedAt",
    source_provider AS "sourceProvider", source_query AS "sourceQuery", content_hash AS "contentHash",
    role_family_id AS "roleFamilyId", status, disposition, details, first_seen_at AS "firstSeenAt",
    last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM js_jobs WHERE id=${jobId} OR source_id=${jobId} LIMIT 1`;
  return row || null;
}

export async function getJobByCanonicalUrl(canonicalUrl) {
  await ensureJobSearchRepository();
  if (!canonicalUrl) return null;
  if (!hasDatabase()) {
    return (await readLocal()).jobs.find((job) => job.canonicalUrl === canonicalUrl) || null;
  }
  const sql = getSql();
  const [row] = await sql`SELECT id, source_id AS "sourceId", canonical_url AS "canonicalUrl", title,
    normalized_title AS "normalizedTitle", company, location, description, posted_at AS "postedAt",
    source_provider AS "sourceProvider", source_query AS "sourceQuery", content_hash AS "contentHash",
    role_family_id AS "roleFamilyId", status, disposition, details, first_seen_at AS "firstSeenAt",
    last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM js_jobs WHERE canonical_url=${canonicalUrl} ORDER BY updated_at DESC LIMIT 1`;
  return row || null;
}

function matchesJobView(job, view) {
  if (job.sourceProvider === "sample") return false;
  const triageRelevance = job.details?.triage?.relevance;
  if (["all", "all_candidates"].includes(view)) return true;
  if (view === "relevant") return triageRelevance === "relevant";
  if (view === "uncertain") return triageRelevance === "uncertain";
  if (view === "clear_mismatch") return triageRelevance === "irrelevant" || job.status === "triage_rejected";
  if (view === "shortlist") return job.status === "shortlisted" || job.disposition === "apply";
  if (view === "needs_review") return ["needs_review", "deep_review_pending", "triage_pending", "local_triage_pending"].includes(job.status) || job.disposition === "maybe";
  if (view === "passed") return ["passed", "triage_rejected"].includes(job.status) || job.disposition === "pass";
  if (view === "expired") return job.status === "expired";
  return !["passed", "expired"].includes(job.status) && job.disposition !== "pass";
}

function matchesDecisionSource(job, decisionSource) {
  if (decisionSource === "owner") return Boolean(job.disposition);
  if (decisionSource === "model") return !job.disposition;
  return true;
}

export async function listJobs({ view = "inbox", limit = 500, offset = 0, decisionSource = "all", roleFamily = "all" } = {}) {
  await ensureJobSearchRepository();
  const filter = (job) => matchesJobView(job, view)
    && matchesDecisionSource(job, decisionSource)
    && (roleFamily === "all" || job.roleFamilyId === roleFamily);
  const boundedLimit = Math.max(0, Math.min(5000, Number(limit) || 500));
  const boundedOffset = Math.max(0, Number(offset) || 0);
  if (!hasDatabase()) {
    return (await readLocal()).jobs.filter(filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(boundedOffset, boundedOffset + boundedLimit);
  }
  const sql = getSql();
  const rows = await sql`SELECT id, source_id AS "sourceId", canonical_url AS "canonicalUrl", title,
    normalized_title AS "normalizedTitle", company, location, description, posted_at AS "postedAt",
    source_provider AS "sourceProvider", source_query AS "sourceQuery", content_hash AS "contentHash",
    role_family_id AS "roleFamilyId", status, disposition, details, first_seen_at AS "firstSeenAt",
    last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM js_jobs ORDER BY updated_at DESC LIMIT 5000`;
  return rows.filter(filter).slice(boundedOffset, boundedOffset + boundedLimit);
}

export async function upsertDiscoveryLead(lead) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  const postedTimestamp = normalizeTimestampInput(lead.postedAt);
  const record = {
    id: lead.id || id("jslead"),
    dedupeKey: lead.dedupeKey || leadDedupeKey(lead),
    runId: lead.runId || null,
    externalId: lead.externalId || "",
    url: canonicalLeadUrl(lead.url),
    title: String(lead.title || "").trim(),
    company: String(lead.company || "").trim(),
    location: String(lead.location || "").trim(),
    postedAt: postedTimestamp.iso,
    sourceProvider: lead.sourceProvider || "unknown",
    sourceQuery: lead.sourceQuery || "",
    snippet: String(lead.snippet || lead.description || "").trim().slice(0, 3000),
    status: lead.status || "discovered",
    ontology: lead.ontology || {},
    raw: {
      ...(lead.raw || {}),
      ...(lead.postedAtRaw || postedTimestamp.raw ? {
        postedAtRaw: String(lead.postedAtRaw || postedTimestamp.raw || "").trim().slice(0, 200),
      } : {}),
    },
    firstSeenAt: lead.firstSeenAt || timestamp,
    lastSeenAt: timestamp,
    createdAt: lead.createdAt || timestamp,
    updatedAt: timestamp,
  };
  if (!record.url) throw new Error("Discovery lead URL is required.");
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const index = db.discoveryLeads.findIndex((item) => item.dedupeKey === record.dedupeKey);
      if (index >= 0) {
        const existing = db.discoveryLeads[index];
        db.discoveryLeads[index] = {
          ...existing,
          ...record,
          id: existing.id,
          firstSeenAt: existing.firstSeenAt,
          createdAt: existing.createdAt,
          raw: { ...(existing.raw || {}), ...(record.raw || {}) },
        };
        return db.discoveryLeads[index];
      }
      db.discoveryLeads.push(record);
      return record;
    });
  }
  const sql = getSql();
  const [row] = await sql`INSERT INTO js_discovery_leads (
    id, dedupe_key, run_id, external_id, url, title, company, location, posted_at,
    source_provider, source_query, snippet, status, ontology, raw,
    first_seen_at, last_seen_at, created_at, updated_at
  ) VALUES (
    ${record.id}, ${record.dedupeKey}, ${record.runId}, ${record.externalId}, ${record.url},
    ${record.title}, ${record.company}, ${record.location}, ${record.postedAt}, ${record.sourceProvider},
    ${record.sourceQuery}, ${record.snippet}, ${record.status}, ${JSON.stringify(record.ontology)},
    ${JSON.stringify(record.raw)}, ${record.firstSeenAt}, ${record.lastSeenAt}, ${record.createdAt}, ${record.updatedAt}
  ) ON CONFLICT (dedupe_key) DO UPDATE SET
    run_id=COALESCE(EXCLUDED.run_id, js_discovery_leads.run_id),
    external_id=COALESCE(NULLIF(EXCLUDED.external_id, ''), js_discovery_leads.external_id),
    url=EXCLUDED.url,
    title=COALESCE(NULLIF(EXCLUDED.title, ''), js_discovery_leads.title),
    company=COALESCE(NULLIF(EXCLUDED.company, ''), js_discovery_leads.company),
    location=COALESCE(NULLIF(EXCLUDED.location, ''), js_discovery_leads.location),
    posted_at=COALESCE(EXCLUDED.posted_at, js_discovery_leads.posted_at),
    source_provider=EXCLUDED.source_provider, source_query=EXCLUDED.source_query,
    snippet=COALESCE(NULLIF(EXCLUDED.snippet, ''), js_discovery_leads.snippet),
    status=EXCLUDED.status, ontology=EXCLUDED.ontology,
    raw=js_discovery_leads.raw || EXCLUDED.raw,
    last_seen_at=EXCLUDED.last_seen_at, updated_at=EXCLUDED.updated_at
  RETURNING id, dedupe_key AS "dedupeKey", run_id AS "runId", external_id AS "externalId",
    url, title, company, location, posted_at AS "postedAt", source_provider AS "sourceProvider",
    source_query AS "sourceQuery", snippet, status, ontology, raw,
    first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt",
    created_at AS "createdAt", updated_at AS "updatedAt"`;
  return row;
}

export async function recordDiscoveryLeads(leads = []) {
  const records = new Map();
  for (const lead of leads) {
    if (!lead?.url) continue;
    const record = await upsertDiscoveryLead(lead);
    records.set(record.dedupeKey, record);
  }
  return [...records.values()];
}

export async function listDiscoveryLeads({ status = "", limit = 1000 } = {}) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return (await readLocal()).discoveryLeads
      .filter((lead) => !status || lead.status === status)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, limit);
  }
  const sql = getSql();
  const rows = await sql`SELECT id, dedupe_key AS "dedupeKey", run_id AS "runId",
    external_id AS "externalId", url, title, company, location, posted_at AS "postedAt",
    source_provider AS "sourceProvider", source_query AS "sourceQuery", snippet, status,
    ontology, raw, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt",
    created_at AS "createdAt", updated_at AS "updatedAt"
    FROM js_discovery_leads ORDER BY last_seen_at DESC LIMIT ${limit}`;
  return rows.filter((lead) => !status || lead.status === status);
}

export async function listTitleObservations({ unmatchedOnly = false, limit = 100 } = {}) {
  await ensureJobSearchRepository();
  let rows;
  if (!hasDatabase()) {
    rows = (await readLocal()).titleObservations;
  } else {
    const sql = getSql();
    rows = await sql`SELECT normalized_title AS "normalizedTitle", raw_title AS "rawTitle",
      family_id AS "familyId", matched_pattern_id AS "matchedPatternId",
      discovery_source AS "discoverySource", occurrence_count AS "occurrenceCount",
      first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
      FROM js_title_observations ORDER BY last_seen_at DESC LIMIT ${limit}`;
  }
  return rows.filter((row) => !unmatchedOnly || !row.matchedPatternId).slice(0, limit);
}

export async function upsertCompany({ name, domain = "", atsProvider = "", atsIdentifier = "", watchlist = false, metadata = {} }) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const existing = db.companies.find((company) => company.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        Object.assign(existing, {
          domain: domain || existing.domain,
          atsProvider: atsProvider || existing.atsProvider,
          atsIdentifier: atsIdentifier || existing.atsIdentifier,
          watchlist: watchlist || existing.watchlist,
          metadata: { ...(existing.metadata || {}), ...metadata },
          updatedAt: timestamp,
        });
        return existing;
      }
      const company = {
        id: id("jscompany"), name, domain, atsProvider, atsIdentifier, watchlist,
        metadata, createdAt: timestamp, updatedAt: timestamp,
      };
      db.companies.push(company);
      return company;
    });
  }
  const sql = getSql();
  const [row] = await sql`INSERT INTO js_companies (
    id, name, domain, ats_provider, ats_identifier, watchlist, metadata, created_at, updated_at
  ) VALUES (${id("jscompany")}, ${name}, ${domain}, ${atsProvider}, ${atsIdentifier}, ${watchlist},
    ${JSON.stringify(metadata)}, ${timestamp}, ${timestamp})
  ON CONFLICT (name) DO UPDATE SET domain=COALESCE(NULLIF(EXCLUDED.domain, ''), js_companies.domain),
    ats_provider=COALESCE(NULLIF(EXCLUDED.ats_provider, ''), js_companies.ats_provider),
    ats_identifier=COALESCE(NULLIF(EXCLUDED.ats_identifier, ''), js_companies.ats_identifier),
    watchlist=js_companies.watchlist OR EXCLUDED.watchlist,
    metadata=js_companies.metadata || EXCLUDED.metadata, updated_at=EXCLUDED.updated_at
  RETURNING id, name, domain, ats_provider AS "atsProvider", ats_identifier AS "atsIdentifier",
    watchlist, metadata, created_at AS "createdAt", updated_at AS "updatedAt"`;
  return row;
}

export async function listCompanies(limit = 100) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return (await readLocal()).companies.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
  const sql = getSql();
  return sql`SELECT id, name, domain, ats_provider AS "atsProvider", ats_identifier AS "atsIdentifier",
    watchlist, metadata, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM js_companies ORDER BY watchlist DESC, updated_at DESC LIMIT ${limit}`;
}

export async function addSnapshot(jobId, snapshot) {
  await ensureJobSearchRepository();
  const record = { id: id("jssnap"), jobId, ...snapshot, capturedAt: nowIso() };
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const existing = db.snapshots.find((item) => item.jobId === jobId && item.contentHash === snapshot.contentHash);
      if (existing) return existing;
      db.snapshots.push(record);
      return record;
    });
  }
  const sql = getSql();
  const [row] = await sql`INSERT INTO js_job_snapshots (id, job_id, content_hash, title, description, raw, captured_at)
    VALUES (${record.id}, ${jobId}, ${record.contentHash}, ${record.title}, ${record.description},
    ${JSON.stringify(record.raw || {})}, ${record.capturedAt}) ON CONFLICT (job_id, content_hash) DO NOTHING RETURNING *`;
  return row || null;
}

export async function recordObservation(observation) {
  await ensureJobSearchRepository();
  const now = nowIso();
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const existing = db.titleObservations.find((item) => item.normalizedTitle === observation.normalizedTitle);
      if (existing) {
        existing.occurrenceCount += 1;
        existing.lastSeenAt = now;
        existing.familyId = observation.familyId || existing.familyId;
        existing.matchedPatternId = observation.matchedPatternId || existing.matchedPatternId;
        return existing;
      }
      const record = { ...observation, occurrenceCount: 1, firstSeenAt: now, lastSeenAt: now };
      db.titleObservations.push(record);
      return record;
    });
  }
  const sql = getSql();
  const [row] = await sql`INSERT INTO js_title_observations (
    normalized_title, raw_title, family_id, matched_pattern_id, discovery_source,
    occurrence_count, first_seen_at, last_seen_at
  ) VALUES (${observation.normalizedTitle}, ${observation.rawTitle}, ${observation.familyId || null},
    ${observation.matchedPatternId || null}, ${observation.discoverySource || ""}, 1, ${now}, ${now})
  ON CONFLICT (normalized_title) DO UPDATE SET occurrence_count=js_title_observations.occurrence_count+1,
    last_seen_at=EXCLUDED.last_seen_at, family_id=COALESCE(EXCLUDED.family_id, js_title_observations.family_id),
    matched_pattern_id=COALESCE(EXCLUDED.matched_pattern_id, js_title_observations.matched_pattern_id)
  RETURNING normalized_title AS "normalizedTitle", raw_title AS "rawTitle", family_id AS "familyId",
    matched_pattern_id AS "matchedPatternId", discovery_source AS "discoverySource",
    occurrence_count AS "occurrenceCount", first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"`;
  return row;
}

export async function listTitlePatterns({ includeInactive = true } = {}) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    const patterns = (await readLocal()).titlePatterns;
    return includeInactive ? patterns : patterns.filter((pattern) => pattern.status === "active");
  }
  const sql = getSql();
  const rows = await sql`SELECT id, family_id AS "familyId", family_label AS "familyLabel",
    match_type AS "matchType", expression, status, source, version, support_count AS "supportCount",
    metrics, created_at AS "createdAt", updated_at AS "updatedAt" FROM js_title_patterns ORDER BY family_label, expression`;
  return includeInactive ? rows : rows.filter((pattern) => pattern.status === "active");
}

export async function saveTitlePattern(pattern) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  const record = { ...pattern, updatedAt: timestamp, createdAt: pattern.createdAt || timestamp };
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const index = db.titlePatterns.findIndex((item) => item.id === record.id
        || (item.familyId === record.familyId && item.matchType === record.matchType && item.expression === record.expression));
      if (index >= 0) {
        const current = db.titlePatterns[index];
        db.titlePatternHistory ||= [];
        db.titlePatternHistory.push({
          id: id("jspatternhistory"), patternId: current.id, version: current.version,
          snapshot: structuredClone(current), createdAt: timestamp,
        });
        db.titlePatterns[index] = { ...current, ...record, id: current.id, version: Number(current.version || 1) + 1 };
        return db.titlePatterns[index];
      }
      else db.titlePatterns.push(record);
      return record;
    });
  }
  const sql = getSql();
  const [current] = await sql`SELECT id, family_id AS "familyId", family_label AS "familyLabel",
    match_type AS "matchType", expression, status, source, version, support_count AS "supportCount",
    metrics, created_at AS "createdAt", updated_at AS "updatedAt" FROM js_title_patterns
    WHERE id=${record.id} OR (family_id=${record.familyId} AND match_type=${record.matchType} AND expression=${record.expression})
    LIMIT 1`;
  if (current) {
    await sql`INSERT INTO js_title_pattern_history (id, pattern_id, version, snapshot, created_at)
      VALUES (${id("jspatternhistory")}, ${current.id}, ${current.version}, ${JSON.stringify(current)}, ${timestamp})`;
  }
  const [row] = await sql`INSERT INTO js_title_patterns (
    id, family_id, family_label, match_type, expression, status, source, version,
    support_count, metrics, created_at, updated_at
  ) VALUES (${record.id}, ${record.familyId}, ${record.familyLabel}, ${record.matchType}, ${record.expression},
    ${record.status}, ${record.source}, ${record.version || 1}, ${record.supportCount || 0},
    ${JSON.stringify(record.metrics || {})}, ${record.createdAt}, ${record.updatedAt})
  ON CONFLICT (family_id, match_type, expression) DO UPDATE SET status=EXCLUDED.status,
    support_count=GREATEST(js_title_patterns.support_count, EXCLUDED.support_count), metrics=EXCLUDED.metrics,
    version=js_title_patterns.version+1, updated_at=EXCLUDED.updated_at
  RETURNING id, family_id AS "familyId", family_label AS "familyLabel", match_type AS "matchType",
    expression, status, source, version, support_count AS "supportCount", metrics,
    created_at AS "createdAt", updated_at AS "updatedAt"`;
  return row;
}

export async function updateTitlePatternStatus(patternId, status) {
  const pattern = (await listTitlePatterns()).find((item) => item.id === patternId);
  if (!pattern) return null;
  return saveTitlePattern({ ...pattern, status });
}

export async function rollbackTitlePattern(patternId) {
  await ensureJobSearchRepository();
  let previous = null;
  if (!hasDatabase()) {
    const db = await readLocal();
    previous = (db.titlePatternHistory || [])
      .filter((item) => item.patternId === patternId)
      .sort((left, right) => Number(right.version) - Number(left.version))[0]?.snapshot || null;
  } else {
    const sql = getSql();
    const [row] = await sql`SELECT snapshot FROM js_title_pattern_history
      WHERE pattern_id=${patternId} ORDER BY version DESC, created_at DESC LIMIT 1`;
    previous = row?.snapshot || null;
  }
  if (!previous) return null;
  return saveTitlePattern({ ...previous, metrics: { ...(previous.metrics || {}), rolledBackAt: nowIso() } });
}

export async function recordEvaluation({ id: evaluationId, jobId, runId, stage, provider, model, promptVersion, verdict, score, output, usage }) {
  await ensureJobSearchRepository();
  const record = {
    id: evaluationId || id("jseval"), jobId, runId: runId || null, stage, provider, model, promptVersion,
    verdict: verdict || null, score: Number.isFinite(Number(score)) ? Number(score) : null,
    output: output || {}, inputTokens: Number(usage?.inputTokens) || 0,
    outputTokens: Number(usage?.outputTokens) || 0, estimatedCostUsd: Number(usage?.estimatedCostUsd) || 0,
    createdAt: nowIso(),
  };
  if (!hasDatabase()) return mutateLocal((db) => {
    const existing = db.evaluations.find((evaluation) => evaluation.id === record.id);
    if (existing) return existing;
    db.evaluations.push(record);
    return record;
  });
  const sql = getSql();
  await sql`INSERT INTO js_evaluations (id, job_id, run_id, stage, provider, model, prompt_version,
    verdict, score, output, input_tokens, output_tokens, estimated_cost_usd, created_at)
    VALUES (${record.id}, ${jobId}, ${record.runId}, ${stage}, ${provider}, ${model}, ${promptVersion},
    ${record.verdict}, ${record.score}, ${JSON.stringify(record.output)}, ${record.inputTokens},
    ${record.outputTokens}, ${record.estimatedCostUsd}, ${record.createdAt})
    ON CONFLICT (id) DO NOTHING`;
  return record;
}

export async function countEvaluationsSince(stage, sinceIso) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return (await readLocal()).evaluations.filter((item) => item.stage === stage && item.createdAt >= sinceIso).length;
  }
  const sql = getSql();
  const [row] = await sql`SELECT COUNT(*)::int AS count FROM js_evaluations WHERE stage=${stage} AND created_at >= ${sinceIso}`;
  return row?.count || 0;
}

export async function replaceClaims(jobId, evaluationId, claims = []) {
  await ensureJobSearchRepository();
  const records = claims.map((claim) => ({ id: id("jsclaim"), jobId, evaluationId, ...claim, createdAt: nowIso() }));
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      db.claims = db.claims.filter((claim) => claim.jobId !== jobId);
      db.claims.push(...records);
      return records;
    });
  }
  const sql = getSql();
  await sql`DELETE FROM js_claims WHERE job_id=${jobId}`;
  for (const claim of records) {
    await sql`INSERT INTO js_claims (id, job_id, evaluation_id, claim_type, value, source_url,
      supporting_passage, source_date, confidence, evidence_type, created_at)
      VALUES (${claim.id}, ${jobId}, ${evaluationId}, ${claim.claimType}, ${claim.value},
      ${claim.sourceUrl || ""}, ${claim.supportingPassage || ""}, ${claim.sourceDate || ""},
      ${claim.confidence}, ${claim.evidenceType}, ${claim.createdAt})`;
  }
  return records;
}

export async function recordFeedback(jobId, { disposition, reasons = [], note = "", legacyFeedback = null }) {
  await ensureJobSearchRepository();
  const record = { id: id("jsfeedback"), jobId, disposition, reasons, note, legacyFeedback, createdAt: nowIso() };
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const job = db.jobs.find((item) => item.id === jobId || item.sourceId === jobId);
      if (!job) return null;
      job.disposition = disposition;
      job.status = disposition === "apply" ? "shortlisted" : disposition === "pass" ? "passed" : "needs_review";
      job.details = { ...(job.details || {}), feedbackReasons: reasons, feedbackNote: note };
      job.updatedAt = nowIso();
      record.jobId = job.id;
      db.feedbackEvents.push(record);
      return job;
    });
  }
  const sql = getSql();
  const status = disposition === "apply" ? "shortlisted" : disposition === "pass" ? "passed" : "needs_review";
  const [job] = await sql`UPDATE js_jobs SET disposition=${disposition}, status=${status},
    details=COALESCE(details, '{}'::jsonb) || ${JSON.stringify({ feedbackReasons: reasons, feedbackNote: note })}::jsonb,
    updated_at=NOW() WHERE id=${jobId} OR source_id=${jobId} RETURNING id`;
  if (!job) return null;
  record.jobId = job.id;
  await sql`INSERT INTO js_feedback_events (id, job_id, disposition, reasons, note, legacy_feedback, created_at)
    VALUES (${record.id}, ${record.jobId}, ${disposition}, ${JSON.stringify(reasons)}, ${note},
    ${legacyFeedback}, ${record.createdAt})`;
  return getJob(job.id);
}

export async function listFeedbackExamples(familyId, limit = 12) {
  await ensureJobSearchRepository();
  const jobs = await listJobs({ view: "all", limit: 1000 });
  return jobs.filter((job) => job.roleFamilyId === familyId && job.disposition).slice(0, limit)
    .map((job) => ({ title: job.title, company: job.company, disposition: job.disposition, reasons: job.details?.feedbackReasons || [] }));
}

export async function recordProviderUsage(entry) {
  await ensureJobSearchRepository();
  const record = {
    id: id("jsusage"), runId: entry.runId || null, provider: entry.provider,
    operation: entry.operation, model: entry.model || null, inputTokens: Number(entry.inputTokens) || 0,
    outputTokens: Number(entry.outputTokens) || 0, requestCount: Number(entry.requestCount) || 1,
    estimatedCostUsd: Number(entry.estimatedCostUsd) || 0, occurredAt: entry.occurredAt || nowIso(),
  };
  if (!hasDatabase()) return mutateLocal((db) => { db.providerUsage.push(record); return record; });
  const sql = getSql();
  await sql`INSERT INTO js_provider_usage (id, run_id, provider, operation, model, input_tokens,
    output_tokens, request_count, estimated_cost_usd, occurred_at)
    VALUES (${record.id}, ${record.runId}, ${record.provider}, ${record.operation}, ${record.model},
    ${record.inputTokens}, ${record.outputTokens}, ${record.requestCount}, ${record.estimatedCostUsd}, ${record.occurredAt})`;
  return record;
}

export async function getUsageSummary(date = new Date()) {
  await ensureJobSearchRepository();
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
  let rows;
  if (!hasDatabase()) {
    rows = (await readLocal()).providerUsage.filter((item) => item.occurredAt >= start && item.occurredAt < end);
  } else {
    const sql = getSql();
    rows = await sql`SELECT provider, operation, model, input_tokens AS "inputTokens",
      output_tokens AS "outputTokens", request_count AS "requestCount",
      estimated_cost_usd AS "estimatedCostUsd", occurred_at AS "occurredAt"
      FROM js_provider_usage WHERE occurred_at >= ${start} AND occurred_at < ${end}`;
  }
  const byProvider = {};
  rows.forEach((row) => {
    const key = row.provider;
    byProvider[key] ||= { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    byProvider[key].requests += Number(row.requestCount) || 0;
    byProvider[key].inputTokens += Number(row.inputTokens) || 0;
    byProvider[key].outputTokens += Number(row.outputTokens) || 0;
    byProvider[key].costUsd += Number(row.estimatedCostUsd) || 0;
  });
  const spentUsd = rows.reduce((sum, row) => sum + (Number(row.estimatedCostUsd) || 0), 0);
  const budgetUsd = Number(process.env.JOBSEARCH_MONTHLY_BUDGET_USD || 5);
  return { month: start.slice(0, 7), spentUsd, budgetUsd, remainingUsd: Math.max(0, budgetUsd - spentUsd), byProvider };
}

export async function getProviderUsageSince(provider, sinceIso) {
  await ensureJobSearchRepository();
  let rows;
  if (!hasDatabase()) {
    rows = (await readLocal()).providerUsage.filter((item) => (
      item.provider === provider && item.occurredAt >= sinceIso
    ));
  } else {
    const sql = getSql();
    rows = await sql`SELECT provider, operation, model, input_tokens AS "inputTokens",
      output_tokens AS "outputTokens", request_count AS "requestCount",
      estimated_cost_usd AS "estimatedCostUsd", occurred_at AS "occurredAt"
      FROM js_provider_usage WHERE provider=${provider} AND occurred_at >= ${sinceIso}`;
  }
  const byModel = {};
  rows.forEach((row) => {
    const model = row.model || "unknown";
    byModel[model] ||= { requests: 0, inputTokens: 0, outputTokens: 0 };
    byModel[model].requests += Number(row.requestCount) || 0;
    byModel[model].inputTokens += Number(row.inputTokens) || 0;
    byModel[model].outputTokens += Number(row.outputTokens) || 0;
  });
  return {
    requests: rows.reduce((sum, row) => sum + (Number(row.requestCount) || 0), 0),
    inputTokens: rows.reduce((sum, row) => sum + (Number(row.inputTokens) || 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (Number(row.outputTokens) || 0), 0),
    byModel,
  };
}

export async function listLocalTasks({ statuses = [], taskTypes = [], limit = 5000 } = {}) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return (await readLocal()).localTasks
      .filter((task) => (!statuses.length || statuses.includes(task.status)) && (!taskTypes.length || taskTypes.includes(task.taskType)))
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }
  const sql = getSql();
  const rows = await sql`SELECT id, task_key AS "taskKey", job_id AS "jobId",
    task_type AS "taskType", status, priority, attempts, payload, result,
    last_error AS "lastError", available_at AS "availableAt", lease_until AS "leaseUntil",
    leased_by AS "leasedBy", lease_token AS "leaseToken", result_id AS "resultId",
    created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
    FROM js_local_tasks ORDER BY priority DESC, created_at ASC LIMIT ${limit}`;
  return rows.filter((task) => (!statuses.length || statuses.includes(task.status)) && (!taskTypes.length || taskTypes.includes(task.taskType)));
}

export async function setLocalTaskStatus(taskId, {
  status,
  availableAt = null,
  clearLease = true,
  completedAt = null,
  result = null,
  lastError = null,
} = {}) {
  await ensureJobSearchRepository();
  if (!String(taskId || "").trim()) throw new Error("A local task id is required.");
  if (!String(status || "").trim()) throw new Error("A local task status is required.");
  const timestamp = nowIso();
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const task = db.localTasks.find((item) => item.id === taskId);
      if (!task) return null;
      task.status = status;
      task.availableAt = availableAt || task.availableAt;
      task.updatedAt = timestamp;
      if (clearLease) {
        task.leaseUntil = null;
        task.leasedBy = "";
        task.leaseToken = "";
      }
      if (completedAt !== null) task.completedAt = completedAt;
      if (result !== null) task.result = result;
      if (lastError !== null) task.lastError = lastError;
      return structuredClone(task);
    });
  }
  const sql = getSql();
  const [row] = await sql`UPDATE js_local_tasks SET
    status=${status},
    available_at=COALESCE(${availableAt}, available_at),
    lease_until=CASE WHEN ${clearLease} THEN NULL ELSE lease_until END,
    leased_by=CASE WHEN ${clearLease} THEN NULL ELSE leased_by END,
    lease_token=CASE WHEN ${clearLease} THEN NULL ELSE lease_token END,
    completed_at=CASE WHEN ${completedAt === null} THEN completed_at ELSE ${completedAt} END,
    result=CASE WHEN ${result === null} THEN result ELSE ${JSON.stringify(result)}::jsonb END,
    last_error=CASE WHEN ${lastError === null} THEN last_error ELSE ${lastError} END,
    updated_at=${timestamp}
    WHERE id=${taskId}
    RETURNING id, task_key AS "taskKey", job_id AS "jobId", task_type AS "taskType",
      status, priority, attempts, payload, result, last_error AS "lastError",
      available_at AS "availableAt", lease_until AS "leaseUntil", leased_by AS "leasedBy",
      lease_token AS "leaseToken", result_id AS "resultId",
      created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"`;
  return row || null;
}

export async function enqueueLocalTask({ jobId, taskType, payload = {}, priority = 0, revision = "v1" }) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  const queueControl = await getLocalQueueControl();
  const startHeld = queueControl.holdNewTasks && !queueControl.activeReleaseJobIds.includes(String(jobId || "").trim());
  const taskKey = createHash("sha256").update(`${jobId}|${taskType}|${revision}`).digest("hex");
  const record = {
    id: id("jstask"), taskKey, jobId, taskType, status: startHeld ? "held" : "queued", priority,
    attempts: 0, payload, result: {}, lastError: "", availableAt: timestamp,
    leaseUntil: null, leasedBy: "", leaseToken: "", resultId: "",
    createdAt: timestamp, updatedAt: timestamp, completedAt: null,
  };
  // Only one stage can be actionable for a job. A newer stage revision retires
  // both stale upstream work and no-longer-valid downstream work.
  const supersededTypes = ["triage", "deep", "critic", "outreach"];
  const pendingStatuses = new Set(["queued", "retry", "held"]);
  const canSupersede = (task) => pendingStatuses.has(task.status)
    || (task.status === "processing" && task.leaseUntil && new Date(task.leaseUntil) <= new Date(timestamp));
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const existing = db.localTasks.find((task) => task.taskKey === taskKey);
      let current = existing;
      if (existing) {
        existing.priority = Math.max(Number(existing.priority) || 0, record.priority);
        existing.payload = { ...(existing.payload || {}), ...(record.payload || {}) };
        if (existing.status === "held" && !startHeld) {
          existing.status = "queued";
          existing.availableAt = timestamp;
        }
        existing.updatedAt = timestamp;
      } else {
        db.localTasks.push(record);
        current = record;
      }
      db.localTasks.forEach((task) => {
        if (task.id === current.id || task.jobId !== jobId || !supersededTypes.includes(task.taskType) || !canSupersede(task)) return;
        Object.assign(task, {
          status: "superseded",
          completedAt: timestamp,
          updatedAt: timestamp,
          lastError: `Superseded by ${current.id}.`,
        });
      });
      return structuredClone(current);
    });
  }
  const sql = getSql();
  const [row] = await sql`INSERT INTO js_local_tasks (
    id, task_key, job_id, task_type, status, priority, attempts, payload, result,
    last_error, available_at, lease_until, leased_by, lease_token, result_id,
    created_at, updated_at, completed_at
  ) VALUES (
    ${record.id}, ${record.taskKey}, ${record.jobId}, ${record.taskType}, ${record.status},
    ${record.priority}, 0, ${JSON.stringify(record.payload)}, '{}'::jsonb, NULL,
    ${record.availableAt}, NULL, NULL, NULL, NULL, ${record.createdAt}, ${record.updatedAt}, NULL
  ) ON CONFLICT (task_key) DO UPDATE SET
    priority=GREATEST(js_local_tasks.priority, EXCLUDED.priority),
    payload=js_local_tasks.payload || EXCLUDED.payload,
    status=CASE
      WHEN js_local_tasks.status='held' AND EXCLUDED.status='queued' THEN 'queued'
      ELSE js_local_tasks.status
    END,
    available_at=CASE
      WHEN js_local_tasks.status='held' AND EXCLUDED.status='queued' THEN EXCLUDED.available_at
      ELSE js_local_tasks.available_at
    END,
    updated_at=EXCLUDED.updated_at
  RETURNING id, task_key AS "taskKey", job_id AS "jobId", task_type AS "taskType",
    status, priority, attempts, payload, result, last_error AS "lastError",
    available_at AS "availableAt", lease_until AS "leaseUntil", leased_by AS "leasedBy",
    lease_token AS "leaseToken", result_id AS "resultId",
    created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"`;
  await sql`UPDATE js_local_tasks SET
    status='superseded',
    completed_at=${timestamp},
    updated_at=${timestamp},
    last_error=${`Superseded by ${row.id}.`}
    WHERE job_id=${jobId}
      AND id<>${row.id}
      AND task_type = ANY(${supersededTypes})
      AND (
        status = ANY(${[...pendingStatuses]})
        OR (status='processing' AND lease_until <= NOW())
      )`;
  return row;
}

export async function holdLocalQueueTasks({
  statuses = ["queued", "retry"],
  includeExpiredProcessing = false,
  reason = "migration_hold",
} = {}) {
  await ensureJobSearchRepository();
  const now = new Date();
  const availableAt = now.toISOString();
  const filter = (task) => (
    (statuses.includes(task.status))
    || (includeExpiredProcessing && task.status === "processing" && task.leaseUntil && new Date(task.leaseUntil) <= now)
  );
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const held = [];
      db.localTasks.forEach((task) => {
        if (!filter(task)) return;
        Object.assign(task, {
          status: "held",
          availableAt,
          leaseUntil: null,
          leasedBy: "",
          leaseToken: "",
          updatedAt: availableAt,
          lastError: task.lastError || `Held: ${reason}`,
        });
        held.push(structuredClone(task));
      });
      return held;
    });
  }
  const sql = getSql();
  return sql`UPDATE js_local_tasks SET
    status='held',
    available_at=${availableAt},
    lease_until=NULL,
    leased_by=NULL,
    lease_token=NULL,
    updated_at=${availableAt},
    last_error=COALESCE(last_error, ${`Held: ${reason}`})
    WHERE (
      status = ANY(${statuses})
      OR (${includeExpiredProcessing} = true AND status='processing' AND lease_until <= NOW())
    )
    RETURNING id, task_key AS "taskKey", job_id AS "jobId", task_type AS "taskType",
      status, priority, attempts, payload, result, last_error AS "lastError",
      available_at AS "availableAt", lease_until AS "leaseUntil", leased_by AS "leasedBy",
      lease_token AS "leaseToken", result_id AS "resultId",
      created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"`;
}

export async function releaseLocalQueueTasks(taskIds = []) {
  await ensureJobSearchRepository();
  const ids = [...new Set((Array.isArray(taskIds) ? taskIds : []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const availableAt = nowIso();
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const released = [];
      db.localTasks.forEach((task) => {
        if (!ids.includes(task.id) || task.status !== "held") return;
        Object.assign(task, {
          status: "queued",
          availableAt,
          leaseUntil: null,
          leasedBy: "",
          leaseToken: "",
          updatedAt: availableAt,
        });
        released.push(structuredClone(task));
      });
      return released;
    });
  }
  const sql = getSql();
  return sql`UPDATE js_local_tasks SET
    status='queued',
    available_at=${availableAt},
    lease_until=NULL,
    leased_by=NULL,
    lease_token=NULL,
    updated_at=${availableAt}
    WHERE id = ANY(${ids}) AND status='held'
    RETURNING id, task_key AS "taskKey", job_id AS "jobId", task_type AS "taskType",
      status, priority, attempts, payload, result, last_error AS "lastError",
      available_at AS "availableAt", lease_until AS "leaseUntil", leased_by AS "leasedBy",
      lease_token AS "leaseToken", result_id AS "resultId",
      created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"`;
}

export async function claimLocalTask({ workerId, leaseSeconds = 900 } = {}) {
  await ensureJobSearchRepository();
  if (!String(workerId || "").trim()) throw new Error("workerId is required to claim a task.");
  const now = new Date();
  const boundedLeaseSeconds = Math.max(60, Math.min(3600, Number(leaseSeconds) || 900));
  const leaseUntil = new Date(now.getTime() + boundedLeaseSeconds * 1000).toISOString();
  const leaseToken = id("lease");
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const candidates = db.localTasks
        .filter((task) => (
          (["queued", "retry"].includes(task.status) && new Date(task.availableAt) <= now)
          || (task.status === "processing" && task.leaseUntil && new Date(task.leaseUntil) <= now)
        ))
        .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt));
      const task = candidates[0];
      if (!task) return null;
      Object.assign(task, {
        status: "processing", attempts: task.attempts + 1, leasedBy: workerId,
        leaseUntil, leaseToken, resultId: "", updatedAt: now.toISOString(), lastError: "",
      });
      return structuredClone(task);
    });
  }
  const sql = getSql();
  const [row] = await sql`WITH candidate AS (
    SELECT id FROM js_local_tasks
    WHERE ((status IN ('queued', 'retry') AND available_at <= NOW())
      OR (status = 'processing' AND lease_until <= NOW()))
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE js_local_tasks task SET status='processing', attempts=task.attempts+1,
    leased_by=${workerId}, lease_until=${leaseUntil}, lease_token=${leaseToken},
    result_id=NULL, last_error=NULL, updated_at=NOW()
  FROM candidate WHERE task.id=candidate.id
  RETURNING task.id, task.task_key AS "taskKey", task.job_id AS "jobId",
    task.task_type AS "taskType", task.status, task.priority, task.attempts,
    task.payload, task.result, task.last_error AS "lastError",
    task.available_at AS "availableAt", task.lease_until AS "leaseUntil",
    task.leased_by AS "leasedBy", task.lease_token AS "leaseToken",
    task.result_id AS "resultId", task.created_at AS "createdAt",
    task.updated_at AS "updatedAt", task.completed_at AS "completedAt"`;
  return row || null;
}

export async function getLocalTask(taskId) {
  await ensureJobSearchRepository();
  if (!hasDatabase()) {
    return (await readLocal()).localTasks.find((task) => task.id === taskId) || null;
  }
  const sql = getSql();
  const [row] = await sql`SELECT id, task_key AS "taskKey", job_id AS "jobId",
    task_type AS "taskType", status, priority, attempts, payload, result,
    last_error AS "lastError", available_at AS "availableAt", lease_until AS "leaseUntil",
    leased_by AS "leasedBy", lease_token AS "leaseToken", result_id AS "resultId",
    created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
    FROM js_local_tasks WHERE id=${taskId} LIMIT 1`;
  return row || null;
}

function assertTaskLease(task, { workerId, leaseToken, allowCompleted = false } = {}) {
  if (!task) {
    const error = new Error("Worker task was not found.");
    error.statusCode = 404;
    throw error;
  }
  if (allowCompleted && task.status === "completed") return;
  if (task.status !== "processing") {
    const error = new Error(`Worker task is not processing (status: ${task.status}).`);
    error.statusCode = 409;
    throw error;
  }
  if (workerId && task.leasedBy !== workerId) {
    const error = new Error("Worker task is leased to a different worker.");
    error.statusCode = 409;
    throw error;
  }
  if (leaseToken && task.leaseToken !== leaseToken) {
    const error = new Error("Worker task lease token is invalid.");
    error.statusCode = 409;
    throw error;
  }
  if (task.leaseUntil && new Date(task.leaseUntil).getTime() <= Date.now()) {
    const error = new Error("Worker task lease has expired.");
    error.statusCode = 409;
    throw error;
  }
}

export async function renewLocalTaskLease(taskId, { workerId, leaseToken, leaseSeconds = 900 } = {}) {
  const task = await getLocalTask(taskId);
  assertTaskLease(task, { workerId, leaseToken });
  const boundedLeaseSeconds = Math.max(60, Math.min(3600, Number(leaseSeconds) || 900));
  const leaseUntil = new Date(Date.now() + boundedLeaseSeconds * 1000).toISOString();
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const current = db.localTasks.find((item) => item.id === taskId);
      assertTaskLease(current, { workerId, leaseToken });
      current.leaseUntil = leaseUntil;
      current.updatedAt = nowIso();
      return structuredClone(current);
    });
  }
  const sql = getSql();
  const [row] = await sql`UPDATE js_local_tasks SET lease_until=${leaseUntil}, updated_at=NOW()
    WHERE id=${taskId} AND status='processing' AND leased_by=${workerId} AND lease_token=${leaseToken}
    RETURNING id, task_key AS "taskKey", job_id AS "jobId", task_type AS "taskType",
    status, priority, attempts, payload, result, last_error AS "lastError",
    available_at AS "availableAt", lease_until AS "leaseUntil", leased_by AS "leasedBy",
    lease_token AS "leaseToken", result_id AS "resultId", created_at AS "createdAt",
    updated_at AS "updatedAt", completed_at AS "completedAt"`;
  if (!row) {
    const error = new Error("Worker task lease could not be renewed.");
    error.statusCode = 409;
    throw error;
  }
  return row;
}

export async function completeLocalTask(taskId, result = {}, { workerId, leaseToken, resultId = "" } = {}) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  const existing = await getLocalTask(taskId);
  if (existing?.status === "completed" && resultId && existing.resultId === resultId) return existing;
  if (workerId || leaseToken) assertTaskLease(existing, { workerId, leaseToken });
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const task = db.localTasks.find((item) => item.id === taskId);
      if (!task) return null;
      if (workerId || leaseToken) assertTaskLease(task, { workerId, leaseToken });
      Object.assign(task, { status: "completed", result, resultId, leaseUntil: null, updatedAt: timestamp, completedAt: timestamp });
      return structuredClone(task);
    });
  }
  const sql = getSql();
  const [row] = await sql`UPDATE js_local_tasks SET status='completed', result=${JSON.stringify(result)},
    result_id=${resultId || null}, lease_until=NULL, completed_at=${timestamp}, updated_at=${timestamp}
    WHERE id=${taskId}
      AND (${workerId || null}::text IS NULL OR (status='processing' AND leased_by=${workerId} AND lease_token=${leaseToken}))
    RETURNING id, task_key AS "taskKey", job_id AS "jobId",
    task_type AS "taskType", status, priority, attempts, payload, result,
    last_error AS "lastError", available_at AS "availableAt", lease_until AS "leaseUntil",
    leased_by AS "leasedBy", lease_token AS "leaseToken", result_id AS "resultId",
    created_at AS "createdAt", updated_at AS "updatedAt",
    completed_at AS "completedAt"`;
  return row || null;
}

export async function failLocalTask(taskId, error, { retry = true, delaySeconds = 60, workerId, leaseToken } = {}) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  const message = String(error?.message || error || "Local task failed.").slice(0, 2000);
  const status = retry ? "retry" : "failed";
  if (workerId || leaseToken) assertTaskLease(await getLocalTask(taskId), { workerId, leaseToken });
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const task = db.localTasks.find((item) => item.id === taskId);
      if (!task) return null;
      if (workerId || leaseToken) assertTaskLease(task, { workerId, leaseToken });
      Object.assign(task, { status, lastError: message, availableAt, leaseUntil: null, leaseToken: "", leasedBy: "", updatedAt: timestamp });
      return structuredClone(task);
    });
  }
  const sql = getSql();
  const [row] = await sql`UPDATE js_local_tasks SET status=${status}, last_error=${message},
    available_at=${availableAt}, lease_until=NULL, lease_token=NULL, leased_by=NULL, updated_at=${timestamp}
    WHERE id=${taskId}
      AND (${workerId || null}::text IS NULL OR (status='processing' AND leased_by=${workerId} AND lease_token=${leaseToken}))
    RETURNING id, task_key AS "taskKey", job_id AS "jobId",
    task_type AS "taskType", status, priority, attempts, payload, result,
    last_error AS "lastError", available_at AS "availableAt", lease_until AS "leaseUntil",
    leased_by AS "leasedBy", lease_token AS "leaseToken", result_id AS "resultId",
    created_at AS "createdAt", updated_at AS "updatedAt",
    completed_at AS "completedAt"`;
  return row || null;
}

export async function deferLocalTask(taskId, reason, { delaySeconds = 60, workerId, leaseToken } = {}) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  const boundedDelaySeconds = Math.max(1, Math.min(3600, Number(delaySeconds) || 60));
  const availableAt = new Date(Date.now() + boundedDelaySeconds * 1000).toISOString();
  const message = String(reason?.message || reason || "Local task deferred.").slice(0, 2000);
  if (workerId || leaseToken) assertTaskLease(await getLocalTask(taskId), { workerId, leaseToken });
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      const task = db.localTasks.find((item) => item.id === taskId);
      if (!task) return null;
      if (workerId || leaseToken) assertTaskLease(task, { workerId, leaseToken });
      Object.assign(task, {
        status: "retry",
        attempts: Math.max(0, Number(task.attempts || 0) - 1),
        lastError: message,
        availableAt,
        leaseUntil: null,
        leaseToken: "",
        leasedBy: "",
        updatedAt: timestamp,
      });
      return structuredClone(task);
    });
  }
  const sql = getSql();
  const [row] = await sql`UPDATE js_local_tasks SET status='retry',
    attempts=GREATEST(attempts - 1, 0), last_error=${message}, available_at=${availableAt},
    lease_until=NULL, lease_token=NULL, leased_by=NULL, updated_at=${timestamp}
    WHERE id=${taskId}
      AND (${workerId || null}::text IS NULL OR (status='processing' AND leased_by=${workerId} AND lease_token=${leaseToken}))
    RETURNING id, task_key AS "taskKey", job_id AS "jobId",
    task_type AS "taskType", status, priority, attempts, payload, result,
    last_error AS "lastError", available_at AS "availableAt", lease_until AS "leaseUntil",
    leased_by AS "leasedBy", lease_token AS "leaseToken", result_id AS "resultId",
    created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"`;
  return row || null;
}

export async function recordWorkerHeartbeat({ workerId, status = "idle", version = "", currentTaskId = "", metadata = {} }) {
  await ensureJobSearchRepository();
  const timestamp = nowIso();
  if (!hasDatabase()) {
    return mutateLocal((db) => {
      let heartbeat = db.workerHeartbeats.find((item) => item.workerId === workerId);
      if (!heartbeat) {
        heartbeat = { workerId, startedAt: timestamp };
        db.workerHeartbeats.push(heartbeat);
      }
      Object.assign(heartbeat, { status, version, currentTaskId, metadata, lastSeenAt: timestamp });
      return structuredClone(heartbeat);
    });
  }
  const sql = getSql();
  const [row] = await sql`INSERT INTO js_worker_heartbeats (
    worker_id, status, version, current_task_id, metadata, started_at, last_seen_at
  ) VALUES (${workerId}, ${status}, ${version}, ${currentTaskId || null}, ${JSON.stringify(metadata)}, ${timestamp}, ${timestamp})
  ON CONFLICT (worker_id) DO UPDATE SET status=EXCLUDED.status, version=EXCLUDED.version,
    current_task_id=EXCLUDED.current_task_id, metadata=EXCLUDED.metadata,
    last_seen_at=EXCLUDED.last_seen_at
  RETURNING worker_id AS "workerId", status, version, current_task_id AS "currentTaskId",
    metadata, started_at AS "startedAt", last_seen_at AS "lastSeenAt"`;
  return row;
}

export async function getLocalWorkerStatus() {
  await ensureJobSearchRepository();
  const queueControl = await getLocalQueueControl();
  if (!hasDatabase()) {
    const db = await readLocal();
    const grouped = new Map();
    for (const task of db.localTasks) {
      const key = `${task.status}|${task.taskType}`;
      grouped.set(key, { status: task.status, taskType: task.taskType, count: (grouped.get(key)?.count || 0) + 1 });
    }
    return {
      tasks: [...grouped.values()],
      workers: db.workerHeartbeats,
      queueControl,
    };
  }
  const sql = getSql();
  const [tasks, workers] = await Promise.all([
    sql`SELECT status, task_type AS "taskType", COUNT(*)::int AS count
      FROM js_local_tasks GROUP BY status, task_type ORDER BY status, task_type`,
    sql`SELECT worker_id AS "workerId", status, version, current_task_id AS "currentTaskId",
      metadata, started_at AS "startedAt", last_seen_at AS "lastSeenAt"
      FROM js_worker_heartbeats ORDER BY last_seen_at DESC`,
  ]);
  return { tasks, workers, queueControl };
}

export async function canSpend(provider, estimatedCostUsd) {
  const usage = await getUsageSummary();
  const providerCap = provider === "zai" ? 4 : provider === "moonshot" ? 1 : usage.budgetUsd;
  const providerSpent = usage.byProvider[provider]?.costUsd || 0;
  return usage.spentUsd + estimatedCostUsd <= usage.budgetUsd && providerSpent + estimatedCostUsd <= providerCap;
}

export async function getCalibrationStatus() {
  const jobs = await listJobs({ view: "all", limit: 2000 });
  const labelled = jobs.filter((job) => Boolean(job.disposition));
  const ranked = labelled
    .filter((job) => job.details?.deepEvaluation)
    .sort((left, right) => (right.details.deepEvaluation.overallScore || 0) - (left.details.deepEvaluation.overallScore || 0));
  const topTen = ranked.slice(0, 10);
  const precision = topTen.length === 10
    ? topTen.filter((job) => job.disposition === "apply").length / 10
    : 0;
  const positives = labelled.filter((job) => job.disposition === "apply");
  const falseRejected = positives.filter((job) => job.details?.deepEvaluation?.verdict === "pass").length;
  const falseRejectionRate = positives.length ? falseRejected / positives.length : 1;
  const materialClaim = /(compensation|salary|location|remote|visa|sponsor|authorization|work_authorization)/i;
  const materialClaims = topTen.flatMap((job) => job.details?.claims || [])
    .filter((claim) => materialClaim.test(claim.claimType || "") && claim.evidenceType !== "unknown");
  const citationsComplete = materialClaims.every((claim) => claim.sourceUrl && claim.supportingPassage);
  const target = 20;
  return {
    active: labelled.length >= target && topTen.length === 10 && precision >= 0.8
      && falseRejectionRate <= 0.1 && citationsComplete,
    labelled: labelled.length,
    target,
    topTenLabelled: topTen.length,
    precisionTopTen: precision,
    falseRejectionRate,
    citationsComplete,
  };
}

export async function readResearchCache(cacheKey) {
  await ensureJobSearchRepository();
  const now = nowIso();
  if (!hasDatabase()) return (await readLocal()).researchCache.find((item) => item.cacheKey === cacheKey && item.expiresAt > now)?.result || null;
  const sql = getSql();
  const [row] = await sql`SELECT result FROM js_research_cache WHERE cache_key=${cacheKey} AND expires_at > NOW()`;
  return row?.result || null;
}

export async function writeResearchCache({ cacheKey, company, topic, result, ttlDays = 30 }) {
  await ensureJobSearchRepository();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
  const record = { cacheKey, company, topic, result, createdAt: now, updatedAt: now, expiresAt };
  if (!hasDatabase()) return mutateLocal((db) => {
    db.researchCache = db.researchCache.filter((item) => item.cacheKey !== cacheKey);
    db.researchCache.push(record);
    return record;
  });
  const sql = getSql();
  await sql`INSERT INTO js_research_cache (cache_key, company, topic, result, expires_at, created_at, updated_at)
    VALUES (${cacheKey}, ${company}, ${topic}, ${JSON.stringify(result)}, ${expiresAt}, ${now}, ${now})
    ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result, expires_at=EXCLUDED.expires_at, updated_at=EXCLUDED.updated_at`;
  return record;
}

export async function getRepositoryDashboard(input = "inbox") {
  const options = typeof input === "string" ? { view: input } : (input || {});
  const view = options.view || "inbox";
  const pageSize = Math.max(1, Math.min(10, Number(options.pageSize) || 10));
  const page = Math.max(1, Number(options.page) || 1);
  const decisionSource = ["owner", "model"].includes(options.decisionSource) ? options.decisionSource : "all";
  const roleFamily = String(options.roleFamily || "all");
  const [allJobs, runs, patterns, usage, calibration, rawLeads, localProcessing] = await Promise.all([
    listJobs({ view: "all", limit: 5000 }),
    listRuns(500),
    listTitlePatterns(),
    getUsageSummary(),
    getCalibrationStatus(),
    listDiscoveryLeads({ limit: 5000 }),
    getLocalWorkerStatus(),
  ]);
  const leads = rawLeads.filter((lead) => lead.sourceProvider !== "sample");
  const filteredJobs = allJobs.filter((job) => matchesJobView(job, view)
    && matchesDecisionSource(job, decisionSource)
    && (roleFamily === "all" || job.roleFamilyId === roleFamily));
  const filteredLeads = view === "discovery" ? leads : [];
  const orderedPatterns = view === "taxonomy"
    ? [...patterns.filter((pattern) => pattern.status === "proposed"), ...patterns.filter((pattern) => pattern.status === "active")]
    : [];
  const viewItems = view === "discovery" ? filteredLeads
    : view === "taxonomy" ? orderedPatterns
      : view === "runs" ? runs
        : filteredJobs;
  const totalPages = Math.max(1, Math.ceil(viewItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * pageSize;
  const pagedItems = viewItems.slice(offset, offset + pageSize);
  const viewDecisionCounts = view === "discovery" || view === "taxonomy" || view === "runs" ? null : {
    all: allJobs.filter((job) => matchesJobView(job, view) && (roleFamily === "all" || job.roleFamilyId === roleFamily)).length,
    owner: allJobs.filter((job) => matchesJobView(job, view) && Boolean(job.disposition) && (roleFamily === "all" || job.roleFamilyId === roleFamily)).length,
    model: allJobs.filter((job) => matchesJobView(job, view) && !job.disposition && (roleFamily === "all" || job.roleFamilyId === roleFamily)).length,
  };
  const roleFamilies = [...new Map(allJobs.map((job) => [job.roleFamilyId || "exploratory", {
    id: job.roleFamilyId || "exploratory",
    label: job.details?.titleClassification?.familyLabel || job.roleFamilyId || "Exploratory",
  }])).values()]
    .map((family) => ({
      ...family,
      count: allJobs.filter((job) => matchesJobView(job, view) && (job.roleFamilyId || "exploratory") === family.id).length,
    }))
    .filter((family) => family.count > 0)
    .sort((left, right) => left.label.localeCompare(right.label));
  const tabCounts = {
    discovery: leads.length,
    all_candidates: allJobs.length,
    relevant: allJobs.filter((job) => matchesJobView(job, "relevant")).length,
    uncertain: allJobs.filter((job) => matchesJobView(job, "uncertain")).length,
    clear_mismatch: allJobs.filter((job) => matchesJobView(job, "clear_mismatch")).length,
    shortlist: allJobs.filter((job) => matchesJobView(job, "shortlist")).length,
    needs_review: allJobs.filter((job) => matchesJobView(job, "needs_review")).length,
    passed: allJobs.filter((job) => matchesJobView(job, "passed")).length,
    expired: allJobs.filter((job) => matchesJobView(job, "expired")).length,
    taxonomy: patterns.filter((pattern) => ["active", "proposed"].includes(pattern.status)).length,
    runs: runs.length,
  };
  return {
    jobs: ["discovery", "taxonomy", "runs"].includes(view) ? [] : pagedItems,
    runs: view === "runs" ? pagedItems : [],
    taxonomy: {
      active: view === "taxonomy" ? pagedItems.filter((pattern) => pattern.status === "active") : [],
      proposed: view === "taxonomy" ? pagedItems.filter((pattern) => pattern.status === "proposed") : [],
      rejected: patterns.filter((pattern) => pattern.status === "rejected"),
      totals: {
        active: patterns.filter((pattern) => pattern.status === "active").length,
        proposed: patterns.filter((pattern) => pattern.status === "proposed").length,
      },
    },
    usage,
    localProcessing,
    discoveryLeads: view === "discovery" ? pagedItems : [],
    pagination: {
      page: currentPage,
      pageSize,
      total: viewItems.length,
      totalPages,
    },
    filters: {
      decisionSource,
      roleFamily,
      decisionCounts: viewDecisionCounts,
      roleFamilies,
    },
    tabCounts,
    summary: {
      total: allJobs.length,
      rawLeads: leads.length,
      extractionPending: leads.filter((lead) => ["extraction_pending", "metadata_pending"].includes(lead.status)).length,
      titleFiltered: leads.filter((lead) => lead.status === "filtered_title").length,
      inbox: allJobs.filter((job) => !["passed", "expired"].includes(job.status)).length,
      relevant: allJobs.filter((job) => job.details?.triage?.relevance === "relevant").length,
      uncertain: allJobs.filter((job) => job.details?.triage?.relevance === "uncertain").length,
      clearMismatches: allJobs.filter((job) => job.details?.triage?.relevance === "irrelevant" || job.status === "triage_rejected").length,
      shortlist: allJobs.filter((job) => job.status === "shortlisted" || job.disposition === "apply").length,
      needsReview: allJobs.filter((job) => ["needs_review", "deep_review_pending", "triage_pending", "local_triage_pending"].includes(job.status)).length,
      passed: allJobs.filter((job) => job.status === "passed" || job.disposition === "pass").length,
      expired: allJobs.filter((job) => job.status === "expired").length,
      labelled: allJobs.filter((job) => Boolean(job.disposition)).length,
      calibrationTarget: 20,
      calibration,
    },
  };
}

export function repositoryMode() {
  return hasDatabase() ? "neon-normalized" : "local-isolated-json";
}
