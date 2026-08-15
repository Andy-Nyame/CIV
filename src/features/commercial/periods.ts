import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { resolveWorkspaceEntitlementsInTransaction } from "@/features/trials/entitlements";

import { CommercialConfigurationError } from "./errors";

export function addUtcMonth(value: Date) {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const finalDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, finalDay));
  return result;
}

export async function ensureCurrentAllowancePeriod(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  now = new Date(),
) {
  const entitlements = await resolveWorkspaceEntitlementsInTransaction(
    transaction,
    workspaceId,
    { now, includePurchasedCredits: false },
  );
  const existing = await transaction.workspaceDocumentAllowancePeriod.findFirst({
    where: { workspaceId, periodStart: { lte: now }, periodEnd: { gt: now } },
    orderBy: { periodStart: "desc" },
  });
  if (existing) {
    if (
      existing.planId !== entitlements.effectivePlan.id ||
      existing.allowance !== entitlements.effectivePlan.documentLimit
    ) {
      return transaction.workspaceDocumentAllowancePeriod.update({
        where: { id: existing.id },
        data: {
          planId: entitlements.effectivePlan.id,
          allowance: entitlements.effectivePlan.documentLimit,
        },
      });
    }
    return existing;
  }

  const subscription = entitlements.normalSubscription;
  if (!subscription) throw new CommercialConfigurationError();

  const latest = await transaction.workspaceDocumentAllowancePeriod.findFirst({
    where: { workspaceId },
    orderBy: { periodStart: "desc" },
  });
  let periodStart = latest?.periodEnd ?? subscription.startedAt;
  let periodEnd = addUtcMonth(periodStart);
  let current = latest;

  while (periodEnd <= now) {
    const used = await transaction.document.count({
      where: {
        workspaceId,
        status: { in: ["ISSUED", "VOIDED"] },
        issuedAt: { gte: periodStart, lt: periodEnd },
      },
    });
    current = await transaction.workspaceDocumentAllowancePeriod.create({
      data: {
        workspaceId,
        planId: entitlements.effectivePlan.id,
        periodStart,
        periodEnd,
        allowance: entitlements.effectivePlan.documentLimit,
        used,
      },
    });
    periodStart = periodEnd;
    periodEnd = addUtcMonth(periodStart);
  }

  const used = await transaction.document.count({
    where: {
      workspaceId,
      status: { in: ["ISSUED", "VOIDED"] },
      issuedAt: { gte: periodStart, lt: periodEnd },
    },
  });
  current = await transaction.workspaceDocumentAllowancePeriod.create({
    data: {
      workspaceId,
      planId: entitlements.effectivePlan.id,
      periodStart,
      periodEnd,
      allowance: entitlements.effectivePlan.documentLimit,
      used,
    },
  });
  return current;
}
