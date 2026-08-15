import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export const trialTransactionOptions = {
  maxWait: 15_000,
  timeout: 45_000,
} as const;

export async function lockWorkspaceTrials(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext(${`civ-trials:${workspaceId}`}))::text AS lock
  `;
}

export async function lockTrialConfiguration(
  transaction: Prisma.TransactionClient,
) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext('civ-trial-configuration'))::text AS lock
  `;
}
