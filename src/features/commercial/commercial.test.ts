import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { changeWorkspacePlan } from "@/features/subscriptions/service";
import { db } from "@/lib/db";

import { acquireBetaDocumentCredits } from "./acquisition";
import {
  CIV_DEFAULT_TRIAL_CONFIGURATION,
  CIV_DOCUMENT_CREDIT_PACK_CATALOG,
  CIV_PLAN_CATALOG,
} from "./catalog";
import {
  consumeDocumentCapacity,
  getDocumentCapacityAvailability,
} from "./capacity";
import {
  CommercialAuthorizationError,
  CommercialValidationError,
  CreditAcquisitionUnavailableError,
  DocumentCapacityConsumptionConflictError,
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

test("approved CIV plans, credit packs, mappings, and trial defaults are finalized", async () => {
  const [plans, packs, trial] = await Promise.all([
    db.plan.findMany({
      where: { code: { in: CIV_PLAN_CATALOG.map(({ code }) => code) } },
      select: {
        code: true,
        memberLimit: true,
        documentLimit: true,
        monthlyPrice: true,
        currency: true,
        billingMode: true,
        paystackPlanCode: true,
        isActive: true,
        isPublic: true,
        isAvailableForNewWorkspaces: true,
      },
    }),
    db.documentCreditPack.findMany({
      where: {
        code: {
          in: CIV_DOCUMENT_CREDIT_PACK_CATALOG.map(({ code }) => code),
        },
      },
      select: {
        code: true,
        creditAmount: true,
        price: true,
        currency: true,
        isActive: true,
        isPublic: true,
      },
    }),
    db.trialConfiguration.findUnique({
      where: { id: "GLOBAL" },
      select: {
        enabled: true,
        durationDays: true,
        newWorkspacesOnly: true,
        oneTrialPerWorkspace: true,
        paymentMethodRequired: true,
        allowManualGrant: true,
        trialPlan: { select: { code: true } },
        fallbackPlan: { select: { code: true } },
      },
    }),
  ]);

  assert.equal(plans.length, CIV_PLAN_CATALOG.length);
  for (const expected of CIV_PLAN_CATALOG) {
    const actual = plans.find(({ code }) => code === expected.code);
    assert.ok(actual, expected.code);
    assert.deepEqual(
      {
        memberLimit: actual.memberLimit,
        documentLimit: actual.documentLimit,
        monthlyPrice: actual.monthlyPrice.toFixed(4),
        currency: actual.currency,
        billingMode: actual.billingMode,
        isActive: actual.isActive,
        isPublic: actual.isPublic,
        isAvailableForNewWorkspaces: actual.isAvailableForNewWorkspaces,
      },
      {
        memberLimit: expected.memberLimit,
        documentLimit: expected.documentLimit,
        monthlyPrice: expected.monthlyPrice,
        currency: expected.currency,
        billingMode: expected.billingMode,
        isActive: expected.isActive,
        isPublic: expected.isPublic,
        isAvailableForNewWorkspaces:
          expected.isAvailableForNewWorkspaces,
      },
    );
    assert.equal(
      actual.paystackPlanCode !== null,
      expected.billingMode === "RECURRING",
      `${expected.code} provider mapping`,
    );
  }

  assert.equal(packs.length, CIV_DOCUMENT_CREDIT_PACK_CATALOG.length);
  for (const expected of CIV_DOCUMENT_CREDIT_PACK_CATALOG) {
    const actual = packs.find(({ code }) => code === expected.code);
    assert.ok(actual, expected.code);
    assert.deepEqual(
      {
        creditAmount: actual.creditAmount,
        price: actual.price.toFixed(4),
        currency: actual.currency,
        isActive: actual.isActive,
        isPublic: actual.isPublic,
      },
      {
        creditAmount: expected.creditAmount,
        price: expected.price,
        currency: expected.currency,
        isActive: expected.isActive,
        isPublic: expected.isPublic,
      },
    );
  }

  assert.deepEqual(trial, {
    enabled: CIV_DEFAULT_TRIAL_CONFIGURATION.enabled,
    durationDays: CIV_DEFAULT_TRIAL_CONFIGURATION.durationDays,
    newWorkspacesOnly: CIV_DEFAULT_TRIAL_CONFIGURATION.newWorkspacesOnly,
    oneTrialPerWorkspace:
      CIV_DEFAULT_TRIAL_CONFIGURATION.oneTrialPerWorkspace,
    paymentMethodRequired:
      CIV_DEFAULT_TRIAL_CONFIGURATION.paymentMethodRequired,
    allowManualGrant: CIV_DEFAULT_TRIAL_CONFIGURATION.allowManualGrant,
    trialPlan: { code: CIV_DEFAULT_TRIAL_CONFIGURATION.trialPlanCode },
    fallbackPlan: { code: CIV_DEFAULT_TRIAL_CONFIGURATION.fallbackPlanCode },
  });
});

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

    const availability = await getDocumentCapacityAvailability(workspace.id, 7);
    assert.equal(availability.canConsume, true);
    assert.equal(availability.totalAvailable, 7);
    assert.deepEqual(availability.consumptionOrder, [
      "MONTHLY_ALLOWANCE",
      "PURCHASED_CREDITS",
    ]);
    assert.equal(
      (await getDocumentCapacityAvailability(workspace.id, 8)).canConsume,
      false,
    );

    const firstSourceReference = `commercial-first-${suffix}`;
    const firstConsumption = await consumeDocumentCapacity({
      workspaceId: workspace.id,
      amount: 3,
      sourceReference: firstSourceReference,
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
    assert.equal(firstConsumption.idempotent, false);
    const repeatedConsumption = await consumeDocumentCapacity({
      workspaceId: workspace.id,
      amount: 3,
      sourceReference: firstSourceReference,
      actorUserId: workspaceOwner.id,
    });
    assert.equal(repeatedConsumption.idempotent, true);
    assert.equal(repeatedConsumption.consumptionId, firstConsumption.consumptionId);
    await assert.rejects(
      consumeDocumentCapacity({
        workspaceId: workspace.id,
        amount: 2,
        sourceReference: firstSourceReference,
        actorUserId: workspaceOwner.id,
      }),
      DocumentCapacityConsumptionConflictError,
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
    const duplicateSourceReference = `commercial-idempotent-${suffix}`;
    const duplicateConsumption = await Promise.all([
      consumeDocumentCapacity({
        workspaceId: workspace.id,
        amount: 1,
        sourceReference: duplicateSourceReference,
        actorUserId: workspaceOwner.id,
      }),
      consumeDocumentCapacity({
        workspaceId: workspace.id,
        amount: 1,
        sourceReference: duplicateSourceReference,
        actorUserId: workspaceOwner.id,
      }),
    ]);
    assert.equal(
      duplicateConsumption.filter(({ idempotent }) => !idempotent).length,
      1,
    );
    assert.equal(
      await db.documentCapacityConsumption.count({
        where: { sourceReference: duplicateSourceReference },
      }),
      1,
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
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 0);

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
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 0);

    await db.membership.delete({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: staff.id,
        },
      },
    });
    await changeWorkspacePlan({
      actorUserId: workspaceOwner.id,
      workspaceId: workspace.id,
      planCode: "FREE",
    });
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 0);

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
      await db.documentCapacityConsumption.deleteMany({
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
