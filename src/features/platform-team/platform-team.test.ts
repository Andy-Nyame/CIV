import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { findActivePlatformMembership } from "@/features/platform-admin/authorization";
import { db } from "@/lib/db";

import {
  PlatformInvitationConflictError,
  PlatformInvitationUnavailableError,
  PlatformOwnerProtectionError,
  PlatformTeamAuthorizationError,
  PlatformTeamValidationError,
} from "./errors";
import {
  acceptPlatformInvitation,
  cancelPlatformInvitation,
  createPlatformInvitation,
  getPlatformInvitationByToken,
  renewPlatformInvitation,
} from "./invitation-service";
import { managePlatformMember } from "./membership-service";
import { hashPlatformInvitationToken } from "./token";

test("platform recruitment, management, audit, and workspace isolation remain transactional", async () => {
  const suffix = randomUUID();
  const createdUserIds: string[] = [];
  const platformResourceIds: string[] = [];
  let workspaceId: string | null = null;

  const owner = await db.platformMembership.findFirstOrThrow({
    where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    select: { userId: true },
  });

  const createUser = async (label: string) => {
    const user = await db.user.create({
      data: {
        name: `Platform test ${label}`,
        email: `civ-platform-team-${label}-${suffix}@example.invalid`,
      },
      select: { id: true, email: true },
    });
    createdUserIds.push(user.id);
    return user as { id: string; email: string };
  };

  try {
    const admin = await createUser("admin");
    const analyst = await createUser("analyst");
    const support = await createUser("support");
    const wrongAccount = await createUser("wrong-account");
    const workspaceOnly = await createUser("workspace-only");

    const adminMembership = await db.platformMembership.create({
      data: { userId: admin.id, role: "PLATFORM_ADMIN", status: "ACTIVE" },
      select: { id: true },
    });
    platformResourceIds.push(adminMembership.id);
    const analystMembership = await db.platformMembership.create({
      data: { userId: analyst.id, role: "ANALYST", status: "ACTIVE" },
      select: { id: true },
    });
    platformResourceIds.push(analystMembership.id);

    const freePlan = await db.plan.findUniqueOrThrow({
      where: { code: "FREE" },
      select: { id: true },
    });
    const workspace = await db.workspace.create({
      data: {
        name: `Platform separation ${suffix}`,
        type: "INDIVIDUAL",
        memberships: {
          create: { userId: workspaceOnly.id, role: "OWNER", status: "ACTIVE" },
        },
        subscription: { create: { planId: freePlan.id, status: "BETA" } },
      },
      select: { id: true },
    });
    workspaceId = workspace.id;

    await assert.rejects(
      createPlatformInvitation({
        actorUserId: analyst.id,
        invitation: { email: support.email, role: "SUPPORT" },
      }),
      PlatformTeamAuthorizationError,
    );
    await assert.rejects(
      createPlatformInvitation({
        actorUserId: owner.userId,
        invitation: { email: support.email, role: "PLATFORM_OWNER" },
      }),
      PlatformTeamValidationError,
    );
    await assert.rejects(
      createPlatformInvitation({
        actorUserId: owner.userId,
        invitation: { email: "not-an-email", role: "SUPPORT" },
      }),
      PlatformTeamValidationError,
    );

    const invitation = await createPlatformInvitation({
      actorUserId: admin.id,
      invitation: { email: support.email, role: "SUPPORT" },
    });
    platformResourceIds.push(invitation.id);
    assert.equal(
      (await getPlatformInvitationByToken(invitation.token))?.role,
      "SUPPORT",
    );
    const storedInvitation = await db.platformInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
      select: { tokenHash: true, createdAt: true, expiresAt: true },
    });
    assert.equal(storedInvitation.tokenHash, hashPlatformInvitationToken(invitation.token));
    assert.notEqual(storedInvitation.tokenHash, invitation.token);
    const invitationLifetime =
      storedInvitation.expiresAt.getTime() - storedInvitation.createdAt.getTime();
    assert.ok(invitationLifetime <= 7 * 24 * 60 * 60 * 1000);
    assert.ok(invitationLifetime >= 7 * 24 * 60 * 60 * 1000 - 10_000);
    await assert.rejects(
      createPlatformInvitation({
        actorUserId: owner.userId,
        invitation: { email: support.email, role: "FINANCE" },
      }),
      PlatformInvitationConflictError,
    );

    await assert.rejects(
      acceptPlatformInvitation({
        token: invitation.token,
        userId: wrongAccount.id,
        userEmail: wrongAccount.email,
      }),
      (error: unknown) =>
        error instanceof PlatformInvitationUnavailableError &&
        error.reason === "EMAIL_MISMATCH",
    );

    const renewed = await renewPlatformInvitation({
      actorUserId: admin.id,
      invitationId: invitation.id,
    });
    assert.equal(await getPlatformInvitationByToken(invitation.token), null);
    assert.equal((await getPlatformInvitationByToken(renewed.token))?.status, "PENDING");

    const acceptanceResults = await Promise.allSettled([
      acceptPlatformInvitation({
        token: renewed.token,
        userId: support.id,
        userEmail: support.email,
      }),
      acceptPlatformInvitation({
        token: renewed.token,
        userId: support.id,
        userEmail: support.email,
      }),
    ]);
    assert.equal(acceptanceResults.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(acceptanceResults.filter(({ status }) => status === "rejected").length, 1);
    const supportMembership = await db.platformMembership.findUniqueOrThrow({
      where: { userId: support.id },
      select: { id: true, role: true, status: true },
    });
    platformResourceIds.push(supportMembership.id);
    assert.deepEqual(
      { role: supportMembership.role, status: supportMembership.status },
      { role: "SUPPORT", status: "ACTIVE" },
    );

    await managePlatformMember({
      actorUserId: admin.id,
      targetMembershipId: supportMembership.id,
      role: "ANALYST",
    });
    await assert.rejects(
      managePlatformMember({
        actorUserId: analyst.id,
        targetMembershipId: supportMembership.id,
        role: "FINANCE",
      }),
      PlatformTeamAuthorizationError,
    );
    await assert.rejects(
      managePlatformMember({
        actorUserId: admin.id,
        targetMembershipId: adminMembership.id,
        status: "SUSPENDED",
      }),
      PlatformTeamAuthorizationError,
    );
    const ownerMembership = await db.platformMembership.findUniqueOrThrow({
      where: { userId: owner.userId },
      select: { id: true },
    });
    await assert.rejects(
      managePlatformMember({
        actorUserId: owner.userId,
        targetMembershipId: ownerMembership.id,
        status: "SUSPENDED",
      }),
      PlatformOwnerProtectionError,
    );

    await managePlatformMember({
      actorUserId: owner.userId,
      targetMembershipId: supportMembership.id,
      status: "SUSPENDED",
    });
    assert.equal(await findActivePlatformMembership(support.id), null);
    await managePlatformMember({
      actorUserId: owner.userId,
      targetMembershipId: supportMembership.id,
      status: "ACTIVE",
    });
    assert.equal((await findActivePlatformMembership(support.id))?.status, "ACTIVE");
    await managePlatformMember({
      actorUserId: owner.userId,
      targetMembershipId: supportMembership.id,
      status: "REMOVED",
    });
    assert.equal(await findActivePlatformMembership(support.id), null);
    assert.ok(await db.user.findUnique({ where: { id: support.id } }));

    assert.equal(await findActivePlatformMembership(workspaceOnly.id), null);
    assert.equal(
      await db.membership.count({
        where: { userId: workspaceOnly.id, workspaceId: workspace.id, status: "ACTIVE" },
      }),
      1,
    );

    const cancelInvitee = await createUser("cancelled");
    const cancelled = await createPlatformInvitation({
      actorUserId: owner.userId,
      invitation: { email: cancelInvitee.email, role: "FINANCE" },
    });
    platformResourceIds.push(cancelled.id);
    await cancelPlatformInvitation({
      actorUserId: owner.userId,
      invitationId: cancelled.id,
    });
    await assert.rejects(
      acceptPlatformInvitation({
        token: cancelled.token,
        userId: cancelInvitee.id,
        userEmail: cancelInvitee.email,
      }),
      PlatformInvitationUnavailableError,
    );

    const expiredInvitee = await createUser("expired");
    const expired = await createPlatformInvitation({
      actorUserId: owner.userId,
      invitation: { email: expiredInvitee.email, role: "ANALYST" },
    });
    platformResourceIds.push(expired.id);
    await db.platformInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await assert.rejects(
      acceptPlatformInvitation({
        token: expired.token,
        userId: expiredInvitee.id,
        userEmail: expiredInvitee.email,
      }),
      PlatformInvitationUnavailableError,
    );

    const auditEvents = await db.platformAuditEvent.findMany({
      where: {
        OR: [
          { actorUserId: { in: [owner.userId, admin.id, support.id] } },
          { resourceId: { in: [invitation.id, supportMembership.id] } },
        ],
      },
      select: { action: true, metadata: true },
    });
    for (const action of [
      "PLATFORM_MEMBER_INVITED",
      "PLATFORM_INVITATION_RENEWED",
      "PLATFORM_INVITATION_ACCEPTED",
      "PLATFORM_MEMBER_ROLE_CHANGED",
      "PLATFORM_MEMBER_SUSPENDED",
      "PLATFORM_MEMBER_REACTIVATED",
      "PLATFORM_MEMBER_REMOVED",
      "PLATFORM_INVITATION_CANCELLED",
    ]) {
      assert.equal(auditEvents.some((event) => event.action === action), true, action);
    }
    const auditPayload = JSON.stringify(auditEvents);
    assert.equal(auditPayload.includes(invitation.token), false);
    assert.equal(auditPayload.includes(storedInvitation.tokenHash), false);
    assert.equal(/passwordHash|access_token|refresh_token|R2_SECRET/.test(auditPayload), false);

    assert.equal(
      await db.platformMembership.count({
        where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
      }),
      1,
    );
    assert.ok(analystMembership.id);
  } finally {
    await db.platformAuditEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: createdUserIds } },
          { actorDisplayName: { startsWith: "Platform test" } },
          { resourceId: { in: platformResourceIds } },
        ],
      },
    });
    await db.platformInvitation.deleteMany({
      where: {
        OR: [
          { invitedByUserId: { in: createdUserIds } },
          { email: { contains: suffix } },
        ],
      },
    });
    await db.platformMembership.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    if (workspaceId) {
      await db.subscription.deleteMany({ where: { workspaceId } });
      await db.membership.deleteMany({ where: { workspaceId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    }
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
});
