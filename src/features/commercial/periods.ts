import "server-only";

import type { Prisma } from "@/generated/prisma/client";

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
  const existing = await transaction.workspaceDocumentAllowancePeriod.findFirst({
    where: { workspaceId, periodStart: { lte: now }, periodEnd: { gt: now } },
    orderBy: { periodStart: "desc" },
  });
  if (existing) return existing;

  const subscription = await transaction.subscription.findUnique({
    where: { workspaceId },
    select: {
      startedAt: true,
      plan: { select: { id: true, documentLimit: true } },
    },
  });
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
        planId: subscription.plan.id,
        periodStart,
        periodEnd,
        allowance: subscription.plan.documentLimit,
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
      planId: subscription.plan.id,
      periodStart,
      periodEnd,
      allowance: subscription.plan.documentLimit,
      used,
    },
  });
  return current;
}
