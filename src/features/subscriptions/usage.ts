import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export async function getIssuedDocumentUsage(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  return transaction.document.count({
    where: {
      workspaceId,
      status: { in: ["ISSUED", "VOIDED"] },
    },
  });
}
