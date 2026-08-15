import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export const commercialTransactionOptions = {
  maxWait: 15_000,
  timeout: 45_000,
} as const;

export async function lockWorkspaceCommercialAccount(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext(${`civ-commercial:${workspaceId}`}))::text AS lock
  `;
}

export async function lockCommercialCatalog(
  transaction: Prisma.TransactionClient,
) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext('civ-commercial-catalog'))::text AS lock
  `;
}
