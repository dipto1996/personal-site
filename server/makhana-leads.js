import { neon } from "@neondatabase/serverless";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";

const DATA_DIR = process.env.TRADEGRAPH_DATA_DIR
  ? path.resolve(process.env.TRADEGRAPH_DATA_DIR)
  : path.join(process.cwd(), ".data");
const LEADS_PATH = path.join(DATA_DIR, "makhanamart-leads.json");
const DASHBOARD_KEY = process.env.MAKHANAMART_DASHBOARD_KEY || "";

const parseNotificationEmails = () =>
  (process.env.LEAD_NOTIFICATION_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
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

function validatePayload(payload) {
  const formType = payload?.formType;
  const data = payload?.data || {};

  if (!payload?.requestId || !formType || !["buyer", "seller"].includes(formType)) {
    return "Invalid request payload.";
  }

  if (!data.fullName || !data.phone) {
    return "Name and phone are required.";
  }

  return null;
}

function buildEmailHtml(payload) {
  const { requestId, formType, submittedAt, data } = payload;

  return `
    <div style="font-family: Arial, sans-serif; color: #1d241a;">
      <h2 style="margin-bottom: 16px;">Makhanamart ${formType === "seller" ? "stock offer" : "buying requirement"}</h2>
      <p><strong>Request ID:</strong> ${requestId}</p>
      <p><strong>Submitted at:</strong> ${submittedAt}</p>
      <p><strong>Name:</strong> ${data.fullName}</p>
      <p><strong>Company:</strong> ${data.company || "-"}</p>
      <p><strong>Email:</strong> ${data.email || "-"}</p>
      <p><strong>Phone:</strong> ${data.phone}</p>
      <p><strong>Grade / stock:</strong> ${data.grade || "-"}</p>
      <p><strong>Quantity:</strong> ${data.quantity || "-"}</p>
      <p><strong>Packaging / service need:</strong> ${data.packaging || "-"}</p>
      <p><strong>Destination / location:</strong> ${data.destination || "-"}</p>
      <p><strong>Notes:</strong><br />${(data.notes || "-").replace(/\n/g, "<br />")}</p>
    </div>
  `;
}

async function ensureLocalDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readLocalLeads() {
  await ensureLocalDir();

  try {
    const raw = await readFile(LEADS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeLocalLeads(leads) {
  await ensureLocalDir();
  await writeFile(LEADS_PATH, JSON.stringify(leads, null, 2));
}

function getDatabaseClient() {
  return process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
}

async function ensureLeadTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS makhana_leads (
      id BIGSERIAL PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      form_type TEXT NOT NULL,
      full_name TEXT NOT NULL,
      company TEXT,
      email TEXT,
      phone TEXT NOT NULL,
      grade TEXT,
      quantity TEXT,
      packaging TEXT,
      destination TEXT,
      notes TEXT,
      submitted_at TIMESTAMPTZ NOT NULL,
      source TEXT DEFAULT 'website',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

function buildLeadRecord(payload, leadId) {
  const { data } = payload;

  return {
    id: leadId,
    requestId: payload.requestId,
    formType: payload.formType,
    fullName: data.fullName,
    company: data.company || "",
    email: data.email || "",
    phone: data.phone,
    grade: data.grade || "",
    quantity: data.quantity || "",
    packaging: data.packaging || "",
    destination: data.destination || "",
    notes: data.notes || "",
    submittedAt: payload.submittedAt,
    createdAt: new Date().toISOString(),
    source: "website",
  };
}

async function insertLead(payload) {
  const sql = getDatabaseClient();

  if (sql) {
    await ensureLeadTable(sql);

    const inserted = await sql`
      INSERT INTO makhana_leads (
        request_id,
        form_type,
        full_name,
        company,
        email,
        phone,
        grade,
        quantity,
        packaging,
        destination,
        notes,
        submitted_at
      ) VALUES (
        ${payload.requestId},
        ${payload.formType},
        ${payload.data.fullName},
        ${payload.data.company || null},
        ${payload.data.email || null},
        ${payload.data.phone},
        ${payload.data.grade || null},
        ${payload.data.quantity || null},
        ${payload.data.packaging || null},
        ${payload.data.destination || null},
        ${payload.data.notes || null},
        ${payload.submittedAt}
      )
      RETURNING
        id,
        request_id AS "requestId",
        form_type AS "formType",
        full_name AS "fullName",
        company,
        email,
        phone,
        grade,
        quantity,
        packaging,
        destination,
        notes,
        submitted_at AS "submittedAt",
        created_at AS "createdAt",
        source;
    `;

    return inserted[0];
  }

  const leads = await readLocalLeads();
  const leadId = leads.length ? Number(leads[0].id || 0) + 1 : 1;
  const record = buildLeadRecord(payload, leadId);
  leads.unshift(record);
  await writeLocalLeads(leads);
  return record;
}

async function listLeads(limit) {
  const sql = getDatabaseClient();

  if (sql) {
    await ensureLeadTable(sql);

    return sql`
      SELECT
        id,
        request_id AS "requestId",
        form_type AS "formType",
        full_name AS "fullName",
        company,
        email,
        phone,
        grade,
        quantity,
        packaging,
        destination,
        notes,
        submitted_at AS "submittedAt",
        created_at AS "createdAt",
        source
      FROM makhana_leads
      ORDER BY created_at DESC
      LIMIT ${limit};
    `;
  }

  const leads = await readLocalLeads();
  return leads.slice(0, limit);
}

function buildSummary(leads) {
  return {
    total: leads.length,
    buyers: leads.filter((lead) => lead.formType === "buyer").length,
    sellers: leads.filter((lead) => lead.formType === "seller").length,
    lastSubmittedAt: leads[0]?.submittedAt || null,
  };
}

function getDashboardKeyFromRequest(request, url) {
  return request.headers["x-dashboard-key"] || url.searchParams.get("accessKey") || "";
}

async function handleDashboardRequest(request, response) {
  if (!DASHBOARD_KEY) {
    sendJson(response, 503, {
      error: "Dashboard key is not configured.",
    });
    return true;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const accessKey = getDashboardKeyFromRequest(request, url);

  if (!accessKey || accessKey !== DASHBOARD_KEY) {
    sendJson(response, 401, {
      error: "Invalid dashboard key.",
    });
    return true;
  }

  const rawLimit = Number(url.searchParams.get("limit") || 60);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 60;
  const leads = await listLeads(limit);

  sendJson(response, 200, {
    ok: true,
    summary: buildSummary(leads),
    leads,
  });

  return true;
}

export async function handleMakhanaLeadRequest(request, response) {
  if (request.method === "GET") {
    return handleDashboardRequest(request, response);
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const payload = await parseBody(request);
  const validationError = validatePayload(payload);

  if (validationError) {
    sendJson(response, 400, { error: validationError });
    return true;
  }

  const storedLead = await insertLead(payload);
  const resendApiKey = process.env.RESEND_API_KEY;
  const notificationEmails = parseNotificationEmails();
  const fromEmail = process.env.LEAD_FROM_EMAIL;

  if (resendApiKey && notificationEmails.length && fromEmail) {
    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: fromEmail,
      to: notificationEmails,
      replyTo: payload.data.email || undefined,
      subject: `Makhanamart | ${payload.formType === "seller" ? "Stock offer" : "Buying requirement"} | ${payload.requestId}`,
      html: buildEmailHtml(payload),
    });
  }

  sendJson(response, 200, {
    ok: true,
    leadId: storedLead.id,
    requestId: payload.requestId,
  });

  return true;
}
