import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  authenticateUser,
  buildClearSessionCookie,
  buildDemoSession,
  createSession,
  ensureUserWorkspace,
  getSessionContext,
  registerUser,
  revokeSession,
} from "./auth.js";
import { createAlertRule, deleteAlertRule, deliverScheduledAlerts, listAlertRules, testAlertRule, updateAlertRule } from "./alerts.js";
import {
  changePlanLocally,
  getWorkspaceSubscription,
  listPlans,
  refreshSubscriptionFromProvider,
  startCheckoutSession,
} from "./billing.js";
import { getAnalyticsSummary, recordAnalyticsEvent, recordAnalyticsEvents } from "./analytics.js";
import { getAppUrl, getRuntimeStatus } from "./config.js";
import {
  getJobSearchDashboard,
  holdJobSearchLocalQueue,
  getJobSearchPlan,
  releaseJobSearchLocalBacklog,
  retryFailedJobSearchLocalTasks,
  getJobSearchRun,
  getJobSearchStatus,
  getJobSearchTaxonomy,
  getJobSearchUsage,
  runJobSearchProviderCanary,
  listNegativeFeedbackJobs,
  rerunJobSearchJob,
  requireJobSearchAccess,
  runJobSearchIngest,
  setJobSearchTaxonomyProposal,
  updateJobSearchFeedback,
} from "./job-search.js";
import { submitCollectorBatch } from "./job-search/collector-api.js";
import {
  claimWindowsWorkerTask,
  completeWindowsWorkerTask,
  failWindowsWorkerTask,
  getWindowsWorkerHealth,
  getWindowsWorkerQueue,
  heartbeatWindowsWorkerTask,
  requireJobSearchWorkerToken,
} from "./job-search/worker-api.js";
import { handleLeadRequest } from "./leads.js";
import { handleMakhanaLeadRequest } from "./makhana-leads.js";
import { buildProductInsightResponse } from "./insights.js";
import { parseMcaFindCinResults, parseMcaMasterData } from "./mca.js";
import { enforceMutationSecurity, enforceRateLimit } from "./security.js";
import { buildSourceSummary, listSourceSnapshots, syncAllSources } from "./source-adapters.js";
import { createUdyamChallenge, parseUdyamImportedRecord, verifyUdyamRegistration } from "./udyam.js";
import {
  createWorkspace,
  createWorkspaceInvite,
  getWorkspaceDetailForUser,
  joinWorkspaceWithInvite,
  listWorkspaces,
  readWorkspaceState,
  selectWorkspace,
  writeWorkspaceState,
} from "./workspaces.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".csv": "text/csv; charset=utf-8",
};

function matchesPath(pathname, ...candidates) {
  return candidates.includes(pathname);
}

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

function sendJavascript(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/javascript; charset=utf-8",
  });
  response.end(body);
}

function getRouteMatch(pathname, expression) {
  const match = pathname.match(expression);
  return match ? match.slice(1) : null;
}

async function parseBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Invalid JSON payload.");
    error.statusCode = 400;
    throw error;
  }
}

function publicSessionShape(context) {
  if (!context) {
    return {
      signedIn: false,
      demoAvailable: true,
    };
  }

  return {
    signedIn: true,
    user: {
      id: context.user.id,
      name: context.user.name,
      email: context.user.email,
    },
    workspace: context.workspace,
    workspaces: context.workspaces,
    demoAvailable: true,
  };
}

function buildMakhanaPublicConfig() {
  return {
    brandName: process.env.MAKHANAMART_BRAND_NAME || "Makhanamart",
    supportPhone: process.env.MAKHANAMART_SUPPORT_PHONE || "",
    supportWhatsapp:
      process.env.MAKHANAMART_SUPPORT_WHATSAPP || process.env.MAKHANAMART_SUPPORT_PHONE || "",
    notificationEmails: [],
    orderWebhookUrl: "/api/makhana-leads",
    sellerWebhookUrl: "/api/makhana-leads",
  };
}

async function serveStatic(request, response, pathname) {
  const candidates = new Set();

  if (pathname === "/") {
    candidates.add("/index.html");
  } else {
    candidates.add(pathname);

    if (pathname.endsWith("/")) {
      candidates.add(`${pathname}index.html`);
    } else if (!path.extname(pathname)) {
      candidates.add(`${pathname}.html`);
      candidates.add(`${pathname}/index.html`);
    }
  }

  for (const candidate of candidates) {
    const targetPath = path.join(ROOT_DIR, candidate);

    if (!targetPath.startsWith(ROOT_DIR)) {
      sendText(response, 403, "Forbidden");
      return true;
    }

    try {
      const fileStat = await stat(targetPath);

      if (!fileStat.isFile()) {
        continue;
      }

      const ext = path.extname(targetPath).toLowerCase();
      response.writeHead(200, {
        "content-type": MIME_TYPES[ext] || "application/octet-stream",
      });
      createReadStream(targetPath).pipe(response);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  return false;
}

async function handleApi(request, response, url) {
  const sessionContext = await getSessionContext(request);
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const isAuthPath = url.pathname.startsWith("/api/auth/")
    || matchesPath(url.pathname, "/api/session", "/api/demo-login", "/api/login", "/api/register", "/api/logout");
  const isCronPath = matchesPath(
    url.pathname,
    "/api/cron/source-sync",
    "/api/cron-source-sync",
    "/api/cron/ingest",
    "/api/cron/job-search",
  );

  if (isMutation) {
    const category = isAuthPath
      ? "auth"
      : matchesPath(url.pathname, "/api/makhana-leads", "/api/leads")
        ? "lead"
        : isCronPath
          ? "cron"
          : matchesPath(url.pathname, "/api/analytics/events", "/api/telemetry")
            ? "analytics"
          : "write";
    enforceMutationSecurity(request, category);
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, runtime: getRuntimeStatus(request) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/makhana-public-config.js") {
    sendJavascript(
      response,
      200,
      `window.MAKHANAMART_CONFIG = ${JSON.stringify(buildMakhanaPublicConfig(), null, 2)};\n`,
    );
    return true;
  }

  if (url.pathname === "/api/makhana-leads") {
    return handleMakhanaLeadRequest(request, response);
  }

  if (url.pathname === "/api/leads") {
    return handleLeadRequest(request, response);
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    sendJson(response, 200, { runtime: getRuntimeStatus(request) });
    return true;
  }

  const insightMatch = getRouteMatch(url.pathname, /^\/api\/insights\/([^/]+)$/);

  if (request.method === "GET" && insightMatch) {
    const product = decodeURIComponent(insightMatch[0]);

    try {
      const payload = await buildProductInsightResponse(product, {
        sessionContext,
        searchParams: url.searchParams,
      });
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "Unable to build insights response.",
      });
    }

    return true;
  }

  if (
    ["GET", "POST"].includes(request.method)
    && matchesPath(url.pathname, "/api/cron/source-sync", "/api/cron-source-sync")
  ) {
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    const secret = url.searchParams.get("secret") || request.headers["x-cron-secret"] || bearer;

    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      sendJson(response, 401, { error: "Invalid cron secret." });
      return true;
    }

    const sources = await syncAllSources();
    const deliveries = await deliverScheduledAlerts(sources);
    sendJson(response, 200, {
      ok: true,
      summary: buildSourceSummary(sources),
      deliveries,
    });
    return true;
  }

  if (
    ["GET", "POST"].includes(request.method)
    && matchesPath(url.pathname, "/api/cron/ingest", "/api/cron/job-search")
  ) {
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
    const secret = url.searchParams.get("secret") || request.headers["x-cron-secret"] || bearer;

    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      sendJson(response, 401, { error: "Invalid cron secret." });
      return true;
    }

    const slot = new Date().getUTCHours() >= 12 ? "evening" : "morning";
    const payload = await runJobSearchIngest({ trigger: "cron", slot });
    sendJson(response, 202, payload);
    return true;
  }

  if (url.pathname.startsWith("/api/job-search/worker/")) {
    requireJobSearchWorkerToken(request);

    if (request.method === "GET" && url.pathname === "/api/job-search/worker/health") {
      sendJson(response, 200, getWindowsWorkerHealth());
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/job-search/worker/queue") {
      sendJson(response, 200, await getWindowsWorkerQueue());
      return true;
    }

    const body = await parseBody(request);
    if (request.method === "POST" && url.pathname === "/api/job-search/worker/queue/hold") {
      sendJson(response, 200, await holdJobSearchLocalQueue(body));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/job-search/worker/queue/release") {
      sendJson(response, 200, await releaseJobSearchLocalBacklog(body));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/job-search/worker/queue/retry-failed") {
      sendJson(response, 200, await retryFailedJobSearchLocalTasks(body));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/job-search/worker/claim") {
      sendJson(response, 200, await claimWindowsWorkerTask(body));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/job-search/worker/heartbeat") {
      sendJson(response, 200, await heartbeatWindowsWorkerTask(body));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/job-search/worker/result") {
      sendJson(response, 200, await completeWindowsWorkerTask(body));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/job-search/worker/failure") {
      sendJson(response, 200, await failWindowsWorkerTask(body));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/job-search/worker/discovery-batch") {
      sendJson(response, 200, await submitCollectorBatch(body));
      return true;
    }

    sendJson(response, 404, { error: "Worker endpoint not found." });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/job-search/status") {
    sendJson(response, 200, getJobSearchStatus(sessionContext));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/job-search/plan") {
    requireJobSearchAccess(sessionContext);
    sendJson(response, 200, getJobSearchPlan());
    return true;
  }

  if (request.method === "GET" && matchesPath(url.pathname, "/api/auth/session", "/api/session")) {
    sendJson(response, 200, publicSessionShape(sessionContext));
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/auth/demo", "/api/demo-login")) {
    const result = await buildDemoSession();
    sendJson(response, 200, { ok: true }, { "set-cookie": result.cookie });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/auth/register", "/api/register")) {
    const body = await parseBody(request);
    const user = await registerUser(body);
    const workspaces = await ensureUserWorkspace(user);
    const result = await createSession(user.id, workspaces[0].id);
    sendJson(response, 200, { ok: true }, { "set-cookie": result.cookie });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/auth/login", "/api/login")) {
    const body = await parseBody(request);
    const user = await authenticateUser(body.email, body.password);
    const workspaces = await ensureUserWorkspace(user);
    const workspace = workspaces.find((item) => item.id === body.workspaceId) || workspaces[0];
    const result = await createSession(user.id, workspace.id);
    sendJson(response, 200, { ok: true }, { "set-cookie": result.cookie });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/auth/logout", "/api/logout")) {
    if (sessionContext) {
      await revokeSession(sessionContext.session.id);
    }
    sendJson(response, 200, { ok: true }, { "set-cookie": buildClearSessionCookie() });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/analytics/events", "/api/telemetry")) {
    const body = await parseBody(request);
    if (Array.isArray(body?.events)) {
      const payload = await recordAnalyticsEvents(body, { sessionContext });
      sendJson(response, 200, payload);
    } else {
      const event = await recordAnalyticsEvent(body, sessionContext);
      sendJson(response, 200, {
        ok: true,
        event: {
          id: event.id,
          product: event.product,
          name: event.name,
          path: event.path,
          createdAt: event.createdAt,
          workspaceId: event.workspaceId,
        },
      });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/analytics/summary") {
    const payload = await getAnalyticsSummary({
      product: url.searchParams.get("product"),
      since: url.searchParams.get("since"),
      until: url.searchParams.get("until"),
    });
    sendJson(response, 200, payload);
    return true;
  }

  if (
    !sessionContext
    && request.method !== "GET"
    && url.pathname !== "/api/sources"
    && url.pathname !== "/api/analytics/events"
  ) {
    sendJson(response, 401, { error: "Sign in required." });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/billing") {
    const subscription = sessionContext
      ? await refreshSubscriptionFromProvider(sessionContext.workspace.id)
      : null;

    sendJson(response, 200, {
      plans: listPlans(),
      subscription,
      appUrl: getAppUrl(request),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/job-search/jobs") {
    requireJobSearchAccess(sessionContext);
    const payload = await getJobSearchDashboard({ view: url.searchParams.get("view") || "inbox" });
    sendJson(response, 200, payload);
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/job-search/ingest")) {
    requireJobSearchAccess(sessionContext);
    const body = await parseBody(request);
    const payload = await runJobSearchIngest({
      trigger: "manual",
      discoveryUrls: Array.isArray(body.discoveryUrls) ? body.discoveryUrls : [],
      slot: body.slot === "evening" ? "evening" : "morning",
    });
    sendJson(response, 202, payload);
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/job-search/providers/canary")) {
    requireJobSearchAccess(sessionContext);
    sendJson(response, 200, await runJobSearchProviderCanary());
    return true;
  }

  const jobFeedbackMatch = getRouteMatch(url.pathname, /^\/api\/job-search\/jobs\/([^/]+)\/feedback$/);

  if (request.method === "POST" && jobFeedbackMatch) {
    requireJobSearchAccess(sessionContext);
    const body = await parseBody(request);
    const feedback = body.disposition
      ? { disposition: body.disposition, reasons: body.reasons, note: body.note }
      : body.feedback;
    const job = await updateJobSearchFeedback(decodeURIComponent(jobFeedbackMatch[0]), feedback);
    sendJson(response, 200, { job });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/job-search/negative-feedback") {
    requireJobSearchAccess(sessionContext);
    const jobs = await listNegativeFeedbackJobs();
    sendJson(response, 200, { jobs });
    return true;
  }

  const jobRunMatch = getRouteMatch(url.pathname, /^\/api\/job-search\/runs\/([^/]+)$/);
  if (request.method === "GET" && jobRunMatch) {
    requireJobSearchAccess(sessionContext);
    const run = await getJobSearchRun(decodeURIComponent(jobRunMatch[0]));
    if (!run) {
      sendJson(response, 404, { error: "Run not found." });
    } else {
      sendJson(response, 200, { run });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/job-search/usage") {
    requireJobSearchAccess(sessionContext);
    sendJson(response, 200, { usage: await getJobSearchUsage() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/job-search/local-queue/hold") {
    requireJobSearchAccess(sessionContext);
    const body = await parseBody(request);
    sendJson(response, 200, await holdJobSearchLocalQueue(body));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/job-search/local-queue/release") {
    requireJobSearchAccess(sessionContext);
    const body = await parseBody(request);
    sendJson(response, 200, await releaseJobSearchLocalBacklog(body));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/job-search/taxonomy") {
    requireJobSearchAccess(sessionContext);
    sendJson(response, 200, { taxonomy: await getJobSearchTaxonomy() });
    return true;
  }

  const taxonomyActionMatch = getRouteMatch(url.pathname, /^\/api\/job-search\/taxonomy\/([^/]+)\/(approve|reject|rollback)$/);
  if (request.method === "POST" && taxonomyActionMatch) {
    requireJobSearchAccess(sessionContext);
    const pattern = await setJobSearchTaxonomyProposal(
      decodeURIComponent(taxonomyActionMatch[0]),
      taxonomyActionMatch[1],
    );
    sendJson(response, 200, { pattern });
    return true;
  }

  const rerunJobMatch = getRouteMatch(url.pathname, /^\/api\/job-search\/jobs\/([^/]+)\/rerun$/);
  if (request.method === "POST" && rerunJobMatch) {
    requireJobSearchAccess(sessionContext);
    const payload = await rerunJobSearchJob(decodeURIComponent(rerunJobMatch[0]));
    sendJson(response, 202, payload);
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/billing/checkout", "/api/billing-checkout")) {
    const body = await parseBody(request);
    const origin = getAppUrl(request);
    const result = await startCheckoutSession({
      workspaceId: sessionContext.workspace.id,
      billingEmail: body.billingEmail || sessionContext.user.email,
      planKey: body.planKey,
      successUrl: body.successUrl || `${origin}/dashboards.html#workspace-control-center`,
      cancelUrl: body.cancelUrl || `${origin}/dashboards.html#workspace-control-center`,
    });

    sendJson(response, 200, {
      ...result,
      plans: listPlans(),
    });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/billing/refresh", "/api/billing-refresh")) {
    const subscription = await refreshSubscriptionFromProvider(sessionContext.workspace.id);
    sendJson(response, 200, {
      subscription,
      plans: listPlans(),
    });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/billing/free", "/api/billing-free")) {
    const subscription = await changePlanLocally(
      sessionContext.workspace.id,
      "free",
      sessionContext.user.email,
    );

    sendJson(response, 200, {
      ...subscription,
      plans: listPlans(),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/alerts") {
    const rules = sessionContext ? await listAlertRules(sessionContext.workspace.id) : [];
    const subscription = sessionContext
      ? await getWorkspaceSubscription(sessionContext.workspace.id, sessionContext.user.email)
      : null;

    sendJson(response, 200, {
      rules,
      subscription,
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/alerts") {
    const body = await parseBody(request);
    const rule = await createAlertRule({
      workspaceId: sessionContext.workspace.id,
      product: body.product,
      label: body.label,
      filters: body.filters,
      recipients: body.recipients,
      fallbackEmail: sessionContext.user.email,
    });

    sendJson(response, 200, { rule });
    return true;
  }

  const alertTestMatch = getRouteMatch(url.pathname, /^\/api\/alerts\/([^/]+)\/test$/);
  const alertTestId = alertTestMatch?.[0] || (url.pathname === "/api/alert-test" ? url.searchParams.get("id") : null);

  if (request.method === "POST" && alertTestId) {
    const alertId = decodeURIComponent(alertTestId);
    const snapshots = await listSourceSnapshots();
    const preview = await testAlertRule(sessionContext.workspace.id, alertId, snapshots);
    sendJson(response, 200, preview);
    return true;
  }

  const alertRouteMatch = getRouteMatch(url.pathname, /^\/api\/alerts\/([^/]+)$/);
  const alertRouteId = alertRouteMatch?.[0] || (url.pathname === "/api/alert-rule" ? url.searchParams.get("id") : null);

  if ((request.method === "PATCH" || request.method === "PUT") && alertRouteId) {
    const alertId = decodeURIComponent(alertRouteId);
    const body = await parseBody(request);
    const rule = await updateAlertRule(sessionContext.workspace.id, alertId, body);
    sendJson(response, 200, { rule });
    return true;
  }

  if (request.method === "DELETE" && alertRouteId) {
    const alertId = decodeURIComponent(alertRouteId);
    await deleteAlertRule(sessionContext.workspace.id, alertId);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/workspaces") {
    sendJson(response, 200, {
      workspaces: sessionContext ? sessionContext.workspaces : [],
      activeWorkspaceId: sessionContext?.workspace.id || null,
      activeWorkspace: sessionContext?.workspace || null,
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/workspaces") {
    const body = await parseBody(request);
    const workspace = await createWorkspace(sessionContext.user.id, body.name);
    await selectWorkspace(sessionContext.session.id, sessionContext.user.id, workspace.id);
    sendJson(response, 200, { workspace });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/workspaces/select", "/api/workspace-select")) {
    const body = await parseBody(request);
    const allowed = sessionContext.workspaces.some((item) => item.id === body.workspaceId);

    if (!allowed) {
      sendJson(response, 403, { error: "Workspace not found." });
      return true;
    }

    await selectWorkspace(sessionContext.session.id, sessionContext.user.id, body.workspaceId);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/workspaces/invite", "/api/workspace-invite")) {
    const invite = await createWorkspaceInvite(sessionContext.user.id, sessionContext.workspace.id);
    const workspace = await getWorkspaceDetailForUser(sessionContext.user.id, sessionContext.workspace.id);
    sendJson(response, 200, { invite, workspace });
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/workspaces/join", "/api/workspace-join")) {
    const body = await parseBody(request);
    const workspace = await joinWorkspaceWithInvite(sessionContext.user.id, body.code);
    await selectWorkspace(sessionContext.session.id, sessionContext.user.id, workspace.id);
    sendJson(response, 200, { workspace });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    const namespace = url.searchParams.get("namespace");
    const value =
      namespace && sessionContext ? await readWorkspaceState(sessionContext.workspace.id, namespace) : null;
    sendJson(response, 200, { namespace, value });
    return true;
  }

  if (request.method === "PUT" && url.pathname === "/api/state") {
    const namespace = url.searchParams.get("namespace");

    if (!namespace) {
      sendJson(response, 400, { error: "Namespace is required." });
      return true;
    }

    const body = await parseBody(request);
    const record = await writeWorkspaceState(sessionContext.workspace.id, namespace, body.value);
    sendJson(response, 200, { namespace, value: record.value, updatedAt: record.updatedAt });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/sources") {
    const sources = await listSourceSnapshots();
    sendJson(response, 200, { sources, summary: buildSourceSummary(sources) });
    return true;
  }

  if (request.method === "GET" && matchesPath(url.pathname, "/api/sources/udyam/challenge", "/api/udyam-challenge")) {
    if (!sessionContext) {
      sendJson(response, 401, { error: "Sign in required." });
      return true;
    }

    enforceRateLimit(request, "udyam-challenge", { windowMs: 60_000, max: 20 });
    const challenge = await createUdyamChallenge();
    sendJson(response, 200, challenge);
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/sources/udyam/verify", "/api/udyam-verify")) {
    const body = await parseBody(request);
    const result = await verifyUdyamRegistration({
      token: body.token,
      registrationNumber: body.registrationNumber,
      captcha: body.captcha,
    });
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/sources/udyam/import", "/api/udyam-certificate-parse")) {
    const body = await parseBody(request);

    if (!body.content || !String(body.content).trim()) {
      sendJson(response, 400, { error: "Official Udyam certificate or QR verification text/HTML is required." });
      return true;
    }

    const result = parseUdyamImportedRecord(body.content);
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/sources/mca/parse", "/api/mca-parse")) {
    const body = await parseBody(request);

    if (!body.content || !String(body.content).trim()) {
      sendJson(response, 400, { error: "Official MCA page text or HTML is required." });
      return true;
    }

    const result = parseMcaMasterData(body.content);
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/sources/mca/find-cin-parse", "/api/mca-find-cin-parse")) {
    const body = await parseBody(request);

    if (!body.content || !String(body.content).trim()) {
      sendJson(response, 400, { error: "Official MCA Find CIN text or HTML is required." });
      return true;
    }

    const result = parseMcaFindCinResults(body.content);
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "POST" && matchesPath(url.pathname, "/api/sources/sync", "/api/source-sync")) {
    const sources = await syncAllSources();
    sendJson(response, 200, { sources, summary: buildSourceSummary(sources) });
    return true;
  }

  return false;
}

export async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) {
        sendJson(response, 404, { error: "Not found." });
      }
      return;
    }

    const served = await serveStatic(request, response, url.pathname);

    if (!served) {
      sendText(response, 404, "Not found");
    }
  } catch (error) {
    sendJson(response, error.statusCode || (error.name === "ZodError" ? 400 : 500), {
      error: error.message,
    });
  }
}
