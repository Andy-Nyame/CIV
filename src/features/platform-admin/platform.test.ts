import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { db } from "@/lib/db";

import { findActivePlatformMembership } from "./authorization";
import {
  getPlatformActivitySummary,
  getPlatformOverview,
  getPlatformStorageAnalytics,
  listPlatformUsers,
  listPlatformWorkspaces,
} from "./queries";

test("platform membership is independent of workspace role and analytics remain safe", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  let workspaceId: string | null = null;

  try {
    const baseline = await getPlatformOverview({
      includeAuthAnalytics: true,
      includeStorageAnalytics: true,
    });
    const businessPlanBaseline =
      baseline.planDistribution.find(({ code }) => code === "BUSINESS")
        ?.workspaces ?? 0;

    const workspaceOwner = await db.user.create({
      data: {
        name: "Platform isolation workspace owner",
        email: `civ-platform-workspace-owner-${suffix}@example.invalid`,
        passwordHash: "$argon2id$test-only-not-a-real-hash",
      },
      select: { id: true },
    });
    userIds.push(workspaceOwner.id);
    const platformAdmin = await db.user.create({
      data: {
        name: "Platform operations administrator",
        email: `civ-platform-admin-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    userIds.push(platformAdmin.id);

    const businessPlan = await db.plan.findUniqueOrThrow({
      where: { code: "BUSINESS" },
      select: { id: true },
    });
    const workspace = await db.workspace.create({
      data: {
        name: `CIV Platform Analytics ${suffix}`,
        type: "BUSINESS",
        memberships: {
          create: {
            userId: workspaceOwner.id,
            role: "OWNER",
            status: "ACTIVE",
          },
        },
        subscription: {
          create: { planId: businessPlan.id, status: "BETA" },
        },
      },
      select: { id: true },
    });
    workspaceId = workspace.id;

    assert.equal(await findActivePlatformMembership(workspaceOwner.id), null);
    await db.platformMembership.create({
      data: {
        userId: platformAdmin.id,
        role: "PLATFORM_ADMIN",
        status: "ACTIVE",
      },
    });
    assert.equal(
      (await findActivePlatformMembership(platformAdmin.id))?.role,
      "PLATFORM_ADMIN",
    );
    await db.platformMembership.update({
      where: { userId: platformAdmin.id },
      data: { status: "SUSPENDED" },
    });
    assert.equal(await findActivePlatformMembership(platformAdmin.id), null);

    await Promise.all([
      db.invitation.create({
        data: {
          workspaceId: workspace.id,
          email: `platform-invite-${suffix}@example.invalid`,
          tokenHash: suffix.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
          role: "STAFF",
          status: "PENDING",
          invitedByUserId: workspaceOwner.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
      db.auditEvent.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: workspaceOwner.id,
          action: "WORKSPACE_CREATED",
          resourceType: "WORKSPACE",
          resourceId: workspace.id,
          metadata: { workspaceType: "BUSINESS" },
        },
      }),
      db.profilePhoto.create({
        data: {
          userId: workspaceOwner.id,
          storageKey: `test/platform/${suffix}/profile.webp`,
          mimeType: "image/webp",
          width: 100,
          height: 100,
          sizeBytes: 101,
          checksum: "a".repeat(64),
        },
      }),
      db.signatureProfile.create({
        data: {
          userId: workspaceOwner.id,
          storageKey: `test/platform/${suffix}/signature.png`,
          mimeType: "image/png",
          width: 200,
          height: 80,
          sizeBytes: 202,
          checksum: "b".repeat(64),
        },
      }),
      db.workspaceLogo.create({
        data: {
          workspaceId: workspace.id,
          storageKey: `test/platform/${suffix}/logo.webp`,
          mimeType: "image/webp",
          width: 300,
          height: 180,
          sizeBytes: 303,
          checksum: "c".repeat(64),
        },
      }),
    ]);

    const overview = await getPlatformOverview({
      includeAuthAnalytics: true,
      includeStorageAnalytics: true,
    });
    assert.equal(overview.totalUsers, baseline.totalUsers + 2);
    assert.equal(overview.totalWorkspaces, baseline.totalWorkspaces + 1);
    assert.equal(overview.activeWorkspaces, baseline.activeWorkspaces + 1);
    assert.equal(overview.totalMemberships, baseline.totalMemberships + 1);
    assert.equal(overview.pendingInvitations, baseline.pendingInvitations + 1);
    assert.equal(overview.totalAuditEvents, baseline.totalAuditEvents + 1);
    assert.equal(overview.storage?.total, (baseline.storage?.total ?? 0) + 3);
    assert.equal(
      overview.planDistribution.find(({ code }) => code === "BUSINESS")
        ?.workspaces,
      businessPlanBaseline + 1,
    );

    const storage = await getPlatformStorageAnalytics();
    assert.equal(storage.totalSizeBytes >= 606, true);

    const users = await listPlatformUsers();
    const listedUser = users.find(({ id }) => id === workspaceOwner.id);
    assert.ok(listedUser);
    assert.equal(listedUser.hasPassword, true);
    assert.equal(listedUser.workspaceMemberships, 1);
    const usersPayload = JSON.stringify(users);
    assert.equal(usersPayload.includes("passwordHash"), false);
    assert.equal(usersPayload.includes("access_token"), false);
    assert.equal(usersPayload.includes("refresh_token"), false);

    const workspaces = await listPlatformWorkspaces();
    const listedWorkspace = workspaces.find(({ id }) => id === workspace.id);
    assert.ok(listedWorkspace);
    assert.equal(listedWorkspace.subscription?.plan.code, "BUSINESS");
    assert.equal(listedWorkspace._count.memberships, 1);
    assert.equal(listedWorkspace._count.invitations, 1);
    assert.equal(JSON.stringify(workspaces).includes("storageKey"), false);

    const activity = await getPlatformActivitySummary();
    const testEvent = activity.recentEvents.find(
      ({ id }) => id && workspaceId && id.length > 0,
    );
    assert.ok(testEvent);
    const activityPayload = JSON.stringify(activity);
    assert.equal(activityPayload.includes("metadata"), false);
    assert.equal(activityPayload.includes("actorUserId"), false);
    assert.equal(activityPayload.includes("resourceId"), false);
  } finally {
    if (workspaceId) {
      await db.$transaction([
        db.workspaceLogo.deleteMany({ where: { workspaceId } }),
        db.auditEvent.deleteMany({ where: { workspaceId } }),
        db.invitation.deleteMany({ where: { workspaceId } }),
        db.subscription.deleteMany({ where: { workspaceId } }),
        db.membership.deleteMany({ where: { workspaceId } }),
        db.workspace.deleteMany({ where: { id: workspaceId } }),
      ]);
    }
    await db.profilePhoto.deleteMany({ where: { userId: { in: userIds } } });
    await db.signatureProfile.deleteMany({ where: { userId: { in: userIds } } });
    await db.platformMembership.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
