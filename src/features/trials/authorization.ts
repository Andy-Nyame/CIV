import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  PLATFORM_CAPABILITIES,
  hasPlatformCapability,
} from "@/features/platform-admin/capabilities";

import { TrialAuthorizationError } from "./errors";

export async function requireTrialManagerInTransaction(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
) {
  const membership = await transaction.platformMembership.findUnique({
    where: { userId: actorUserId },
    select: { role: true, status: true },
  });
  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    !hasPlatformCapability(membership, PLATFORM_CAPABILITIES.MANAGE_TRIALS)
  ) {
    throw new TrialAuthorizationError();
  }
  return membership;
}
