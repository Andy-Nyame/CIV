import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export const businessDataTransactionOptions = { maxWait: 10_000, timeout: 30_000 } as const;

export async function lockBusinessResource(transaction: Prisma.TransactionClient, key: string) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext(${`civ-create:${key}`}))::text AS lock
  `;
}
