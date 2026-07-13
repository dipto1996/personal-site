import { neon } from "@neondatabase/serverless";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.TRADEGRAPH_DATA_DIR
  ? path.resolve(process.env.TRADEGRAPH_DATA_DIR)
  : path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "tradegraph-db.json");
const DATABASE_URL = process.env.DATABASE_URL || "";

const DEFAULT_DB = {
  users: [],
  sessions: [],
  workspaces: [],
  workspaceMemberships: [],
  workspaceInvites: [],
  state: [],
  sources: [],
  sourceHistory: [],
  dailyMetrics: [],
  analyticsEvents: [],
  alertRules: [],
  subscriptions: [],
  jobSearchJobs: [],
  jobSearchRuns: [],
};

let writeChain = Promise.resolve();
let schemaEnsured = false;

function hasDatabase() {
  return Boolean(DATABASE_URL);
}

function getSql() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return neon(DATABASE_URL);
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function migrateDbShape(input) {
  const db = {
    ...DEFAULT_DB,
    ...input,
  };

  db.sources = Array.isArray(db.sources) ? db.sources : [];
  db.sourceHistory = Array.isArray(db.sourceHistory) ? db.sourceHistory : [];
  db.dailyMetrics = Array.isArray(db.dailyMetrics) ? db.dailyMetrics : [];
  db.analyticsEvents = Array.isArray(db.analyticsEvents) ? db.analyticsEvents : [];
  db.state = Array.isArray(db.state) ? db.state : [];
  db.alertRules = Array.isArray(db.alertRules) ? db.alertRules : [];
  db.subscriptions = Array.isArray(db.subscriptions) ? db.subscriptions : [];
  db.jobSearchJobs = Array.isArray(db.jobSearchJobs) ? db.jobSearchJobs : [];
  db.jobSearchRuns = Array.isArray(db.jobSearchRuns) ? db.jobSearchRuns : [];
  db.users = Array.isArray(db.users) ? db.users : [];
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.workspaces = Array.isArray(db.workspaces) ? db.workspaces : [];
  db.workspaceMemberships = Array.isArray(db.workspaceMemberships) ? db.workspaceMemberships : [];
  db.workspaceInvites = Array.isArray(db.workspaceInvites) ? db.workspaceInvites : [];

  db.workspaces = db.workspaces.map((workspace) => ({
    ...workspace,
    ownerUserId: workspace.ownerUserId || workspace.userId || null,
  }));

  const membershipIndex = new Set(
    db.workspaceMemberships.map((membership) => `${membership.workspaceId}:${membership.userId}`),
  );

  db.workspaces.forEach((workspace) => {
    if (!workspace.ownerUserId) {
      return;
    }

    const membershipKey = `${workspace.id}:${workspace.ownerUserId}`;

    if (!membershipIndex.has(membershipKey)) {
      db.workspaceMemberships.push({
        id: `membership_migrated_${workspace.id}_${workspace.ownerUserId}`,
        workspaceId: workspace.id,
        userId: workspace.ownerUserId,
        role: "owner",
        createdAt: workspace.createdAt || new Date().toISOString(),
      });
      membershipIndex.add(membershipKey);
    }
  });

  return db;
}

async function ensureSchema() {
  if (!hasDatabase() || schemaEnsured) {
    return;
  }

  const sql = getSql();

  await sql.transaction([
    sql`
      CREATE TABLE IF NOT EXISTS tg_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_workspaces (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_workspace_memberships (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES tg_workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_workspace_invites (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES tg_workspaces(id) ON DELETE CASCADE,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        accepted_by_user_id TEXT REFERENCES tg_users(id) ON DELETE SET NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES tg_workspaces(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_workspace_state (
        workspace_id TEXT NOT NULL REFERENCES tg_workspaces(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id, namespace)
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_sources (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        checked_at TIMESTAMPTZ NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        note TEXT,
        evidence TEXT
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_source_history (
        id TEXT PRIMARY KEY,
        sync_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        checked_at TIMESTAMPTZ NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        note TEXT,
        evidence TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_daily_metrics (
        id TEXT PRIMARY KEY,
        metric_key TEXT NOT NULL,
        day TEXT NOT NULL,
        scope TEXT NOT NULL,
        workspace_id TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        sync_id TEXT NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_analytics_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        product TEXT NOT NULL,
        page TEXT,
        workspace_id TEXT REFERENCES tg_workspaces(id) ON DELETE SET NULL,
        user_id TEXT REFERENCES tg_users(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES tg_sessions(id) ON DELETE SET NULL,
        anonymous_id TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_alert_rules (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES tg_workspaces(id) ON DELETE CASCADE,
        product TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        label TEXT NOT NULL,
        recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
        filters JSONB NOT NULL DEFAULT '{}'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        last_tested_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_subscriptions (
        workspace_id TEXT PRIMARY KEY REFERENCES tg_workspaces(id) ON DELETE CASCADE,
        plan_key TEXT NOT NULL,
        status TEXT NOT NULL,
        seats INTEGER NOT NULL DEFAULT 1,
        billing_email TEXT,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        stripe_checkout_session_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_job_search_jobs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        description TEXT NOT NULL,
        url TEXT,
        location TEXT,
        posted_at TIMESTAMPTZ,
        source_query TEXT,
        source_provider TEXT NOT NULL,
        semantic_score DOUBLE PRECISION,
        llm_score INTEGER,
        llm_reasoning TEXT,
        is_match BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL,
        hiring_manager_name TEXT,
        hiring_manager_linkedin TEXT,
        hiring_manager_email TEXT,
        drafted_outreach TEXT,
        user_feedback INTEGER NOT NULL DEFAULT 0,
        embedding JSONB,
        raw JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `,
    sql`
      CREATE TABLE IF NOT EXISTS tg_job_search_runs (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        provider_status JSONB NOT NULL DEFAULT '{}'::jsonb,
        stats JSONB NOT NULL DEFAULT '{}'::jsonb,
        error TEXT
      );
    `,
  ]);

  schemaEnsured = true;
}

async function readDbFromFile() {
  await ensureDataDir();

  try {
    const raw = await readFile(DB_PATH, "utf8");
    if (!raw.trim()) {
      await writeFile(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
      return structuredClone(DEFAULT_DB);
    }
    const parsed = JSON.parse(raw);
    return migrateDbShape(parsed);
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeFile(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
      return structuredClone(DEFAULT_DB);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Local persistence file is not valid JSON: ${DB_PATH}`);
    }

    throw error;
  }
}

async function writeDbToFile(snapshot) {
  await ensureDataDir();
  const tempPath = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(snapshot, null, 2));
  await rename(tempPath, DB_PATH);
}

async function readDbFromDatabase() {
  await ensureSchema();
  const sql = getSql();

  const users = await sql`
      SELECT
        id,
        name,
        email,
        password_salt AS "passwordSalt",
        password_hash AS "passwordHash",
        created_at AS "createdAt"
      FROM tg_users
      ORDER BY created_at ASC;
    `;
  const workspaces = await sql`
      SELECT
        id,
        owner_user_id AS "ownerUserId",
        owner_user_id AS "userId",
        name,
        is_default AS "isDefault",
        created_at AS "createdAt"
      FROM tg_workspaces
      ORDER BY created_at ASC;
    `;
  const workspaceMemberships = await sql`
      SELECT
        id,
        workspace_id AS "workspaceId",
        user_id AS "userId",
        role,
        created_at AS "createdAt"
      FROM tg_workspace_memberships
      ORDER BY created_at ASC;
    `;
  const workspaceInvites = await sql`
      SELECT
        id,
        workspace_id AS "workspaceId",
        code,
        status,
        created_at AS "createdAt",
        expires_at AS "expiresAt",
        accepted_at AS "acceptedAt",
        accepted_by_user_id AS "acceptedByUserId"
      FROM tg_workspace_invites
      ORDER BY created_at ASC;
    `;
  const sessions = await sql`
      SELECT
        id,
        user_id AS "userId",
        workspace_id AS "workspaceId",
        created_at AS "createdAt",
        expires_at AS "expiresAt"
      FROM tg_sessions
      ORDER BY created_at ASC;
    `;
  const state = await sql`
      SELECT
        workspace_id AS "workspaceId",
        namespace,
        value,
        updated_at AS "updatedAt"
      FROM tg_workspace_state
      ORDER BY updated_at ASC;
    `;
  const sources = await sql`
      SELECT
        key,
        label,
        status,
        checked_at AS "checkedAt",
        item_count AS "itemCount",
        items,
        note,
        evidence
      FROM tg_sources
      ORDER BY key ASC;
    `;
  const sourceHistory = await sql`
      SELECT
        id,
        sync_id AS "syncId",
        source_key AS "sourceKey",
        label,
        status,
        checked_at AS "checkedAt",
        item_count AS "itemCount",
        items,
        note,
        evidence,
        created_at AS "createdAt"
      FROM tg_source_history
      ORDER BY created_at ASC;
    `;
  const dailyMetrics = await sql`
      SELECT
        id,
        metric_key AS "metricKey",
        day,
        scope,
        workspace_id AS "workspaceId",
        payload,
        created_at AS "createdAt",
        sync_id AS "syncId"
      FROM tg_daily_metrics
      ORDER BY created_at ASC;
    `;
  const analyticsEvents = await sql`
      SELECT
        id,
        name,
        product,
        page,
        workspace_id AS "workspaceId",
        user_id AS "userId",
        session_id AS "sessionId",
        anonymous_id AS "anonymousId",
        payload,
        created_at AS "createdAt"
      FROM tg_analytics_events
      ORDER BY created_at ASC;
    `;
  const alertRules = await sql`
      SELECT
        id,
        workspace_id AS "workspaceId",
        product,
        rule_type AS "ruleType",
        label,
        recipients,
        filters,
        enabled,
        last_tested_at AS "lastTestedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM tg_alert_rules
      ORDER BY created_at ASC;
    `;
  const subscriptions = await sql`
      SELECT
        workspace_id AS "workspaceId",
        plan_key AS "planKey",
        status,
        seats,
        billing_email AS "billingEmail",
        stripe_customer_id AS "stripeCustomerId",
        stripe_subscription_id AS "stripeSubscriptionId",
        stripe_checkout_session_id AS "stripeCheckoutSessionId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM tg_subscriptions
      ORDER BY created_at ASC;
    `;
  const jobSearchJobs = await sql`
      SELECT
        id,
        source_id AS "sourceId",
        title,
        company,
        description,
        url,
        location,
        posted_at AS "postedAt",
        source_query AS "sourceQuery",
        source_provider AS "sourceProvider",
        semantic_score AS "semanticScore",
        llm_score AS "llmScore",
        llm_reasoning AS "llmReasoning",
        is_match AS "isMatch",
        status,
        hiring_manager_name AS "hiringManagerName",
        hiring_manager_linkedin AS "hiringManagerLinkedin",
        hiring_manager_email AS "hiringManagerEmail",
        drafted_outreach AS "draftedOutreach",
        user_feedback AS "userFeedback",
        embedding,
        raw,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM tg_job_search_jobs
      ORDER BY created_at ASC;
    `;
  const jobSearchRuns = await sql`
      SELECT
        id,
        trigger,
        status,
        started_at AS "startedAt",
        completed_at AS "completedAt",
        provider_status AS "providerStatus",
        stats,
        error
      FROM tg_job_search_runs
      ORDER BY started_at ASC;
    `;

  return migrateDbShape({
    users,
    workspaces,
    workspaceMemberships,
    workspaceInvites,
    sessions,
    state,
    sources,
    sourceHistory,
    dailyMetrics,
    analyticsEvents,
    alertRules,
    subscriptions,
    jobSearchJobs,
    jobSearchRuns,
  });
}

async function writeDbToDatabase(snapshot) {
  await ensureSchema();
  const sql = getSql();
  const db = migrateDbShape(snapshot);
  const queries = [
    sql`
      TRUNCATE
      tg_subscriptions,
      tg_alert_rules,
      tg_job_search_jobs,
      tg_job_search_runs,
      tg_sources,
      tg_daily_metrics,
      tg_analytics_events,
      tg_source_history,
      tg_workspace_state,
      tg_sessions,
      tg_workspace_invites,
      tg_workspace_memberships,
        tg_workspaces,
        tg_users
      CASCADE;
    `,
  ];

  db.users.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_users (id, name, email, password_salt, password_hash, created_at)
      VALUES (${item.id}, ${item.name}, ${item.email}, ${item.passwordSalt}, ${item.passwordHash}, ${item.createdAt});
    `);
  });

  db.workspaces.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_workspaces (id, owner_user_id, name, is_default, created_at)
      VALUES (${item.id}, ${item.ownerUserId || item.userId}, ${item.name}, ${Boolean(item.isDefault)}, ${item.createdAt});
    `);
  });

  db.workspaceMemberships.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_workspace_memberships (id, workspace_id, user_id, role, created_at)
      VALUES (${item.id}, ${item.workspaceId}, ${item.userId}, ${item.role}, ${item.createdAt});
    `);
  });

  db.workspaceInvites.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_workspace_invites (
        id,
        workspace_id,
        code,
        status,
        created_at,
        expires_at,
        accepted_at,
        accepted_by_user_id
      ) VALUES (
        ${item.id},
        ${item.workspaceId},
        ${item.code},
        ${item.status},
        ${item.createdAt},
        ${item.expiresAt},
        ${item.acceptedAt || null},
        ${item.acceptedByUserId || null}
      );
    `);
  });

  db.sessions.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_sessions (id, user_id, workspace_id, created_at, expires_at)
      VALUES (${item.id}, ${item.userId}, ${item.workspaceId}, ${item.createdAt}, ${item.expiresAt});
    `);
  });

  db.state.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_workspace_state (workspace_id, namespace, value, updated_at)
      VALUES (${item.workspaceId}, ${item.namespace}, ${JSON.stringify(item.value)}, ${item.updatedAt});
    `);
  });

  db.sources.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_sources (key, label, status, checked_at, item_count, items, note, evidence)
      VALUES (
        ${item.key},
        ${item.label},
        ${item.status},
        ${item.checkedAt},
        ${item.itemCount || 0},
        ${JSON.stringify(item.items || [])},
        ${item.note || null},
        ${item.evidence || null}
      );
    `);
  });

  db.sourceHistory.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_source_history (
        id,
        sync_id,
        source_key,
        label,
        status,
        checked_at,
        item_count,
        items,
        note,
        evidence,
        created_at
      ) VALUES (
        ${item.id},
        ${item.syncId},
        ${item.sourceKey},
        ${item.label},
        ${item.status},
        ${item.checkedAt},
        ${item.itemCount || 0},
        ${JSON.stringify(item.items || [])},
        ${item.note || null},
        ${item.evidence || null},
        ${item.createdAt}
      );
    `);
  });

  db.dailyMetrics.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_daily_metrics (
        id,
        metric_key,
        day,
        scope,
        workspace_id,
        payload,
        created_at,
        sync_id
      ) VALUES (
        ${item.id},
        ${item.metricKey},
        ${item.day},
        ${item.scope},
        ${item.workspaceId || null},
        ${JSON.stringify(item.payload || {})},
        ${item.createdAt},
        ${item.syncId}
      );
    `);
  });

  db.analyticsEvents.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_analytics_events (
        id,
        name,
        product,
        page,
        workspace_id,
        user_id,
        session_id,
        anonymous_id,
        payload,
        created_at
      ) VALUES (
        ${item.id},
        ${item.name},
        ${item.product},
        ${item.page || null},
        ${item.workspaceId || null},
        ${item.userId || null},
        ${item.sessionId || null},
        ${item.anonymousId || null},
        ${JSON.stringify(item.payload || {})},
        ${item.createdAt}
      );
    `);
  });

  db.alertRules.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_alert_rules (
        id,
        workspace_id,
        product,
        rule_type,
        label,
        recipients,
        filters,
        enabled,
        last_tested_at,
        created_at,
        updated_at
      ) VALUES (
        ${item.id},
        ${item.workspaceId},
        ${item.product},
        ${item.ruleType},
        ${item.label},
        ${JSON.stringify(item.recipients || [])},
        ${JSON.stringify(item.filters || {})},
        ${Boolean(item.enabled)},
        ${item.lastTestedAt || null},
        ${item.createdAt},
        ${item.updatedAt}
      );
    `);
  });

  db.subscriptions.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_subscriptions (
        workspace_id,
        plan_key,
        status,
        seats,
        billing_email,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_checkout_session_id,
        created_at,
        updated_at
      ) VALUES (
        ${item.workspaceId},
        ${item.planKey},
        ${item.status},
        ${item.seats || 1},
        ${item.billingEmail || null},
        ${item.stripeCustomerId || null},
        ${item.stripeSubscriptionId || null},
        ${item.stripeCheckoutSessionId || null},
        ${item.createdAt},
        ${item.updatedAt}
      );
    `);
  });

  db.jobSearchJobs.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_job_search_jobs (
        id,
        source_id,
        title,
        company,
        description,
        url,
        location,
        posted_at,
        source_query,
        source_provider,
        semantic_score,
        llm_score,
        llm_reasoning,
        is_match,
        status,
        hiring_manager_name,
        hiring_manager_linkedin,
        hiring_manager_email,
        drafted_outreach,
        user_feedback,
        embedding,
        raw,
        created_at,
        updated_at
      ) VALUES (
        ${item.id},
        ${item.sourceId},
        ${item.title},
        ${item.company},
        ${item.description},
        ${item.url || null},
        ${item.location || null},
        ${item.postedAt || null},
        ${item.sourceQuery || null},
        ${item.sourceProvider || "unknown"},
        ${Number.isFinite(Number(item.semanticScore)) ? Number(item.semanticScore) : null},
        ${Number.isFinite(Number(item.llmScore)) ? Number(item.llmScore) : null},
        ${item.llmReasoning || null},
        ${Boolean(item.isMatch)},
        ${item.status || "new"},
        ${item.hiringManagerName || null},
        ${item.hiringManagerLinkedin || null},
        ${item.hiringManagerEmail || null},
        ${item.draftedOutreach || null},
        ${Number.isFinite(Number(item.userFeedback)) ? Number(item.userFeedback) : 0},
        ${item.embedding ? JSON.stringify(item.embedding) : null},
        ${JSON.stringify(item.raw || {})},
        ${item.createdAt},
        ${item.updatedAt}
      );
    `);
  });

  db.jobSearchRuns.forEach((item) => {
    queries.push(sql`
      INSERT INTO tg_job_search_runs (
        id,
        trigger,
        status,
        started_at,
        completed_at,
        provider_status,
        stats,
        error
      ) VALUES (
        ${item.id},
        ${item.trigger || "manual"},
        ${item.status || "unknown"},
        ${item.startedAt},
        ${item.completedAt || null},
        ${JSON.stringify(item.providerStatus || {})},
        ${JSON.stringify(item.stats || {})},
        ${item.error || null}
      );
    `);
  });

  await sql.transaction(queries);
  return db;
}

export async function readDb() {
  if (hasDatabase()) {
    return readDbFromDatabase();
  }

  return readDbFromFile();
}

export async function updateDb(mutator) {
  const operation = writeChain.catch(() => undefined).then(async () => {
    const db = await readDb();
    const next = (await mutator(structuredClone(db))) || db;

    if (hasDatabase()) {
      return writeDbToDatabase(next);
    }

    await writeDbToFile(next);
    return next;
  });

  writeChain = operation;
  return operation;
}

export function nowIso() {
  return new Date().toISOString();
}

export function getPersistenceMode() {
  return hasDatabase() ? "postgres" : "local-json";
}
