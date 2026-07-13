import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "tradegraph-auth-"));
process.env.TRADEGRAPH_DATA_DIR = tempDir;

const auth = await import("../server/auth.js");
const persistence = await import("../server/persistence.js");
const workspaces = await import("../server/workspaces.js");

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("registerUser creates a default workspace and authenticates successfully", async () => {
  const user = await auth.registerUser({
    name: "Northstar Owner",
    email: "owner@example.com",
    password: "OwnerPass123!",
  });

  const workspacesForUser = await workspaces.listWorkspaces(user.id);
  const authenticated = await auth.authenticateUser("owner@example.com", "OwnerPass123!");

  assert.equal(authenticated.id, user.id);
  assert.equal(workspacesForUser.length, 1);
  assert.match(workspacesForUser[0].name, /Northstar/i);
});

test("login helpers repair an account whose workspace creation was interrupted", async () => {
  const user = await auth.registerUser({
    name: "Interrupted Owner",
    email: "interrupted@example.com",
    password: "InterruptedPass123!",
  });
  await persistence.updateDb((draft) => {
    const workspaceIds = new Set(draft.workspaceMemberships.filter((item) => item.userId === user.id).map((item) => item.workspaceId));
    draft.workspaceMemberships = draft.workspaceMemberships.filter((item) => item.userId !== user.id);
    draft.workspaces = draft.workspaces.filter((item) => !workspaceIds.has(item.id));
    return draft;
  });

  const repaired = await auth.ensureUserWorkspace(user);
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].role, "owner");
});

test("invalid credentials return an authentication status instead of a server error", async () => {
  await assert.rejects(
    auth.authenticateUser("missing@example.com", "WrongPass123!"),
    (error) => error.statusCode === 401 && /Invalid email or password/.test(error.message),
  );
});

test("a failed persistence mutation does not poison subsequent writes", async () => {
  await assert.rejects(persistence.updateDb(() => {
    throw new Error("intentional fixture failure");
  }));
  const updated = await persistence.updateDb((draft) => {
    draft.version = Number(draft.version || 0) + 1;
    return draft;
  });
  assert.ok(updated.version > 0);
});

test("workspace invite flow supports a second user joining the same workspace", async () => {
  const owner = await auth.registerUser({
    name: "Factory Owner",
    email: "factory.owner@example.com",
    password: "FactoryPass123!",
  });
  const teammate = await auth.registerUser({
    name: "Bid Analyst",
    email: "bid.analyst@example.com",
    password: "AnalystPass123!",
  });

  const [ownerWorkspace] = await workspaces.listWorkspaces(owner.id);
  const invite = await workspaces.createWorkspaceInvite(owner.id, ownerWorkspace.id);
  const joinedWorkspace = await workspaces.joinWorkspaceWithInvite(teammate.id, invite.code);

  assert.equal(joinedWorkspace.id, ownerWorkspace.id);
  assert.equal(joinedWorkspace.memberCount, 2);
  assert.ok(joinedWorkspace.members.some((member) => member.email === "bid.analyst@example.com"));
});

test("session context includes shared workspace details and persisted state", async () => {
  const owner = await auth.registerUser({
    name: "Export Lead",
    email: "export.lead@example.com",
    password: "ExportPass123!",
  });
  const [workspace] = await workspaces.listWorkspaces(owner.id);
  const session = await auth.createSession(owner.id, workspace.id);

  await workspaces.writeWorkspaceState(workspace.id, "exportpulse.workspace", {
    shortlistIds: ["EP-004"],
    workflow: { "EP-004": "Buyer outreach" },
  });

  const context = await auth.getSessionContext({
    headers: {
      cookie: session.cookie.split(";")[0],
    },
  });
  const stored = await workspaces.readWorkspaceState(workspace.id, "exportpulse.workspace");

  assert.equal(context.user.email, "export.lead@example.com");
  assert.equal(context.workspace.id, workspace.id);
  assert.equal(context.workspace.members.length, 1);
  assert.deepEqual(stored.workflow, { "EP-004": "Buyer outreach" });
});
