import "server-only";

import { type DocumentType, type Prisma } from "@/generated/prisma/client";

const PREFIXES: Partial<Record<DocumentType, string>> = {
  INVOICE: "INV",
  RECEIPT: "REC",
  VAT_INVOICE: "VAT",
  CREDIT_NOTE: "CRN",
  DEBIT_NOTE: "DBN",
};

/**
 * Allocates a workspace/type number inside the caller's transaction. A future
 * issuance failure therefore rolls the allocation back with the document.
 */
export async function allocateOfficialDocumentNumber(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  documentType: DocumentType,
) {
  const prefix = PREFIXES[documentType];
  if (!prefix) throw new Error("This document type does not support official numbering.");

  const sequence = await transaction.documentNumberSequence.upsert({
    where: {
      workspaceId_documentType: { workspaceId, documentType },
    },
    create: { workspaceId, documentType, currentValue: BigInt(1) },
    update: { currentValue: { increment: 1 } },
    select: { currentValue: true },
  });
  return {
    sequence: sequence.currentValue,
    documentNumber: `${prefix}-${sequence.currentValue.toString().padStart(6, "0")}`,
  };
}
