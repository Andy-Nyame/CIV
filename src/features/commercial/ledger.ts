import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export async function getPurchasedCreditLedgerBalance(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  const aggregate = await transaction.documentCreditTransaction.aggregate({
    where: { workspaceId },
    _sum: { amount: true },
  });
  return aggregate._sum.amount ?? 0;
}

export async function getReservedCreditRefundBalance(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  const aggregate = await transaction.paymentRefund.aggregate({
    where: {
      workspaceId,
      active: true,
      creditAmount: { not: null },
    },
    _sum: { creditAmount: true },
  });
  return aggregate._sum.creditAmount ?? 0;
}

export async function getPurchasedCreditBalance(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  const [ledgerBalance, reservedForRefunds] = await Promise.all([
    getPurchasedCreditLedgerBalance(transaction, workspaceId),
    getReservedCreditRefundBalance(transaction, workspaceId),
  ]);
  return ledgerBalance - reservedForRefunds;
}
