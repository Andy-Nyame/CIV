import "server-only";

import {
  PLATFORM_CAPABILITIES,
  hasPlatformCapability,
} from "@/features/platform-admin/capabilities";
import type { Prisma } from "@/generated/prisma/client";

import { CommercialAuthorizationError } from "./errors";

export async function requireCommercialCatalogManager(
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
    !hasPlatformCapability(
      membership,
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_PLANS,
    )
  ) {
    throw new CommercialAuthorizationError();
  }
  return membership;
}
