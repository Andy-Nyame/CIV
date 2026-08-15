import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export async function getPurchasedCreditBalance(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  const aggregate = await transaction.documentCreditTransaction.aggregate({
    where: { workspaceId },
    _sum: { amount: true },
  });
  return aggregate._sum.amount ?? 0;
}
