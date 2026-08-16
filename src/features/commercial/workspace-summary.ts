import "server-only";

import { cache } from "react";

import type { MembershipRole } from "@/generated/prisma/enums";
import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { resolveWorkspaceEntitlementsInTransaction } from "@/features/trials/entitlements";
import { db } from "@/lib/db";

import {
  commercialTransactionOptions,
  lockWorkspaceCommercialAccount,
} from "./locking";
import { ensureCurrentAllowancePeriod } from "./periods";

export function getWorkspaceCommercialSummaryPermissions(role: MembershipRole) {
  const membership = { role };
  return {
    canViewCommercialSettings: hasCapability(
      membership,
      CAPABILITIES.VIEW_SUBSCRIPTION,
    ),
    canManageCommercialSettings: hasCapability(
      membership,
      CAPABILITIES.MANAGE_SUBSCRIPTION,
    ),
  };
}

export async function resolveWorkspaceCommercialSummary(
  workspaceId: string,
  options: { now?: Date } = {},
) {
  const resolvedAt = options.now ?? new Date();
  return db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, workspaceId);
    const workspace = await transaction.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, name: true, archivedAt: true },
    });
    const period = await ensureCurrentAllowancePeriod(
      transaction,
      workspaceId,
      resolvedAt,
    );
    const entitlements = await resolveWorkspaceEntitlementsInTransaction(
      transaction,
      workspaceId,
      { now: resolvedAt, includePurchasedCredits: true },
    );
    const monthlyRemaining =
      period.allowance === null
        ? null
        : Math.max(0, period.allowance - period.used);

    return {
      resolvedAt,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        lifecycleStatus: workspace.archivedAt === null ? "ACTIVE" as const : "ARCHIVED" as const,
      },
      subscription: {
        status: entitlements.normalSubscription.status,
        plan: entitlements.normalSubscription.plan,
      },
      effectivePlan: entitlements.effectivePlan,
      activeTrial: entitlements.activeTrial,
      latestTrial: entitlements.latestTrial,
      allowance: {
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        monthlyAllowance: period.allowance,
        monthlyUsed: period.used,
        monthlyRemaining,
      },
      purchasedCredits: entitlements.purchasedCredits,
      totalAvailable:
        monthlyRemaining === null
          ? null
          : monthlyRemaining + entitlements.purchasedCredits,
    };
  }, commercialTransactionOptions);
}

export const getWorkspaceCommercialSummary = cache(
  async (workspaceId: string) => resolveWorkspaceCommercialSummary(workspaceId),
);

export type WorkspaceCommercialSummary = Awaited<
  ReturnType<typeof resolveWorkspaceCommercialSummary>
>;
