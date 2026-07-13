import crypto from "node:crypto";

import { nowIso, readDb, updateDb } from "./persistence.js";

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function createInviteCode() {
  const chunk = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TG-${chunk()}-${chunk()}`;
}

function getMembership(db, userId, workspaceId) {
  return db.workspaceMemberships.find((item) => item.userId === userId && item.workspaceId === workspaceId) || null;
}

function buildWorkspaceSummary(db, workspace, membership) {
  const memberCount = db.workspaceMemberships.filter((item) => item.workspaceId === workspace.id).length;

  return {
    id: workspace.id,
    name: workspace.name,
    role: membership.role,
    memberCount,
    ownerUserId: workspace.ownerUserId || workspace.userId || null,
    createdAt: workspace.createdAt,
  };
}

function buildWorkspaceDetail(db, workspace, membership) {
  const members = db.workspaceMemberships
    .filter((item) => item.workspaceId === workspace.id)
    .map((item) => {
      const user = db.users.find((entry) => entry.id === item.userId);
      return {
        id: item.id,
        userId: item.userId,
        role: item.role,
        joinedAt: item.createdAt,
        name: user?.name || "Unknown member",
        email: user?.email || "",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const invites = db.workspaceInvites
    .filter((item) => item.workspaceId === workspace.id)
    .map((invite) => ({
      id: invite.id,
      code: invite.code,
      status: invite.status,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt || null,
      acceptedByUserId: invite.acceptedByUserId || null,
    }))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return {
    ...buildWorkspaceSummary(db, workspace, membership),
    members,
    invites,
  };
}

export async function listWorkspaces(userId) {
  const db = await readDb();

  return db.workspaceMemberships
    .filter((item) => item.userId === userId)
    .map((membership) => {
      const workspace = db.workspaces.find((item) => item.id === membership.workspaceId);
      return workspace ? buildWorkspaceSummary(db, workspace, membership) : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getWorkspaceDetailForUser(userId, workspaceId) {
  const db = await readDb();
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const membership = workspace ? getMembership(db, userId, workspaceId) : null;

  if (!workspace || !membership) {
    return null;
  }

  return buildWorkspaceDetail(db, workspace, membership);
}

export async function createWorkspace(ownerUserId, name) {
  const trimmed = String(name || "").trim();

  if (!trimmed) {
    throw new Error("Workspace name is required.");
  }

  const workspaceId = createId("ws");

  await updateDb((draft) => {
    draft.workspaces.push({
      id: workspaceId,
      ownerUserId,
      userId: ownerUserId,
      name: trimmed,
      isDefault: false,
      createdAt: nowIso(),
    });
    draft.workspaceMemberships.push({
      id: createId("membership"),
      workspaceId,
      userId: ownerUserId,
      role: "owner",
      createdAt: nowIso(),
    });
    return draft;
  });

  return getWorkspaceDetailForUser(ownerUserId, workspaceId);
}

export async function selectWorkspace(sessionId, userId, workspaceId) {
  const db = await updateDb((draft) => {
    const session = draft.sessions.find((item) => item.id === sessionId);

    if (!session || session.userId !== userId) {
      throw new Error("Session not found.");
    }

    const membership = getMembership(draft, userId, workspaceId);

    if (!membership) {
      throw new Error("Workspace not found.");
    }

    session.workspaceId = workspaceId;
    return draft;
  });

  return db.sessions.find((item) => item.id === sessionId);
}

export async function createWorkspaceInvite(userId, workspaceId) {
  const inviteId = createId("invite");
  const code = createInviteCode();

  const db = await updateDb((draft) => {
    const membership = getMembership(draft, userId, workspaceId);

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new Error("Only workspace owners or admins can create invites.");
    }

    draft.workspaceInvites = draft.workspaceInvites.map((invite) =>
      invite.workspaceId === workspaceId && invite.status === "active"
        ? { ...invite, status: "superseded" }
        : invite,
    );

    draft.workspaceInvites.push({
      id: inviteId,
      workspaceId,
      code,
      status: "active",
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      acceptedAt: null,
      acceptedByUserId: null,
    });
    return draft;
  });

  return db.workspaceInvites.find((item) => item.id === inviteId);
}

export async function joinWorkspaceWithInvite(userId, inviteCode) {
  const normalizedCode = String(inviteCode || "").trim().toUpperCase();

  if (!normalizedCode) {
    throw new Error("Invite code is required.");
  }

  const updated = await updateDb((draft) => {
    const invite = draft.workspaceInvites.find((item) => item.code === normalizedCode);

    if (!invite) {
      throw new Error("Invite code not found.");
    }

    if (invite.status !== "active") {
      throw new Error("Invite code is no longer active.");
    }

    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      invite.status = "expired";
      throw new Error("Invite code has expired.");
    }

    const existingMembership = getMembership(draft, userId, invite.workspaceId);

    if (!existingMembership) {
      draft.workspaceMemberships.push({
        id: createId("membership"),
        workspaceId: invite.workspaceId,
        userId,
        role: "member",
        createdAt: nowIso(),
      });
    }

    invite.status = "used";
    invite.acceptedAt = nowIso();
    invite.acceptedByUserId = userId;
    return draft;
  });

  const invite = updated.workspaceInvites.find((item) => item.code === normalizedCode);
  return getWorkspaceDetailForUser(userId, invite.workspaceId);
}

export async function readWorkspaceState(workspaceId, namespace) {
  const db = await readDb();
  const record = db.state.find((item) => item.workspaceId === workspaceId && item.namespace === namespace);
  return record ? record.value : null;
}

export async function writeWorkspaceState(workspaceId, namespace, value) {
  const db = await updateDb((draft) => {
    const record = draft.state.find((item) => item.workspaceId === workspaceId && item.namespace === namespace);

    if (record) {
      record.value = value;
      record.updatedAt = nowIso();
    } else {
      draft.state.push({
        workspaceId,
        namespace,
        value,
        updatedAt: nowIso(),
      });
    }

    return draft;
  });

  return db.state.find((item) => item.workspaceId === workspaceId && item.namespace === namespace);
}
