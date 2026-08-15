import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import sharp from "sharp";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { PrivateImageValidationError } from "@/features/profile/private-images";
import { db } from "@/lib/db";
import { deleteObject, objectExists } from "@/lib/storage/object-storage";

import {
  archiveWorkspace,
  leaveWorkspace,
  restoreWorkspace,
  transferWorkspaceOwnership,
  workspacePermanentDeletionPolicy,
} from "./lifecycle-service";
import { removeWorkspaceLogo, saveWorkspaceLogo } from "./logo-service";
import { WorkspaceLifecycleError, WorkspaceSettingsValidationError } from "./settings-errors";
import { updateWorkspaceSettings } from "./settings-service";

const suffix = randomUUID();
const userIds: string[] = [];
const workspaceIds: string[] = [];

async function createUser(label: string) {
  const user = await db.user.create({
    data: {
      name: `Settings ${label}`,
      email: `civ-settings-${label}-${randomUUID()}@example.invalid`,
    },
    select: { id: true, name: true, email: true },
  });
  userIds.push(user.id);
  return user;
}

async function createWorkspace(ownerId: string, label: string) {
  const plan = await db.plan.findUniqueOrThrow({
    where: { code: "BUSINESS" },
    select: { id: true },
  });
  const workspace = await db.workspace.create({
    data: {
      name: `CIV Settings ${label} ${suffix}`,
      type: "BUSINESS",
      memberships: {
        create: { userId: ownerId, role: "OWNER", status: "ACTIVE" },
      },
      subscription: { create: { planId: plan.id, status: "BETA" } },
    },
    select: { id: true, name: true },
  });
  workspaceIds.push(workspace.id);
  return workspace;
}

async function logoFile(color: { r: number; g: number; b: number }) {
  const image = await sharp({
    create: { width: 700, height: 420, channels: 4, background: { ...color, alpha: 0.8 } },
  }).png().toBuffer();
  return new File([image], "workspace-logo.png", { type: "image/png" });
}

test("workspace settings and private logo enforce role and workspace boundaries", async () => {
  const owner = await createUser("owner");
  const admin = await createUser("admin");
  const manager = await createUser("manager");
  const staff = await createUser("staff");
  const outsider = await createUser("outsider");
  const workspace = await createWorkspace(owner.id, "settings");
  await db.membership.createMany({
    data: [
      { userId: admin.id, workspaceId: workspace.id, role: "ADMIN", status: "ACTIVE" },
      { userId: manager.id, workspaceId: workspace.id, role: "MANAGER", status: "ACTIVE" },
      { userId: staff.id, workspaceId: workspace.id, role: "STAFF", status: "ACTIVE" },
    ],
  });

  const values = {
    name: "CIV Settings Updated",
    country: "gh",
    currency: "ghs",
    email: " OFFICE@EXAMPLE.COM ",
    phone: "+233 20 000 0000",
    address: "Accra, Ghana",
    registrationNumber: "REG-001",
    businessTin: "TIN-001",
  };
  const ownerUpdate = await updateWorkspaceSettings({
    actorUserId: owner.id,
    workspaceId: workspace.id,
    values,
  });
  assert.equal(ownerUpdate.changed, true);
  assert.equal(ownerUpdate.workspace.country, "GH");
  assert.equal(ownerUpdate.workspace.currency, "GHS");
  assert.equal(ownerUpdate.workspace.email, "office@example.com");

  const adminUpdate = await updateWorkspaceSettings({
    actorUserId: admin.id,
    workspaceId: workspace.id,
    values: { ...values, name: "Admin-updated workspace" },
  });
  assert.equal(adminUpdate.workspace.name, "Admin-updated workspace");

  for (const actor of [manager, staff, outsider]) {
    await assert.rejects(
      updateWorkspaceSettings({
        actorUserId: actor.id,
        workspaceId: workspace.id,
        values,
      }),
      WorkspaceAuthorizationError,
    );
  }
  await assert.rejects(
    updateWorkspaceSettings({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      values: { ...values, name: " ", country: "GHA" },
    }),
    WorkspaceSettingsValidationError,
  );

  const firstSave = await saveWorkspaceLogo({
    actorUserId: owner.id,
    workspaceId: workspace.id,
    file: await logoFile({ r: 16, g: 42, b: 67 }),
  });
  assert.equal(firstSave.cleanupPending, false);
  const firstLogo = await db.workspaceLogo.findUniqueOrThrow({
    where: { workspaceId: workspace.id },
  });
  assert.match(firstLogo.storageKey, new RegExp(`^workspaces/${workspace.id}/logo/[0-9a-f-]+\\.webp$`));
  assert.equal(firstLogo.mimeType, "image/webp");
  assert.equal(firstLogo.checksum.length, 64);
  assert.equal(await objectExists(firstLogo.storageKey), true);

  await saveWorkspaceLogo({
    actorUserId: admin.id,
    workspaceId: workspace.id,
    file: await logoFile({ r: 37, g: 99, b: 235 }),
  });
  const secondLogo = await db.workspaceLogo.findUniqueOrThrow({
    where: { workspaceId: workspace.id },
  });
  assert.notEqual(secondLogo.storageKey, firstLogo.storageKey);
  assert.equal(await objectExists(firstLogo.storageKey), false);
  assert.equal(await objectExists(secondLogo.storageKey), true);

  await assert.rejects(
    saveWorkspaceLogo({
      actorUserId: outsider.id,
      workspaceId: workspace.id,
      file: await logoFile({ r: 22, g: 163, b: 74 }),
    }),
    WorkspaceAuthorizationError,
  );
  assert.equal(
    (await db.workspaceLogo.findUniqueOrThrow({ where: { workspaceId: workspace.id } })).storageKey,
    secondLogo.storageKey,
  );
  await assert.rejects(
    removeWorkspaceLogo({
      actorUserId: outsider.id,
      workspaceId: workspace.id,
    }),
    WorkspaceAuthorizationError,
  );
  assert.equal(await objectExists(secondLogo.storageKey), true);
  assert.equal(
    (await db.workspaceLogo.findUniqueOrThrow({ where: { workspaceId: workspace.id } })).storageKey,
    secondLogo.storageKey,
  );
  await assert.rejects(
    saveWorkspaceLogo({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      file: new File(["<svg/>"] , "logo.svg", { type: "image/svg+xml" }),
    }),
    PrivateImageValidationError,
  );

  const removal = await removeWorkspaceLogo({
    actorUserId: owner.id,
    workspaceId: workspace.id,
  });
  assert.equal(removal.removed, true);
  assert.equal(await objectExists(secondLogo.storageKey), false);
  assert.equal(await db.workspaceLogo.findUnique({ where: { workspaceId: workspace.id } }), null);

  const actions = await db.auditEvent.findMany({
    where: { workspaceId: workspace.id },
    select: { action: true, metadata: true },
  });
  assert.ok(actions.filter(({ action }) => action === "WORKSPACE_UPDATED").length >= 2);
  assert.equal(actions.filter(({ action }) => action === "WORKSPACE_LOGO_UPDATED").length, 2);
  assert.equal(actions.filter(({ action }) => action === "WORKSPACE_LOGO_REMOVED").length, 1);
  assert.equal(JSON.stringify(actions).includes("storageKey"), false);
});

test("archive, restore, leave, and ownership transfer preserve lifecycle integrity", async () => {
  const owner = await createUser("lifecycle-owner");
  const admin = await createUser("lifecycle-admin");
  const manager = await createUser("lifecycle-manager");
  const suspended = await createUser("lifecycle-suspended");
  const workspace = await createWorkspace(owner.id, "lifecycle");
  const memberships = await Promise.all([
    db.membership.create({
      data: { userId: admin.id, workspaceId: workspace.id, role: "ADMIN", status: "ACTIVE" },
      select: { id: true },
    }),
    db.membership.create({
      data: { userId: manager.id, workspaceId: workspace.id, role: "MANAGER", status: "ACTIVE" },
      select: { id: true },
    }),
    db.membership.create({
      data: { userId: suspended.id, workspaceId: workspace.id, role: "STAFF", status: "SUSPENDED" },
      select: { id: true },
    }),
  ]);
  const subscriptionId = (await db.subscription.findUniqueOrThrow({ where: { workspaceId: workspace.id } })).id;
  const beforeMembershipCount = await db.membership.count({ where: { workspaceId: workspace.id } });

  await assert.rejects(
    archiveWorkspace({ actorUserId: admin.id, workspaceId: workspace.id }),
    WorkspaceLifecycleError,
  );
  await archiveWorkspace({ actorUserId: owner.id, workspaceId: workspace.id });
  assert.ok((await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).archivedAt);
  assert.equal(await db.membership.count({ where: { workspaceId: workspace.id } }), beforeMembershipCount);
  assert.equal((await db.subscription.findUniqueOrThrow({ where: { workspaceId: workspace.id } })).id, subscriptionId);
  await assert.rejects(
    updateWorkspaceSettings({
      actorUserId: admin.id,
      workspaceId: workspace.id,
      values: { name: "Blocked", country: "GH", currency: "GHS", email: null, phone: null, address: null, registrationNumber: null, businessTin: null },
    }),
    WorkspaceAuthorizationError,
  );

  await restoreWorkspace({ actorUserId: owner.id, workspaceId: workspace.id });
  assert.equal((await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })).archivedAt, null);
  await assert.rejects(
    restoreWorkspace({ actorUserId: admin.id, workspaceId: workspace.id }),
    WorkspaceLifecycleError,
  );

  await leaveWorkspace({ actorUserId: manager.id, workspaceId: workspace.id });
  assert.equal((await db.membership.findUniqueOrThrow({ where: { id: memberships[1].id } })).status, "REMOVED");
  await assert.rejects(
    leaveWorkspace({ actorUserId: owner.id, workspaceId: workspace.id }),
    (error) => error instanceof WorkspaceLifecycleError && error.reason === "OWNER_CANNOT_LEAVE",
  );

  await assert.rejects(
    transferWorkspaceOwnership({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      values: { targetMembershipId: memberships[2].id, confirmation: "TRANSFER" },
    }),
    WorkspaceLifecycleError,
  );
  await assert.rejects(
    transferWorkspaceOwnership({
      actorUserId: admin.id,
      workspaceId: workspace.id,
      values: { targetMembershipId: memberships[0].id, confirmation: "TRANSFER" },
    }),
    WorkspaceLifecycleError,
  );
  await transferWorkspaceOwnership({
    actorUserId: owner.id,
    workspaceId: workspace.id,
    values: { targetMembershipId: memberships[0].id, confirmation: "TRANSFER" },
  });
  const roles = await db.membership.findMany({
    where: { workspaceId: workspace.id, userId: { in: [owner.id, admin.id] } },
    select: { userId: true, role: true, status: true },
  });
  assert.deepEqual(
    Object.fromEntries(roles.map(({ userId, role }) => [userId, role])),
    { [owner.id]: "ADMIN", [admin.id]: "OWNER" },
  );
  assert.equal(
    await db.membership.count({ where: { workspaceId: workspace.id, role: "OWNER", status: "ACTIVE" } }),
    1,
  );

  for (const action of [
    "WORKSPACE_ARCHIVED",
    "WORKSPACE_RESTORED",
    "MEMBER_LEFT_WORKSPACE",
    "WORKSPACE_OWNERSHIP_TRANSFERRED",
  ]) {
    assert.equal(await db.auditEvent.count({ where: { workspaceId: workspace.id, action } }), 1);
  }
  assert.equal(workspacePermanentDeletionPolicy.available, false);
  assert.equal(await db.workspace.count({ where: { id: workspace.id } }), 1);
});

test.after(async () => {
  if (workspaceIds.length) {
    const logos = await db.workspaceLogo.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { storageKey: true },
    });
    await Promise.all(logos.map(({ storageKey }) => deleteObject(storageKey).catch(() => undefined)));
    await db.workspaceLogo.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.invitation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.documentFile.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.documentLine.deleteMany({ where: { document: { workspaceId: { in: workspaceIds } } } });
    await db.documentSnapshot.deleteMany({ where: { document: { workspaceId: { in: workspaceIds } } } });
    await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
});
