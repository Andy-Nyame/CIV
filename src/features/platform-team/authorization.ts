import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import {
  PLATFORM_CAPABILITIES,
  hasPlatformCapability,
} from "@/features/platform-admin/capabilities";

import { PlatformTeamAuthorizationError } from "./errors";

export async function requirePlatformTeamManagerInTransaction(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
) {
  const membership = await transaction.platformMembership.findUnique({
    where: { userId: actorUserId },
    select: { id: true, role: true, status: true },
  });
  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    !hasPlatformCapability(
      membership,
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM,
    )
  ) {
    throw new PlatformTeamAuthorizationError();
  }
  return membership;
}
