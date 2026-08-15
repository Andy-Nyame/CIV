import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { addUtcMonth, ensureCurrentAllowancePeriod } from "@/features/commercial/periods";
import {
  TrialAuthorizationError,
  TrialConfigurationError,
  TrialIneligibleError,
  TrialValidationError,
} from "@/features/trials/errors";
import { createWorkspace } from "@/features/workspaces/service";
import { MemberLimitError } from "@/features/team/errors";
import { assertInvitationCapacity } from "@/features/team/limits";
import { db } from "@/lib/db";

import { getWorkspaceEntitlements } from "./entitlements";
import { evaluateTrialEligibility } from "./eligibility";
import { cancelWorkspaceTrial, grantConfiguredTrial, updateTrialConfiguration } from "./service";

test("configurable trials remain explicit, isolated, auditable, and concurrent-safe", async () => {
  const suffix = randomUUID();
  const startedAt = new Date();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const owner = await db.platformMembership.findFirstOrThrow({
    where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    select: { userId: true },
  });
  const originalConfiguration = await db.trialConfiguration.findUniqueOrThrow({
    where: { id: "GLOBAL" },
  });
  const plans = Object.fromEntries(
    (await db.plan.findMany({
      where: { code: { in: ["FREE", "BUSINESS", "PRO"] } },
      select: { id: true, code: true, memberLimit: true, documentLimit: true },
    })).map((plan) => [plan.code, plan]),
  );

  async function createUser(label: string) {
    const user = await db.user.create({
      data: {
        name: `Trial test ${label}`,
        email: `civ-trials-${label}-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user;
  }

  async function createExistingWorkspace(label: string, ownerId: string) {
    const periodStart = new Date(Date.now() - 60_000);
    const workspace = await db.workspace.create({
      data: {
        name: `Trial existing ${label} ${suffix}`,
        type: "BUSINESS",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        memberships: { create: { userId: ownerId, role: "OWNER", status: "ACTIVE" } },
        subscription: { create: { planId: plans.FREE.id, status: "BETA" } },
        documentAllowancePeriods: {
          create: {
            planId: plans.FREE.id,
            periodStart,
            periodEnd: addUtcMonth(periodStart),
            allowance: plans.FREE.documentLimit,
          },
        },
      },
      select: { id: true },
    });
    workspaceIds.push(workspace.id);
    return workspace;
  }

  async function configure(overrides: Record<string, unknown> = {}) {
    return updateTrialConfiguration({
      actorUserId: owner.userId,
      configuration: {
        enabled: true,
        trialPlanCode: "BUSINESS",
        durationDays: 14,
        fallbackPlanCode: "FREE",
        newWorkspacesOnly: true,
        oneTrialPerWorkspace: true,
        paymentMethodRequired: false,
        allowManualGrant: true,
        ...overrides,
      },
    });
  }

  try {
    const platformAdmin = await createUser("platform-admin");
    const analyst = await createUser("analyst");
    await db.platformMembership.createMany({
      data: [
        { userId: platformAdmin.id, role: "PLATFORM_ADMIN", status: "ACTIVE" },
        { userId: analyst.id, role: "ANALYST", status: "ACTIVE" },
      ],
    });
    await assert.rejects(
      updateTrialConfiguration({
        actorUserId: analyst.id,
        configuration: {
          enabled: true,
          trialPlanCode: "BUSINESS",
          durationDays: 14,
          fallbackPlanCode: "FREE",
          newWorkspacesOnly: true,
          oneTrialPerWorkspace: true,
          paymentMethodRequired: false,
          allowManualGrant: true,
        },
      }),
      TrialAuthorizationError,
    );
    await assert.rejects(
      updateTrialConfiguration({
        actorUserId: owner.userId,
        configuration: {
          enabled: true,
          trialPlanCode: "BUSINESS",
          durationDays: 0,
          fallbackPlanCode: "FREE",
          newWorkspacesOnly: true,
          oneTrialPerWorkspace: true,
          paymentMethodRequired: false,
          allowManualGrant: true,
        },
      }),
      TrialValidationError,
    );
    await assert.rejects(
      updateTrialConfiguration({
        actorUserId: owner.userId,
        configuration: {
          enabled: true,
          trialPlanCode: "NOT_A_PLAN",
          durationDays: 14,
          fallbackPlanCode: "FREE",
          newWorkspacesOnly: true,
          oneTrialPerWorkspace: true,
          paymentMethodRequired: false,
          allowManualGrant: true,
        },
      }),
      TrialConfigurationError,
    );
    await assert.rejects(
      updateTrialConfiguration({
        actorUserId: owner.userId,
        configuration: {
          enabled: true,
          trialPlanCode: "FREE",
          durationDays: 14,
          fallbackPlanCode: "FREE",
          newWorkspacesOnly: true,
          oneTrialPerWorkspace: true,
          paymentMethodRequired: false,
          allowManualGrant: true,
        },
      }),
      TrialValidationError,
    );

    await configure();
    const autoOwner = await createUser("auto-owner");
    const autoWorkspace = await createWorkspace({
      userId: autoOwner.id,
      input: { name: `Trial Auto ${suffix}`, type: "BUSINESS" },
    });
    workspaceIds.push(autoWorkspace.id);
    let entitlements = await getWorkspaceEntitlements(autoWorkspace.id);
    assert.equal(entitlements.normalSubscription.plan.code, "FREE");
    assert.equal(entitlements.effectivePlan.code, "BUSINESS");
    assert.equal(entitlements.effectivePlan.source, "TRIAL");
    assert.equal(entitlements.activeTrial?.grantSource, "AUTO_NEW_WORKSPACE");
    assert.equal(entitlements.purchasedCredits, 0);
    assert.equal(
      (await db.workspaceDocumentAllowancePeriod.findFirstOrThrow({
        where: { workspaceId: autoWorkspace.id },
      })).allowance,
      plans.BUSINESS.documentLimit,
    );
    await db.membership.create({
      data: {
        workspaceId: autoWorkspace.id,
        userId: (await createUser("trial-member")).id,
        role: "STAFF",
        status: "ACTIVE",
      },
    });
    await db.$transaction((transaction) =>
      assertInvitationCapacity(transaction, autoWorkspace.id),
    );

    const ineligibleExisting = await createExistingWorkspace(
      "auto-ineligible",
      (await createUser("ineligible-owner")).id,
    );
    const eligibility = await db.$transaction((transaction) =>
      evaluateTrialEligibility(transaction, {
        workspaceId: ineligibleExisting.id,
        source: "AUTO_NEW_WORKSPACE",
      }),
    );
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.reason, "NOT_NEW_WORKSPACE");

    const policyWorkspace = await createExistingWorkspace(
      "policy",
      (await createUser("policy-owner")).id,
    );
    await configure({ allowManualGrant: false });
    await assert.rejects(
      grantConfiguredTrial({ actorUserId: owner.userId, workspaceId: policyWorkspace.id }),
      (error) =>
        error instanceof TrialIneligibleError &&
        error.reason === "MANUAL_GRANTS_DISABLED",
    );
    await configure({ paymentMethodRequired: true });
    await assert.rejects(
      grantConfiguredTrial({ actorUserId: owner.userId, workspaceId: policyWorkspace.id }),
      (error) =>
        error instanceof TrialIneligibleError &&
        error.reason === "PAYMENT_METHOD_REQUIRED",
    );
    await configure();

    const manualOwner = await createUser("manual-owner");
    const manualWorkspace = await createExistingWorkspace("manual", manualOwner.id);
    const manualTrial = await grantConfiguredTrial({
      actorUserId: platformAdmin.id,
      workspaceId: manualWorkspace.id,
    });
    assert.equal(manualTrial.trialPlanCodeSnapshot, "BUSINESS");
    assert.equal(manualTrial.fallbackPlanCodeSnapshot, "FREE");
    await assert.rejects(
      grantConfiguredTrial({
        actorUserId: platformAdmin.id,
        workspaceId: manualWorkspace.id,
      }),
      (error) => error instanceof TrialIneligibleError && error.reason === "ALREADY_ACTIVE",
    );

    await configure({ trialPlanCode: "PRO" });
    entitlements = await getWorkspaceEntitlements(manualWorkspace.id);
    assert.equal(entitlements.effectivePlan.code, "BUSINESS");
    const historicalSnapshot = await db.workspaceTrial.findUniqueOrThrow({
      where: { id: manualTrial.id },
      select: { trialPlanCodeSnapshot: true, trialDocumentLimitSnapshot: true },
    });
    assert.deepEqual(historicalSnapshot, {
      trialPlanCodeSnapshot: "BUSINESS",
      trialDocumentLimitSnapshot: plans.BUSINESS.documentLimit,
    });
    await configure();

    const raceWorkspace = await createExistingWorkspace(
      "race",
      (await createUser("race-owner")).id,
    );
    const race = await Promise.allSettled([
      grantConfiguredTrial({ actorUserId: owner.userId, workspaceId: raceWorkspace.id }),
      grantConfiguredTrial({ actorUserId: platformAdmin.id, workspaceId: raceWorkspace.id }),
    ]);
    assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      await db.workspaceTrial.count({ where: { workspaceId: raceWorkspace.id, status: "ACTIVE" } }),
      1,
    );

    await configure({ enabled: false });
    const disabledOwner = await createUser("disabled-owner");
    const disabledWorkspace = await createWorkspace({
      userId: disabledOwner.id,
      input: { name: `Trial Disabled ${suffix}`, type: "INDIVIDUAL" },
    });
    workspaceIds.push(disabledWorkspace.id);
    assert.equal(await db.workspaceTrial.count({ where: { workspaceId: disabledWorkspace.id } }), 0);
    await configure();

    await db.documentCreditTransaction.create({
      data: {
        workspaceId: autoWorkspace.id,
        type: "BONUS",
        amount: 7,
        source: "TRIAL_TEST",
        sourceReference: `trial-credit-${suffix}`,
      },
    });
    const autoTrial = await db.workspaceTrial.findFirstOrThrow({
      where: { workspaceId: autoWorkspace.id, status: "ACTIVE" },
    });
    const expiryNow = new Date();
    await db.workspaceTrial.update({
      where: { id: autoTrial.id },
      data: {
        startsAt: new Date(expiryNow.getTime() - 2 * 24 * 60 * 60 * 1000),
        endsAt: new Date(expiryNow.getTime() - 24 * 60 * 60 * 1000),
      },
    });
    entitlements = await getWorkspaceEntitlements(autoWorkspace.id, { now: expiryNow });
    assert.equal(entitlements.activeTrial, null);
    assert.equal(entitlements.effectivePlan.code, "FREE");
    assert.equal(entitlements.purchasedCredits, 7);
    assert.equal(
      await db.membership.count({ where: { workspaceId: autoWorkspace.id, status: "ACTIVE" } }),
      2,
    );
    await assert.rejects(
      db.$transaction((transaction) =>
        assertInvitationCapacity(transaction, autoWorkspace.id),
      ),
      MemberLimitError,
    );
    await db.$transaction((transaction) =>
      ensureCurrentAllowancePeriod(transaction, autoWorkspace.id, expiryNow),
    );
    assert.equal(
      (await db.workspaceDocumentAllowancePeriod.findFirstOrThrow({
        where: { workspaceId: autoWorkspace.id },
      })).allowance,
      plans.FREE.documentLimit,
    );
    await getWorkspaceEntitlements(autoWorkspace.id, { now: expiryNow });
    assert.equal(
      await db.auditEvent.count({
        where: { workspaceId: autoWorkspace.id, action: "TRIAL_EXPIRED", resourceId: autoTrial.id },
      }),
      1,
    );
    await assert.rejects(
      grantConfiguredTrial({ actorUserId: owner.userId, workspaceId: autoWorkspace.id }),
      (error) => error instanceof TrialIneligibleError && error.reason === "ALREADY_USED",
    );

    const cancellationOwner = await createUser("cancel-owner");
    const cancellationWorkspace = await createExistingWorkspace("cancel", cancellationOwner.id);
    await db.documentCreditTransaction.create({
      data: {
        workspaceId: cancellationWorkspace.id,
        type: "BONUS",
        amount: 11,
        source: "TRIAL_TEST",
        sourceReference: `trial-cancel-credit-${suffix}`,
      },
    });
    const cancellationTrial = await grantConfiguredTrial({
      actorUserId: owner.userId,
      workspaceId: cancellationWorkspace.id,
    });
    await assert.rejects(
      cancelWorkspaceTrial({ actorUserId: analyst.id, trialId: cancellationTrial.id }),
      TrialAuthorizationError,
    );
    await cancelWorkspaceTrial({ actorUserId: platformAdmin.id, trialId: cancellationTrial.id });
    const cancelledEntitlements = await getWorkspaceEntitlements(cancellationWorkspace.id);
    assert.equal(cancelledEntitlements.effectivePlan.code, "FREE");
    assert.equal(cancelledEntitlements.purchasedCredits, 11);
    assert.equal(cancelledEntitlements.normalSubscription.status, "BETA");

    const terminalRaceWorkspace = await createExistingWorkspace(
      "terminal-race",
      (await createUser("terminal-race-owner")).id,
    );
    const terminalRaceTrial = await grantConfiguredTrial({
      actorUserId: owner.userId,
      workspaceId: terminalRaceWorkspace.id,
    });
    const terminalRaceNow = new Date();
    await Promise.all([
      cancelWorkspaceTrial({
        actorUserId: platformAdmin.id,
        trialId: terminalRaceTrial.id,
        now: terminalRaceNow,
      }),
      getWorkspaceEntitlements(terminalRaceWorkspace.id, {
        now: new Date(terminalRaceTrial.endsAt.getTime() + 1),
      }),
    ]);
    const terminalRaceResult = await db.workspaceTrial.findUniqueOrThrow({
      where: { id: terminalRaceTrial.id },
      select: { status: true, cancelledAt: true, expiredAt: true },
    });
    assert.ok(
      terminalRaceResult.status === "CANCELLED" ||
        terminalRaceResult.status === "EXPIRED",
    );
    assert.notEqual(
      Boolean(terminalRaceResult.cancelledAt),
      Boolean(terminalRaceResult.expiredAt),
    );

    const allTrialEvents = await db.auditEvent.findMany({
      where: { workspaceId: { in: workspaceIds }, action: { startsWith: "TRIAL_" } },
      select: { action: true, metadata: true },
    });
    assert.ok(allTrialEvents.some((event) => event.action === "TRIAL_STARTED"));
    assert.ok(allTrialEvents.some((event) => event.action === "TRIAL_EXPIRED"));
    assert.ok(allTrialEvents.some((event) => event.action === "TRIAL_CANCELLED"));
    assert.doesNotMatch(
      JSON.stringify(allTrialEvents),
      /password|tokenHash|access_token|refresh_token|R2_SECRET|DATABASE_URL/i,
    );
    assert.equal(
      await db.platformAuditEvent.count({
        where: { createdAt: { gte: startedAt }, action: "PLATFORM_TRIAL_GRANTED" },
      }) >= 1,
      true,
    );
  } finally {
    await db.trialConfiguration.update({
      where: { id: "GLOBAL" },
      data: {
        enabled: originalConfiguration.enabled,
        trialPlanId: originalConfiguration.trialPlanId,
        durationDays: originalConfiguration.durationDays,
        fallbackPlanId: originalConfiguration.fallbackPlanId,
        newWorkspacesOnly: originalConfiguration.newWorkspacesOnly,
        oneTrialPerWorkspace: originalConfiguration.oneTrialPerWorkspace,
        paymentMethodRequired: originalConfiguration.paymentMethodRequired,
        allowManualGrant: originalConfiguration.allowManualGrant,
      },
    });
    if (workspaceIds.length) {
      await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentCreditTransaction.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentCreditPurchase.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspaceTrial.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    await db.platformAuditEvent.deleteMany({
      where: { createdAt: { gte: startedAt }, action: { startsWith: "PLATFORM_TRIAL_" } },
    });
    await db.platformMembership.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
