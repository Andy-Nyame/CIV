import "server-only";

import type { Prisma } from "@/generated/prisma/client";

const PLATFORM_TEAM_LOCK_KEY = "civ-platform-team";

export const platformTeamTransactionOptions = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

export async function lockPlatformTeam(
  transaction: Prisma.TransactionClient,
) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext(${PLATFORM_TEAM_LOCK_KEY}))::text AS lock
  `;
}
