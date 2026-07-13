import { neon } from "@neondatabase/serverless";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";

const DATA_DIR = process.env.TRADEGRAPH_DATA_DIR
  ? path.resolve(process.env.TRADEGRAPH_DATA_DIR)
  : path.join(process.cwd(), ".data");
const LEADS_PATH = path.join(DATA_DIR, "tradegraph-leads.json");

const DEFAULT_NOTIFICATION_EMAILS = () =>
  (process.env.LEAD_NOTIFICATION_EMAILS || "")
    .split(",")
    .map((value) => value.trim())
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

function normalizeValue(value) {
  return String(value || "").trim();
}

function validateLeadPayload(payload) {
  const name = normalizeValue(payload?.name);
  const email = normalizeValue(payload?.email);
  const reason = normalizeValue(payload?.reason);
  const message = normalizeValue(payload?.message);

  if (!name) {
    return "Name is required.";
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "A valid email is required.";
  }

  if (!reason) {
    return "A reason is required.";
  }

  if (!message) {
    return "Message is required.";
  }

  return "";
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
    CREATE TABLE IF NOT EXISTS tg_leads (
      id BIGSERIAL PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT,
      reason TEXT NOT NULL,
      product TEXT,
      source_page TEXT,
      timeline TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      submitted_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

function createRequestId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TG-${timestamp}-${suffix}`;
}

function buildLeadRecord(payload, leadId, requestId, submittedAt) {
  return {
    id: leadId,
    requestId,
    name: normalizeValue(payload.name),
    email: normalizeValue(payload.email),
    company: normalizeValue(payload.company),
    reason: normalizeValue(payload.reason),
    product: normalizeValue(payload.product),
    sourcePage: normalizeValue(payload.sourcePage),
    timeline: normalizeValue(payload.timeline),
    message: normalizeValue(payload.message),
    status: "new",
    submittedAt,
    createdAt: new Date().toISOString(),
  };
}

async function insertLead(payload) {
  const sql = getDatabaseClient();
  const requestId = createRequestId();
  const submittedAt = new Date().toISOString();

  if (sql) {
    await ensureLeadTable(sql);

    const inserted = await sql`
      INSERT INTO tg_leads (
        request_id,
        name,
        email,
        company,
        reason,
        product,
        source_page,
        timeline,
        message,
        submitted_at
      ) VALUES (
        ${requestId},
        ${normalizeValue(payload.name)},
        ${normalizeValue(payload.email)},
        ${normalizeValue(payload.company) || null},
        ${normalizeValue(payload.reason)},
        ${normalizeValue(payload.product) || null},
        ${normalizeValue(payload.sourcePage) || null},
        ${normalizeValue(payload.timeline) || null},
        ${normalizeValue(payload.message)},
        ${submittedAt}
      )
      RETURNING
        id,
        request_id AS "requestId",
        name,
        email,
        company,
        reason,
        product,
        source_page AS "sourcePage",
        timeline,
        message,
        status,
        submitted_at AS "submittedAt",
        created_at AS "createdAt";
    `;

    return inserted[0];
  }

  const leads = await readLocalLeads();
  const leadId = leads.length ? Number(leads[0].id || 0) + 1 : 1;
  const record = buildLeadRecord(payload, leadId, requestId, submittedAt);
  leads.unshift(record);
  await writeLocalLeads(leads);
  return record;
}

function buildLeadEmailHtml(record) {
  return `
    <div style="font-family: Arial, sans-serif; color: #11141a; line-height: 1.6;">
      <h2 style="margin: 0 0 16px;">Personal site lead</h2>
      <p><strong>Request ID:</strong> ${record.requestId}</p>
      <p><strong>Name:</strong> ${record.name}</p>
      <p><strong>Email:</strong> ${record.email}</p>
      <p><strong>Company:</strong> ${record.company || "-"}</p>
      <p><strong>Reason:</strong> ${record.reason}</p>
      <p><strong>Product:</strong> ${record.product || "-"}</p>
      <p><strong>Source page:</strong> ${record.sourcePage || "-"}</p>
      <p><strong>Timeline:</strong> ${record.timeline || "-"}</p>
      <p><strong>Submitted at:</strong> ${record.submittedAt}</p>
      <p><strong>Message:</strong><br />${record.message.replace(/\n/g, "<br />")}</p>
    </div>
  `;
}

async function deliverLead(record) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.LEAD_FROM_EMAIL || process.env.ALERT_FROM_EMAIL;
  const recipients = DEFAULT_NOTIFICATION_EMAILS();

  if (!resendApiKey || !fromEmail || !recipients.length) {
    return {
      mode: "saved_only",
      delivered: false,
      note: "Lead was saved, but email delivery is not configured.",
    };
  }

  const resend = new Resend(resendApiKey);
  await resend.emails.send({
    from: fromEmail,
    to: recipients,
    replyTo: record.email,
    subject: `Personal site lead | ${record.reason} | ${record.requestId}`,
    html: buildLeadEmailHtml(record),
  });

  return {
    mode: "email",
    delivered: true,
    note: "Lead was saved and notification email was sent.",
  };
}

export async function handleLeadRequest(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  const payload = await parseBody(request);
  const validationError = validateLeadPayload(payload);

  if (validationError) {
    sendJson(response, 400, { error: validationError });
    return true;
  }

  const lead = await insertLead(payload);
  const delivery = await deliverLead(lead);

  sendJson(response, 200, {
    ok: true,
    leadId: lead.id,
    requestId: lead.requestId,
    delivery,
  });

  return true;
}
