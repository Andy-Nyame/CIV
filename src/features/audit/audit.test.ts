import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import {
  manageWorkspaceMember,
  OwnerProtectionError,
} from "@/features/authorization/membership-service";
import { changeWorkspacePlan } from "@/features/subscriptions/service";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  renewInvitation,
} from "@/features/team/invitation-service";
import { createWorkspace } from "@/features/workspaces/service";
import { db } from "@/lib/db";

import { listWorkspaceAuditEvents } from "./queries";
import {
  AuditValidationError,
  recordAuditEvent,
  type RecordAuditEventInput,
} from "./service";

test("audit visibility follows the V1 role capability map", () => {
  assert.equal(hasCapability({ role: "OWNER" }, CAPABILITIES.VIEW_AUDIT_LOG), true);
  assert.equal(hasCapability({ role: "ADMIN" }, CAPABILITIES.VIEW_AUDIT_LOG), true);
  assert.equal(hasCapability({ role: "MANAGER" }, CAPABILITIES.VIEW_AUDIT_LOG), false);
  assert.equal(hasCapability({ role: "STAFF" }, CAPABILITIES.VIEW_AUDIT_LOG), false);
});

test("workspace mutations write safe, transactional, isolated audit history", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(label: string) {
    const user = await db.user.create({
      data: {
        name: `Audit ${label}`,
        email: `civ-audit-${label}-${suffix}@example.invalid`,
      },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    return user;
  }

  try {
    const owner = await createUser("owner");
    const invitee = await createUser("invitee");
    const concurrentMember = await createUser("concurrent");
    const outsider = await createUser("outsider");
    const workspace = await createWorkspace({
      userId: owner.id,
      input: { type: "BUSINESS", name: `CIV Audit Test ${suffix}` },
    });
    workspaceIds.push(workspace.id);

    const createdEvent = await db.auditEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: "WORKSPACE_CREATED" },
    });
    assert.equal(createdEvent.actorUserId, owner.id);
    assert.equal(createdEvent.resourceId, workspace.id);
    assert.deepEqual(
      Object.assign({}, createdEvent.metadata),
      {
        actorDisplayName: "Audit owner",
        initialPlan: "FREE",
        workspaceType: "BUSINESS",
      },
    );
    assert.equal("updatedAt" in createdEvent, false);

    await changeWorkspacePlan({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      planCode: "ENTERPRISE",
    });
    const planEvent = await db.auditEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: "WORKSPACE_PLAN_CHANGED" },
    });
    assert.deepEqual(Object.assign({}, planEvent.metadata), {
      actorDisplayName: "Audit owner",
      fromPlan: "FREE",
      toPlan: "ENTERPRISE",
    });

    const cancelledInvitation = await createInvitation({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      input: {
        email: `civ-audit-cancel-${suffix}@example.invalid`,
        role: "STAFF",
      },
    });
    const firstToken = cancelledInvitation.token;
    const renewedInvitation = await renewInvitation({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      invitationId: cancelledInvitation.id,
    });
    assert.notEqual(renewedInvitation.token, firstToken);
    await cancelInvitation({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      invitationId: cancelledInvitation.id,
    });

    const acceptedInvitation = await createInvitation({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      input: { email: invitee.email, role: "STAFF" },
    });
    const acceptedMembership = await acceptInvitation({
      token: acceptedInvitation.token,
      userId: invitee.id,
      userEmail: invitee.email,
    });
    assert.equal(acceptedMembership.status, "ACTIVE");

    await manageWorkspaceMember({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      targetMembershipId: acceptedMembership.id,
      role: "MANAGER",
    });
    await manageWorkspaceMember({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      targetMembershipId: acceptedMembership.id,
      status: "SUSPENDED",
    });
    await manageWorkspaceMember({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      targetMembershipId: acceptedMembership.id,
      status: "ACTIVE",
    });
    await manageWorkspaceMember({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      targetMembershipId: acceptedMembership.id,
      status: "REMOVED",
    });

    const requiredActions = [
      "WORKSPACE_CREATED",
      "WORKSPACE_PLAN_CHANGED",
      "MEMBER_INVITED",
      "INVITATION_RENEWED",
      "INVITATION_CANCELLED",
      "INVITATION_ACCEPTED",
      "MEMBER_ROLE_CHANGED",
      "MEMBER_SUSPENDED",
      "MEMBER_REACTIVATED",
      "MEMBER_REMOVED",
    ];
    const actions = await db.auditEvent.findMany({
      where: { workspaceId: workspace.id },
      select: { action: true },
    });
    for (const action of requiredActions) {
      assert.ok(actions.some((event) => event.action === action), `${action} was not recorded`);
    }

    const ownerMembership = await db.membership.findUniqueOrThrow({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: owner.id },
      },
      select: { id: true },
    });
    const beforeRejectedMutation = await db.auditEvent.count({
      where: { workspaceId: workspace.id },
    });
    await assert.rejects(
      manageWorkspaceMember({
        actorUserId: owner.id,
        workspaceId: workspace.id,
        targetMembershipId: ownerMembership.id,
        status: "REMOVED",
      }),
      OwnerProtectionError,
    );
    assert.equal(
      await db.auditEvent.count({ where: { workspaceId: workspace.id } }),
      beforeRejectedMutation,
    );

    const subscription = await db.subscription.findUniqueOrThrow({
      where: { workspaceId: workspace.id },
      select: { id: true, planId: true },
    });
    const proPlan = await db.plan.findUniqueOrThrow({
      where: { code: "PRO" },
      select: { id: true },
    });
    const invalidAudit = {
      workspaceId: workspace.id,
      actorUserId: owner.id,
      action: "WORKSPACE_PLAN_CHANGED",
      resourceType: "SUBSCRIPTION",
      resourceId: subscription.id,
      metadata: {
        fromPlan: "BUSINESS",
        toPlan: "PRO",
        password: "must-not-be-recorded",
      },
    } as unknown as RecordAuditEventInput<"WORKSPACE_PLAN_CHANGED">;
    await assert.rejects(
      db.$transaction(async (transaction) => {
        await transaction.subscription.update({
          where: { id: subscription.id },
          data: { planId: proPlan.id },
        });
        await recordAuditEvent(transaction, invalidAudit);
      }),
      AuditValidationError,
    );
    assert.equal(
      (await db.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
        select: { planId: true },
      })).planId,
      subscription.planId,
    );

    await assert.rejects(
      db.$transaction((transaction) =>
        recordAuditEvent(transaction, {
          workspaceId: workspace.id,
          actorUserId: outsider.id,
          action: "WORKSPACE_UPDATED",
          resourceType: "WORKSPACE",
          resourceId: workspace.id,
          metadata: { changedFields: ["name"] },
        }),
      ),
      AuditValidationError,
    );

    const concurrentMembership = await db.membership.create({
      data: {
        userId: concurrentMember.id,
        workspaceId: workspace.id,
        role: "STAFF",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    await Promise.all([
      manageWorkspaceMember({
        actorUserId: owner.id,
        workspaceId: workspace.id,
        targetMembershipId: concurrentMembership.id,
        role: "ADMIN",
      }),
      manageWorkspaceMember({
        actorUserId: owner.id,
        workspaceId: workspace.id,
        targetMembershipId: concurrentMembership.id,
        role: "MANAGER",
      }),
    ]);
    assert.equal(
      await db.auditEvent.count({
        where: {
          workspaceId: workspace.id,
          resourceId: concurrentMembership.id,
          action: "MEMBER_ROLE_CHANGED",
        },
      }),
      2,
    );

    const otherWorkspace = await createWorkspace({
      userId: outsider.id,
      input: { type: "INDIVIDUAL", name: `Other Audit Test ${suffix}` },
    });
    workspaceIds.push(otherWorkspace.id);
    const otherEventIds = new Set(
      (await db.auditEvent.findMany({
        where: { workspaceId: otherWorkspace.id },
        select: { id: true },
      })).map(({ id }) => id),
    );

    await db.$transaction(
      async (transaction) => {
        for (let index = 0; index < 25; index += 1) {
          await recordAuditEvent(transaction, {
            workspaceId: workspace.id,
            actorUserId: owner.id,
            action: "WORKSPACE_UPDATED",
            resourceType: "WORKSPACE",
            resourceId: workspace.id,
            metadata: { changedFields: [`testField${index}`] },
          });
        }
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    const pagedIds: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listWorkspaceAuditEvents(workspace.id, cursor);
      assert.ok(page.events.length <= 20);
      pagedIds.push(...page.events.map(({ id }) => id));
      cursor = page.hasMore ? page.nextCursor : null;
    } while (cursor);
    assert.equal(new Set(pagedIds).size, pagedIds.length);
    assert.equal(
      pagedIds.length,
      await db.auditEvent.count({ where: { workspaceId: workspace.id } }),
    );
    assert.ok(pagedIds.every((id) => !otherEventIds.has(id)));

    const serializedEvents = JSON.stringify(
      await db.auditEvent.findMany({ where: { workspaceId: workspace.id } }),
    );
    for (const forbidden of [
      firstToken,
      renewedInvitation.token,
      acceptedInvitation.token,
      createHash("sha256").update(firstToken).digest("hex"),
      "must-not-be-recorded",
      "passwordHash",
      "sessionToken",
      "access_token",
      "refresh_token",
      "R2_SECRET_ACCESS_KEY",
    ]) {
      assert.equal(serializedEvents.includes(forbidden), false);
    }
  } finally {
    if (workspaceIds.length) {
      await db.auditEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.invitation.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.workspaceTrial.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.workspaceDocumentAllowancePeriod.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.subscription.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.membership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) {
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
});
