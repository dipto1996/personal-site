import crypto from "node:crypto";

import { nowIso, readDb, updateDb } from "./persistence.js";
import { createWorkspace, getWorkspaceDetailForUser, listWorkspaces } from "./workspaces.js";

const SESSION_COOKIE = "tradegraph_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const DEMO_EMAIL = "demo@tradegraph.local";
const DEMO_PASSWORD = "TradeGraphDemo123!";

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.pbkdf2Sync(password, salt, 120_000, 64, "sha512").toString("hex");

  return { salt, derived };
}

function safeCompare(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function invalidCredentialsError() {
  const error = new Error("Invalid email or password.");
  error.statusCode = 401;
  return error;
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const index = chunk.indexOf("=");
        return index === -1 ? [chunk, ""] : [chunk.slice(0, index), chunk.slice(index + 1)];
      }),
  );
}

function buildSessionCookie(sessionId, expiresAt) {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
    (new Date(expiresAt).getTime() - Date.now()) / 1000,
  )}`;
}

export function buildClearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function ensureDemoUser() {
  const db = await updateDb((draft) => {
    let user = draft.users.find((item) => item.email === DEMO_EMAIL);

    if (!user) {
      const password = hashPassword(DEMO_PASSWORD);
      user = {
        id: createId("user"),
        name: "TradeGraph Demo",
        email: DEMO_EMAIL,
        passwordSalt: password.salt,
        passwordHash: password.derived,
        createdAt: nowIso(),
      };
      draft.users.push(user);
    }

    return draft;
  });

  const user = db.users.find((item) => item.email === DEMO_EMAIL);
  const workspaces = await listWorkspaces(user.id);

  if (!workspaces.length) {
    await createWorkspace(user.id, "Northstar Foods Demo");
  }

  return readDb();
}

export async function registerUser({ name, email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim();

  if (!normalizedName || !normalizedEmail || !password || password.length < 8) {
    throw new Error("Name, email, and an 8+ character password are required.");
  }

  const passwordMeta = hashPassword(password);
  const userId = createId("user");
  const workspaceId = createId("ws");
  const createdAt = nowIso();

  const db = await updateDb((draft) => {
    if (draft.users.some((item) => item.email === normalizedEmail)) {
      throw new Error("An account with that email already exists.");
    }

    const user = {
      id: userId,
      name: normalizedName,
      email: normalizedEmail,
      passwordSalt: passwordMeta.salt,
      passwordHash: passwordMeta.derived,
      createdAt,
    };

    draft.users.push(user);
    draft.workspaces.push({
      id: workspaceId,
      ownerUserId: userId,
      userId,
      name: `${normalizedName.split(" ")[0] || "Workspace"} Workspace`,
      isDefault: true,
      createdAt,
    });
    draft.workspaceMemberships.push({
      id: createId("membership"),
      workspaceId,
      userId,
      role: "owner",
      createdAt,
    });

    return draft;
  });

  return db.users.find((item) => item.email === normalizedEmail);
}

export async function ensureUserWorkspace(user) {
  let workspaces = await listWorkspaces(user.id);
  if (!workspaces.length) {
    await createWorkspace(user.id, `${String(user.name || "Owner").split(" ")[0] || "Owner"} Workspace`);
    workspaces = await listWorkspaces(user.id);
  }
  if (!workspaces.length) {
    throw new Error("Unable to initialize the account workspace.");
  }
  return workspaces;
}

export async function authenticateUser(email, password) {
  const db = await readDb();
  const user = db.users.find((item) => item.email === String(email || "").trim().toLowerCase());

  if (!user) {
    throw invalidCredentialsError();
  }

  const candidate = hashPassword(password, user.passwordSalt);

  if (!safeCompare(candidate.derived, user.passwordHash)) {
    throw invalidCredentialsError();
  }

  return user;
}

export async function createSession(userId, workspaceId) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const session = {
    id: createId("session"),
    userId,
    workspaceId,
    createdAt: nowIso(),
    expiresAt,
  };

  await updateDb((db) => {
    db.sessions = db.sessions.filter((item) => new Date(item.expiresAt).getTime() > Date.now());
    db.sessions.push(session);
    return db;
  });

  return {
    session,
    cookie: buildSessionCookie(session.id, expiresAt),
  };
}

export async function revokeSession(sessionId) {
  if (!sessionId) {
    return;
  }

  await updateDb((db) => {
    db.sessions = db.sessions.filter((item) => item.id !== sessionId);
    return db;
  });
}

export async function getSessionContext(request) {
  const cookies = parseCookies(request.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE];

  if (!sessionId) {
    return null;
  }

  const db = await readDb();
  const session = db.sessions.find((item) => item.id === sessionId);

  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  const user = db.users.find((item) => item.id === session.userId);
  const workspaces = await listWorkspaces(session.userId);
  const workspace = (await getWorkspaceDetailForUser(session.userId, session.workspaceId)) || null;

  if (!user || !workspaces.length) {
    return null;
  }

  const activeWorkspace = workspace || (await getWorkspaceDetailForUser(session.userId, workspaces[0].id));

  if (!activeWorkspace) {
    return null;
  }

  return {
    session,
    user,
    workspace: activeWorkspace,
    workspaces,
  };
}

export async function buildDemoSession() {
  await ensureDemoUser();
  const db = await readDb();
  const user = db.users.find((item) => item.email === DEMO_EMAIL);
  const [workspace] = await listWorkspaces(user.id);
  return createSession(user.id, workspace.id);
}

export function getDemoCredentials() {
  return {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  };
}
