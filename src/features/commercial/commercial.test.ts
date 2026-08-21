import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { changeWorkspacePlan } from "@/features/subscriptions/service";
import { db } from "@/lib/db";

import { acquireBetaDocumentCredits } from "./acquisition";
import { consumeDocumentCapacity } from "./capacity";
import {
  CommercialAuthorizationError,
  CommercialValidationError,
  CreditAcquisitionUnavailableError,
  InsufficientDocumentCapacityError,
} from "./errors";
import { getPurchasedCreditBalance } from "./ledger";
import { commercialTransactionOptions } from "./locking";
import { addUtcMonth, ensureCurrentAllowancePeriod } from "./periods";
import {
  createDocumentCreditPack,
  updateDocumentCreditPack,
  updatePlanConfiguration,
} from "./platform-service";

test("commercial plans, credit packs, allowance periods, and ledger remain authoritative and concurrent-safe", async () => {
  const suffix = randomUUID();
  const startedAt = new Date();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const packIds: string[] = [];
  const owner = await db.platformMembership.findFirstOrThrow({
    where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    select: { userId: true },
  });
  const originalStarter = await db.plan.findUniqueOrThrow({
    where: { code: "STARTER" },
  });

  async function createUser(label: string) {
    const user = await db.user.create({
      data: {
        name: `Commercial test ${label}`,
        email: `civ-commercial-${label}-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user;
  }

  async function createWorkspace(
    label: string,
    ownerId: string,
    planCode: "STARTER" | "BUSINESS" | "ENTERPRISE",
    allowanceOverride?: number | null,
  ) {
    const plan = await db.plan.findUniqueOrThrow({
      where: { code: planCode },
      select: { id: true, documentLimit: true },
    });
    const periodStart = new Date(Date.now() - 60_000);
    const workspace = await db.workspace.create({
      data: {
        name: `Commercial ${label} ${suffix}`,
        type: "BUSINESS",
        memberships: {
          create: { userId: ownerId, role: "OWNER", status: "ACTIVE" },
        },
        subscription: { create: { planId: plan.id, status: "BETA" } },
        documentAllowancePeriods: {
          create: {
            planId: plan.id,
            periodStart,
            periodEnd: addUtcMonth(periodStart),
            allowance:
              allowanceOverride === undefined
                ? plan.documentLimit
                : allowanceOverride,
          },
        },
      },
      select: { id: true },
    });
    workspaceIds.push(workspace.id);
    return workspace;
  }

  let testPackId: string | null = null;
  try {
    const platformAdmin = await createUser("platform-admin");
    await db.platformMembership.create({
      data: {
        userId: platformAdmin.id,
        role: "PLATFORM_ADMIN",
        status: "ACTIVE",
      },
    });
    await assert.rejects(
      updatePlanConfiguration({
        actorUserId: platformAdmin.id,
        configuration: {
          code: "STARTER",
          name: originalStarter.name,
          description: originalStarter.description ?? "",
          memberLimit: originalStarter.memberLimit,
          documentLimit: originalStarter.documentLimit,
          betaPrice: originalStarter.betaPrice.toFixed(4),
          currency: originalStarter.currency,
          isActive: originalStarter.isActive,
          isPublic: originalStarter.isPublic,
          isAvailableForNewWorkspaces:
            originalStarter.isAvailableForNewWorkspaces,
          sortOrder: originalStarter.sortOrder,
        },
      }),
      CommercialAuthorizationError,
    );

    const workspaceOwner = await createUser("workspace-owner");
    const staff = await createUser("staff");
    const workspace = await createWorkspace(
      "capacity",
      workspaceOwner.id,
      "STARTER",
      2,
    );
    await db.membership.create({
      data: {
        workspaceId: workspace.id,
        userId: staff.id,
        role: "STAFF",
        status: "ACTIVE",
      },
    });

    const planUpdate = await updatePlanConfiguration({
      actorUserId: owner.userId,
      configuration: {
        code: "STARTER",
        name: `${originalStarter.name} Test`,
        description: originalStarter.description ?? "",
        memberLimit: 1,
        documentLimit: 2,
        betaPrice: originalStarter.betaPrice.toFixed(4),
        currency: originalStarter.currency,
        isActive: true,
        isPublic: true,
        isAvailableForNewWorkspaces: true,
        sortOrder: originalStarter.sortOrder,
      },
    });
    assert.ok(planUpdate.changedFields.includes("name"));
    assert.equal(
      await db.membership.count({ where: { workspaceId: workspace.id } }),
      2,
    );
    assert.equal(
      await db.subscription.count({ where: { workspaceId: workspace.id } }),
      1,
    );
    await assert.rejects(
      updatePlanConfiguration({
        actorUserId: owner.userId,
        configuration: {
          code: "NOT_A_PLAN",
          name: "Invalid",
          description: "",
          memberLimit: 1,
          documentLimit: 1,
          betaPrice: "0",
          currency: "GHS",
          isActive: true,
          isPublic: true,
          isAvailableForNewWorkspaces: true,
          sortOrder: 1,
        },
      }),
      CommercialValidationError,
    );

    const pack = await createDocumentCreditPack({
      actorUserId: owner.userId,
      configuration: {
        code: `TEST_${suffix.replaceAll("-", "").slice(0, 20).toUpperCase()}`,
        name: "Commercial Test Pack",
        description: "Temporary integration pack",
        creditAmount: 5,
        price: "0.0000",
        currency: "GHS",
        isActive: false,
        isPublic: false,
        sortOrder: 9999,
      },
    });
    testPackId = pack.id;
    packIds.push(pack.id);
    await assert.rejects(
      acquireBetaDocumentCredits({
        actorUserId: workspaceOwner.id,
        workspaceId: workspace.id,
        packCode: pack.code,
      }),
      CreditAcquisitionUnavailableError,
    );
    await updateDocumentCreditPack({
      actorUserId: owner.userId,
      configuration: {
        id: pack.id,
        code: pack.code,
        name: pack.name,
        description: pack.description ?? "",
        creditAmount: 5,
        price: "0.0000",
        currency: "GHS",
        isActive: true,
        isPublic: true,
        sortOrder: 9999,
      },
    });

    await assert.rejects(
      acquireBetaDocumentCredits({
        actorUserId: staff.id,
        workspaceId: workspace.id,
        packCode: pack.code,
      }),
      WorkspaceAuthorizationError,
    );
    const acquired = await acquireBetaDocumentCredits({
      actorUserId: workspaceOwner.id,
      workspaceId: workspace.id,
      packCode: pack.code,
    });
    assert.deepEqual(
      { credits: acquired.credits, balance: acquired.balance },
      { credits: 5, balance: 5 },
    );
    const purchase = await db.documentCreditPurchase.findUniqueOrThrow({
      where: { id: acquired.purchaseId },
      include: { ledgerEntry: true },
    });
    assert.equal(purchase.creditAmountSnapshot, 5);
    assert.equal(purchase.priceSnapshot.toString(), "0");
    assert.equal(purchase.status, "COMPLETED");
    assert.equal(purchase.ledgerEntry?.amount, 5);
    assert.equal(purchase.ledgerEntry?.type, "PURCHASE");
    await assert.rejects(
      acquireBetaDocumentCredits({
        actorUserId: workspaceOwner.id,
        workspaceId: workspace.id,
        packCode: pack.code,
      }),
      (error) =>
        error instanceof CreditAcquisitionUnavailableError &&
        error.reason === "ALREADY_ACQUIRED",
    );

    await updateDocumentCreditPack({
      actorUserId: owner.userId,
      configuration: {
        id: pack.id,
        code: pack.code,
        name: "Commercial Test Pack Updated",
        description: "Historical snapshots remain immutable",
        creditAmount: 9,
        price: "0.0000",
        currency: "GHS",
        isActive: true,
        isPublic: true,
        sortOrder: 9998,
      },
    });
    assert.equal(
      (
        await db.documentCreditPurchase.findUniqueOrThrow({
          where: { id: purchase.id },
          select: { creditAmountSnapshot: true },
        })
      ).creditAmountSnapshot,
      5,
    );

    const firstConsumption = await consumeDocumentCapacity({
      workspaceId: workspace.id,
      amount: 3,
      sourceReference: `commercial-first-${suffix}`,
      actorUserId: workspaceOwner.id,
    });
    assert.deepEqual(
      {
        monthlyUsed: firstConsumption.monthlyUsed,
        purchasedUsed: firstConsumption.purchasedUsed,
        purchasedBalance: firstConsumption.purchasedBalance,
      },
      { monthlyUsed: 2, purchasedUsed: 1, purchasedBalance: 4 },
    );
    await assert.rejects(
      consumeDocumentCapacity({
        workspaceId: workspace.id,
        amount: 10,
        sourceReference: `commercial-insufficient-${suffix}`,
        actorUserId: workspaceOwner.id,
      }),
      InsufficientDocumentCapacityError,
    );
    const concurrentConsumption = await Promise.allSettled([
      consumeDocumentCapacity({
        workspaceId: workspace.id,
        amount: 3,
        sourceReference: `commercial-concurrent-a-${suffix}`,
        actorUserId: workspaceOwner.id,
      }),
      consumeDocumentCapacity({
        workspaceId: workspace.id,
        amount: 3,
        sourceReference: `commercial-concurrent-b-${suffix}`,
        actorUserId: workspaceOwner.id,
      }),
    ]);
    assert.equal(
      concurrentConsumption.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 1);

    const currentPeriod = await db.workspaceDocumentAllowancePeriod.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      orderBy: { periodStart: "desc" },
    });
    const future = new Date(currentPeriod.periodEnd.getTime() + 1_000);
    await db.$transaction(async (transaction) => {
      await ensureCurrentAllowancePeriod(transaction, workspace.id, future);
    }, commercialTransactionOptions);
    assert.ok(
      (await db.workspaceDocumentAllowancePeriod.count({
        where: { workspaceId: workspace.id },
      })) >= 2,
    );
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 1);

    await changeWorkspacePlan({
      actorUserId: workspaceOwner.id,
      workspaceId: workspace.id,
      planCode: "ENTERPRISE",
    });
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 1);

    const duplicateOwner = await createUser("duplicate-owner");
    const duplicateWorkspace = await createWorkspace(
      "duplicate",
      duplicateOwner.id,
      "BUSINESS",
    );
    const concurrentAcquisition = await Promise.allSettled([
      acquireBetaDocumentCredits({
        actorUserId: duplicateOwner.id,
        workspaceId: duplicateWorkspace.id,
        packCode: pack.code,
      }),
      acquireBetaDocumentCredits({
        actorUserId: duplicateOwner.id,
        workspaceId: duplicateWorkspace.id,
        packCode: pack.code,
      }),
    ]);
    assert.equal(
      concurrentAcquisition.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    assert.equal(
      await db.documentCreditPurchase.count({
        where: { workspaceId: duplicateWorkspace.id, packId: pack.id },
      }),
      1,
    );

    const enterpriseOwner = await createUser("enterprise-owner");
    const enterpriseWorkspace = await createWorkspace(
      "enterprise",
      enterpriseOwner.id,
      "ENTERPRISE",
    );
    const unlimited = await consumeDocumentCapacity({
      workspaceId: enterpriseWorkspace.id,
      amount: 100,
      sourceReference: `commercial-enterprise-${suffix}`,
      actorUserId: enterpriseOwner.id,
    });
    assert.equal(unlimited.monthlyUsed, 100);
    assert.equal(unlimited.purchasedUsed, 0);

    const workspaceEvents = await db.auditEvent.findMany({
      where: { workspaceId: workspace.id },
      select: { action: true, metadata: true },
    });
    assert.equal(
      workspaceEvents.some(({ action }) => action === "DOCUMENT_CREDITS_ACQUIRED"),
      true,
    );
    assert.doesNotMatch(
      JSON.stringify(workspaceEvents),
      /password|tokenHash|access_token|R2_SECRET/i,
    );
    const platformEvents = await db.platformAuditEvent.findMany({
      where: { resourceId: { in: [originalStarter.id, pack.id] }, createdAt: { gte: startedAt } },
      select: { action: true, metadata: true },
    });
    assert.ok(platformEvents.some(({ action }) => action === "PLATFORM_PLAN_UPDATED"));
    assert.ok(
      platformEvents.some(({ action }) => action === "PLATFORM_CREDIT_PACK_CREATED"),
    );
    assert.ok(
      platformEvents.some(({ action }) => action === "PLATFORM_CREDIT_PACK_UPDATED"),
    );
    assert.ok(
      platformEvents.some(
        ({ action }) => action === "PLATFORM_CREDIT_PACK_ACTIVATED",
      ),
    );
  } finally {
    await db.plan.update({
      where: { id: originalStarter.id },
      data: {
        name: originalStarter.name,
        description: originalStarter.description,
        memberLimit: originalStarter.memberLimit,
        documentLimit: originalStarter.documentLimit,
        betaPrice: originalStarter.betaPrice,
        currency: originalStarter.currency,
        isActive: originalStarter.isActive,
        isPublic: originalStarter.isPublic,
        isAvailableForNewWorkspaces:
          originalStarter.isAvailableForNewWorkspaces,
        sortOrder: originalStarter.sortOrder,
      },
    });
    await db.workspaceDocumentAllowancePeriod.updateMany({
      where: { planId: originalStarter.id },
      data: { allowance: originalStarter.documentLimit },
    });
    if (workspaceIds.length) {
      await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentCreditTransaction.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.documentCreditPurchase.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.workspaceDocumentAllowancePeriod.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    await db.platformAuditEvent.deleteMany({
      where: {
        createdAt: { gte: startedAt },
        OR: [
          { actorUserId: { in: userIds } },
          { resourceId: { in: [originalStarter.id, ...packIds] } },
        ],
      },
    });
    await db.platformMembership.deleteMany({ where: { userId: { in: userIds } } });
    if (testPackId) {
      await db.documentCreditPack.deleteMany({ where: { id: testPackId } });
    }
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
