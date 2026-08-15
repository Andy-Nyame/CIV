import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { createInvitation } from "@/features/team/invitation-service";
import { MemberLimitError } from "@/features/team/errors";
import { db } from "@/lib/db";

import { PlanDowngradeError, PlanValidationError } from "./errors";
import { changeWorkspacePlan } from "./service";

test("subscription capabilities remain Owner-managed and Admin-viewable", () => {
  assert.equal(hasCapability({ role: "OWNER" }, CAPABILITIES.VIEW_SUBSCRIPTION), true);
  assert.equal(hasCapability({ role: "OWNER" }, CAPABILITIES.MANAGE_SUBSCRIPTION), true);
  assert.equal(hasCapability({ role: "ADMIN" }, CAPABILITIES.VIEW_SUBSCRIPTION), true);
  assert.equal(hasCapability({ role: "ADMIN" }, CAPABILITIES.MANAGE_SUBSCRIPTION), false);
  assert.equal(hasCapability({ role: "MANAGER" }, CAPABILITIES.MANAGE_SUBSCRIPTION), false);
  assert.equal(hasCapability({ role: "STAFF" }, CAPABILITIES.MANAGE_SUBSCRIPTION), false);
});

test("beta plan switching, downgrade safety, isolation, and invitation limits", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(label: string) {
    const user = await db.user.create({
      data: { email: `civ-plan-${label}-${suffix}@example.invalid`, name: label },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    return user;
  }

  async function createWorkspace(
    label: string,
    ownerId: string,
    planCode: string,
  ) {
    const plan = await db.plan.findUniqueOrThrow({
      where: { code: planCode },
      select: { id: true },
    });
    const workspace = await db.workspace.create({
      data: {
        name: `CIV Plan Test ${label}`,
        type: "BUSINESS",
        memberships: {
          create: { userId: ownerId, role: "OWNER", status: "ACTIVE" },
        },
        subscription: {
          create: { planId: plan.id, status: "BETA" },
        },
      },
      select: { id: true },
    });
    workspaceIds.push(workspace.id);
    return workspace;
  }

  function tokenHash(label: string) {
    return createHash("sha256").update(`${label}-${suffix}`).digest("hex");
  }

  try {
    const seededPlans = await db.plan.findMany({
      where: { code: { in: ["FREE", "STARTER", "BUSINESS", "PRO", "ENTERPRISE"] } },
      select: { code: true, memberLimit: true, documentLimit: true, betaPrice: true },
    });
    assert.equal(seededPlans.length, 5);
    assert.ok(seededPlans.every((plan) => plan.betaPrice.toString() === "0"));
    assert.deepEqual(
      Object.fromEntries(
        seededPlans.map((plan) => [plan.code, [plan.memberLimit, plan.documentLimit]]),
      ),
      {
        FREE: [1, 50],
        STARTER: [3, 500],
        BUSINESS: [10, 5000],
        PRO: [30, 25000],
        ENTERPRISE: [null, null],
      },
    );

    const owner = await createUser("owner");
    const flowWorkspace = await createWorkspace("Flow", owner.id, "FREE");
    const initialSubscription = await db.subscription.findUniqueOrThrow({
      where: { workspaceId: flowWorkspace.id },
      select: { id: true },
    });

    await assert.rejects(
      createInvitation({
        actorUserId: owner.id,
        workspaceId: flowWorkspace.id,
        input: { email: `free-invite-${suffix}@example.invalid`, role: "STAFF" },
      }),
      MemberLimitError,
    );

    for (const planCode of ["STARTER", "BUSINESS", "PRO", "ENTERPRISE"] as const) {
      const result = await changeWorkspacePlan({
        actorUserId: owner.id,
        workspaceId: flowWorkspace.id,
        planCode,
      });
      assert.equal(result.plan.code, planCode);
      assert.equal(result.status, "BETA");
      assert.equal(result.id, initialSubscription.id);
      assert.equal(
        await db.subscription.count({ where: { workspaceId: flowWorkspace.id } }),
        1,
      );
    }

    const enterprise = await db.subscription.findUniqueOrThrow({
      where: { workspaceId: flowWorkspace.id },
      select: { plan: { select: { memberLimit: true, documentLimit: true } } },
    });
    assert.equal(enterprise.plan.memberLimit, null);
    assert.equal(enterprise.plan.documentLimit, null);

    await changeWorkspacePlan({
      actorUserId: owner.id,
      workspaceId: flowWorkspace.id,
      planCode: "BUSINESS",
    });
    const invitation = await createInvitation({
      actorUserId: owner.id,
      workspaceId: flowWorkspace.id,
      input: { email: `business-invite-${suffix}@example.invalid`, role: "STAFF" },
    });
    assert.equal(invitation.role, "STAFF");

    const admin = await createUser("admin");
    const manager = await createUser("manager");
    const staff = await createUser("staff");
    const roleWorkspace = await createWorkspace("Roles", owner.id, "PRO");
    await db.membership.createMany({
      data: [
        { userId: admin.id, workspaceId: roleWorkspace.id, role: "ADMIN", status: "ACTIVE" },
        { userId: manager.id, workspaceId: roleWorkspace.id, role: "MANAGER", status: "ACTIVE" },
        { userId: staff.id, workspaceId: roleWorkspace.id, role: "STAFF", status: "ACTIVE" },
      ],
    });

    for (const actor of [admin, manager, staff]) {
      await assert.rejects(
        changeWorkspacePlan({
          actorUserId: actor.id,
          workspaceId: roleWorkspace.id,
          planCode: "ENTERPRISE",
        }),
        WorkspaceAuthorizationError,
      );
    }
    await assert.rejects(
      changeWorkspacePlan({
        actorUserId: owner.id,
        workspaceId: roleWorkspace.id,
        planCode: "UNKNOWN",
      }),
      PlanValidationError,
    );
    const outsider = await createUser("outsider");
    await assert.rejects(
      changeWorkspacePlan({
        actorUserId: outsider.id,
        workspaceId: roleWorkspace.id,
        planCode: "ENTERPRISE",
      }),
      WorkspaceAuthorizationError,
    );

    const memberOwner = await createUser("member-owner");
    const memberUser = await createUser("member-user");
    const memberWorkspace = await createWorkspace("Members", memberOwner.id, "BUSINESS");
    await db.membership.create({
      data: {
        userId: memberUser.id,
        workspaceId: memberWorkspace.id,
        role: "STAFF",
        status: "ACTIVE",
      },
    });
    await assert.rejects(
      changeWorkspacePlan({
        actorUserId: memberOwner.id,
        workspaceId: memberWorkspace.id,
        planCode: "FREE",
      }),
      (error) => error instanceof PlanDowngradeError && error.reason === "MEMBERS",
    );
    assert.equal(
      await db.membership.count({ where: { workspaceId: memberWorkspace.id } }),
      2,
    );

    const pendingOwner = await createUser("pending-owner");
    const pendingWorkspace = await createWorkspace("Pending", pendingOwner.id, "BUSINESS");
    await db.invitation.createMany({
      data: [0, 1, 2].map((index) => ({
        workspaceId: pendingWorkspace.id,
        email: `pending-${index}-${suffix}@example.invalid`,
        tokenHash: tokenHash(`pending-${index}`),
        role: "STAFF" as const,
        status: "PENDING" as const,
        invitedByUserId: pendingOwner.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })),
    });
    await assert.rejects(
      changeWorkspacePlan({
        actorUserId: pendingOwner.id,
        workspaceId: pendingWorkspace.id,
        planCode: "STARTER",
      }),
      (error) => error instanceof PlanDowngradeError && error.reason === "MEMBERS",
    );
    assert.equal(
      await db.invitation.count({ where: { workspaceId: pendingWorkspace.id } }),
      3,
    );

    const documentOwner = await createUser("document-owner");
    const documentWorkspace = await createWorkspace("Documents", documentOwner.id, "BUSINESS");
    await db.document.createMany({
      data: [
        ...Array.from({ length: 50 }, () => ({
          workspaceId: documentWorkspace.id,
          createdByUserId: documentOwner.id,
          type: "INVOICE" as const,
          status: "ISSUED" as const,
          issuedAt: new Date(),
        })),
        {
          workspaceId: documentWorkspace.id,
          createdByUserId: documentOwner.id,
          type: "INVOICE" as const,
          status: "VOIDED" as const,
          issuedAt: new Date(),
          voidedAt: new Date(),
        },
        ...Array.from({ length: 3 }, () => ({
          workspaceId: documentWorkspace.id,
          createdByUserId: documentOwner.id,
          type: "INVOICE" as const,
          status: "DRAFT" as const,
        })),
      ],
    });
    await assert.rejects(
      changeWorkspacePlan({
        actorUserId: documentOwner.id,
        workspaceId: documentWorkspace.id,
        planCode: "FREE",
      }),
      (error) => error instanceof PlanDowngradeError && error.reason === "DOCUMENTS",
    );
    assert.equal(
      await db.document.count({ where: { workspaceId: documentWorkspace.id } }),
      54,
    );

    const unlimitedOwner = await createUser("unlimited-owner");
    const unlimitedWorkspace = await createWorkspace("Unlimited", unlimitedOwner.id, "PRO");
    await db.invitation.createMany({
      data: Array.from({ length: 31 }, (_, index) => ({
        workspaceId: unlimitedWorkspace.id,
        email: `unlimited-${index}-${suffix}@example.invalid`,
        tokenHash: tokenHash(`unlimited-${index}`),
        role: "STAFF" as const,
        status: "PENDING" as const,
        invitedByUserId: unlimitedOwner.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })),
    });
    const unlimited = await changeWorkspacePlan({
      actorUserId: unlimitedOwner.id,
      workspaceId: unlimitedWorkspace.id,
      planCode: "ENTERPRISE",
    });
    assert.equal(unlimited.plan.memberLimit, null);
    await createInvitation({
      actorUserId: unlimitedOwner.id,
      workspaceId: unlimitedWorkspace.id,
      input: { email: `unlimited-extra-${suffix}@example.invalid`, role: "STAFF" },
    });
  } finally {
    if (workspaceIds.length > 0) {
      await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.invitation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentFile.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentLine.deleteMany({
        where: { document: { workspaceId: { in: workspaceIds } } },
      });
      await db.documentSnapshot.deleteMany({
        where: { document: { workspaceId: { in: workspaceIds } } },
      });
      await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspaceDocumentAllowancePeriod.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
});
