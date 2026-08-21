import "server-only";

import { Prisma, type DocumentType } from "@/generated/prisma/client";

const PREFIXES: Partial<Record<DocumentType, string>> = {
  INVOICE: "INV",
  RECEIPT: "REC",
  VAT_INVOICE: "VAT",
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

  const [sequence] = await transaction.$queryRaw<Array<{ currentValue: bigint }>>(Prisma.sql`
    INSERT INTO "DocumentNumberSequence" (
      "id", "workspaceId", "documentType", "currentValue", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${workspaceId}::uuid, ${documentType}::"DocumentType", 1, NOW(), NOW()
    )
    ON CONFLICT ("workspaceId", "documentType")
    DO UPDATE SET "currentValue" = "DocumentNumberSequence"."currentValue" + 1,
                  "updatedAt" = NOW()
    RETURNING "currentValue"
  `);
  if (!sequence) throw new Error("Unable to allocate an official document number.");
  return {
    sequence: sequence.currentValue,
    documentNumber: `${prefix}-${sequence.currentValue.toString().padStart(6, "0")}`,
  };
}
