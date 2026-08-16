import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { TrialGrantSource } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

import { addUtcMonth } from "./periods";
import {
  getWorkspaceCommercialSummaryPermissions,
  resolveWorkspaceCommercialSummary,
} from "./workspace-summary";

test("workspace summaries preserve entitlement states, role actions, and workspace isolation", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const now = new Date();
  const periodStart = new Date(now.getTime() - 60_000);
  const periodEnd = addUtcMonth(periodStart);
  const plans = Object.fromEntries(
    (await db.plan.findMany({
      where: { code: { in: ["FREE", "BUSINESS", "ENTERPRISE"] } },
      select: {
        id: true,
        code: true,
        name: true,
        memberLimit: true,
        documentLimit: true,
        features: true,
      },
    })).map((plan) => [plan.code, plan]),
  );
  assert.ok(plans.FREE.documentLimit !== null);
  assert.ok(plans.BUSINESS.documentLimit !== null);
  assert.equal(plans.ENTERPRISE.documentLimit, null);

  const owner = await db.user.create({
    data: {
      name: "Workspace summary Owner",
      email: `civ-workspace-summary-owner-${suffix}@example.invalid`,
    },
    select: { id: true },
  });
  userIds.push(owner.id);

  async function createWorkspace(input: {
    label: string;
    planCode: "FREE" | "BUSINESS" | "ENTERPRISE";
    used?: number;
    allowancePlanCode?: "FREE" | "BUSINESS" | "ENTERPRISE";
  }) {
    const subscriptionPlan = plans[input.planCode];
    const allowancePlan = plans[input.allowancePlanCode ?? input.planCode];
    const workspace = await db.workspace.create({
      data: {
        name: `Workspace summary ${input.label} ${suffix}`,
        type: "BUSINESS",
        memberships: {
          create: { userId: owner.id, role: "OWNER", status: "ACTIVE" },
        },
        subscription: {
          create: {
            planId: subscriptionPlan.id,
            status: "BETA",
            startedAt: periodStart,
          },
        },
        documentAllowancePeriods: {
          create: {
            planId: allowancePlan.id,
            periodStart,
            periodEnd,
            allowance: allowancePlan.documentLimit,
            used: input.used ?? 0,
          },
        },
      },
      select: { id: true, name: true },
    });
    workspaceIds.push(workspace.id);
    return workspace;
  }

  try {
    const freeWorkspace = await createWorkspace({ label: "Free", planCode: "FREE" });
    const businessWorkspace = await createWorkspace({ label: "Business", planCode: "BUSINESS" });
    const activeTrialWorkspace = await createWorkspace({
      label: "Active trial",
      planCode: "FREE",
      allowancePlanCode: "BUSINESS",
      used: 80,
    });
    const expiredTrialWorkspace = await createWorkspace({
      label: "Expired trial",
      planCode: "FREE",
    });
    const unlimitedWorkspace = await createWorkspace({
      label: "Unlimited",
      planCode: "ENTERPRISE",
      used: 250,
    });

    await db.documentCreditTransaction.createMany({
      data: [
        {
          workspaceId: freeWorkspace.id,
          type: "BONUS",
          amount: 100,
          source: "WORKSPACE_SUMMARY_TEST",
          sourceReference: `workspace-summary-free-${suffix}`,
        },
        {
          workspaceId: unlimitedWorkspace.id,
          type: "BONUS",
          amount: 25,
          source: "WORKSPACE_SUMMARY_TEST",
          sourceReference: `workspace-summary-unlimited-${suffix}`,
        },
      ],
    });

    const trialSnapshot = {
      trialPlanId: plans.BUSINESS.id,
      fallbackPlanId: plans.FREE.id,
      grantSource: TrialGrantSource.PLATFORM_MANUAL,
      trialPlanCodeSnapshot: plans.BUSINESS.code,
      trialPlanNameSnapshot: plans.BUSINESS.name,
      trialMemberLimitSnapshot: plans.BUSINESS.memberLimit,
      trialDocumentLimitSnapshot: plans.BUSINESS.documentLimit,
      trialFeaturesSnapshot: {},
      fallbackPlanCodeSnapshot: plans.FREE.code,
      fallbackPlanNameSnapshot: plans.FREE.name,
    };
    await db.workspaceTrial.createMany({
      data: [
        {
          workspaceId: activeTrialWorkspace.id,
          status: "ACTIVE",
          startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          endsAt: new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000),
          ...trialSnapshot,
        },
        {
          workspaceId: expiredTrialWorkspace.id,
          status: "ACTIVE",
          startsAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
          endsAt: new Date(now.getTime() - 1_000),
          ...trialSnapshot,
        },
      ],
    });

    const free = await resolveWorkspaceCommercialSummary(freeWorkspace.id, { now });
    const business = await resolveWorkspaceCommercialSummary(businessWorkspace.id, { now });
    assert.equal(free.workspace.name, freeWorkspace.name);
    assert.equal(free.effectivePlan.code, "FREE");
    assert.equal(free.purchasedCredits, 100);
    assert.equal(
      free.totalAvailable,
      plans.FREE.documentLimit + 100,
    );
    assert.equal(business.workspace.name, businessWorkspace.name);
    assert.equal(business.effectivePlan.code, "BUSINESS");
    assert.equal(business.allowance.monthlyAllowance, plans.BUSINESS.documentLimit);
    assert.equal(business.purchasedCredits, 0);
    assert.equal(business.totalAvailable, plans.BUSINESS.documentLimit);
    assert.notEqual(business.workspace.id, free.workspace.id);
    assert.notEqual(business.workspace.name, free.workspace.name);

    const activeTrial = await resolveWorkspaceCommercialSummary(
      activeTrialWorkspace.id,
      { now },
    );
    assert.equal(activeTrial.subscription.plan.code, "FREE");
    assert.equal(activeTrial.effectivePlan.code, "BUSINESS");
    assert.equal(activeTrial.effectivePlan.source, "TRIAL");
    assert.equal(activeTrial.activeTrial?.status, "ACTIVE");
    assert.equal(activeTrial.allowance.monthlyUsed, 80);
    assert.equal(
      activeTrial.allowance.monthlyRemaining,
      plans.BUSINESS.documentLimit - 80,
    );

    const expiredTrial = await resolveWorkspaceCommercialSummary(
      expiredTrialWorkspace.id,
      { now },
    );
    assert.equal(expiredTrial.activeTrial, null);
    assert.equal(expiredTrial.latestTrial?.status, "EXPIRED");
    assert.equal(expiredTrial.effectivePlan.code, "FREE");
    assert.equal(expiredTrial.subscription.plan.code, "FREE");

    const unlimited = await resolveWorkspaceCommercialSummary(
      unlimitedWorkspace.id,
      { now },
    );
    assert.equal(unlimited.allowance.monthlyAllowance, null);
    assert.equal(unlimited.allowance.monthlyRemaining, null);
    assert.equal(unlimited.totalAvailable, null);
    assert.equal(unlimited.purchasedCredits, 25);
    assert.equal(unlimited.allowance.monthlyUsed, 250);
    assert.equal(unlimited.allowance.periodEnd.getTime(), periodEnd.getTime());

    assert.deepEqual(getWorkspaceCommercialSummaryPermissions("OWNER"), {
      canViewCommercialSettings: true,
      canManageCommercialSettings: true,
    });
    assert.deepEqual(getWorkspaceCommercialSummaryPermissions("ADMIN"), {
      canViewCommercialSettings: true,
      canManageCommercialSettings: false,
    });
    for (const role of ["MANAGER", "STAFF"] as const) {
      assert.deepEqual(getWorkspaceCommercialSummaryPermissions(role), {
        canViewCommercialSettings: false,
        canManageCommercialSettings: false,
      });
    }
  } finally {
    if (workspaceIds.length) {
      await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentCreditTransaction.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspaceTrial.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
