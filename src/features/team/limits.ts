import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { MemberLimitError, SubscriptionConfigurationError } from "./errors";

export const teamTransactionOptions = {
  maxWait: 10_000,
  timeout: 20_000,
} as const;

export async function lockWorkspaceTeam(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text AS lock
  `;
}

export async function getWorkspaceMemberLimit(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  const subscription = await transaction.subscription.findUnique({
    where: { workspaceId },
    select: {
      plan: {
        select: {
          memberLimit: true,
          isActive: true,
        },
      },
    },
  });

  if (!subscription?.plan.isActive) {
    throw new SubscriptionConfigurationError();
  }

  return subscription.plan.memberLimit;
}

export async function getWorkspaceMemberCapacityUsage(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  now = new Date(),
) {
  const [activeMembers, pendingInvitations] = await Promise.all([
    transaction.membership.count({
      where: { workspaceId, status: "ACTIVE" },
    }),
    transaction.invitation.count({
      where: {
        workspaceId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
    }),
  ]);

  return {
    activeMembers,
    pendingInvitations,
    reservedMemberCapacity: activeMembers + pendingInvitations,
  };
}

export async function assertActiveMemberCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  additionalMembers = 1,
) {
  const memberLimit = await getWorkspaceMemberLimit(transaction, workspaceId);

  if (memberLimit === null) return;

  const activeMembers = await transaction.membership.count({
    where: { workspaceId, status: "ACTIVE" },
  });

  if (activeMembers + additionalMembers > memberLimit) {
    throw new MemberLimitError();
  }
}

export async function assertInvitationCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  now = new Date(),
) {
  const memberLimit = await getWorkspaceMemberLimit(transaction, workspaceId);

  if (memberLimit === null) return;

  const usage = await getWorkspaceMemberCapacityUsage(
    transaction,
    workspaceId,
    now,
  );

  if (usage.reservedMemberCapacity + 1 > memberLimit) {
    throw new MemberLimitError();
  }
}
