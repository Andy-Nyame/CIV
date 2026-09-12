import "server-only";

import { z } from "zod";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { BusinessDataConflictError, BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions } from "@/features/business-data/locking";
import { db } from "@/lib/db";

const voidInputSchema = z.object({
  documentId: z.string().uuid(),
  reason: z.string().trim().min(8, "Give a clear reason for voiding this issued document.").max(1_000),
});

export async function voidIssuedDocument(input: {
  actorUserId: string;
  workspaceId: string;
  documentId: unknown;
  reason: unknown;
}) {
  const parsed = voidInputSchema.safeParse({ documentId: input.documentId, reason: input.reason });
  if (!parsed.success) throw new BusinessDataValidationError(parsed.error.flatten().fieldErrors);

  return db.$transaction(async (transaction) => {
    const membership = await requireWorkspaceCapabilityInTransaction(transaction, input.actorUserId, input.workspaceId, CAPABILITIES.VOID_DOCUMENT);
    const access = getDocumentAccessFilter({ ...membership, userId: input.actorUserId, workspaceId: input.workspaceId });
    if (!access) throw new BusinessDataConflictError("This document is unavailable.");
    const voidedAt = new Date();
    const claimed = await transaction.document.updateMany({
      where: { id: parsed.data.documentId, ...access, status: "ISSUED", archivedAt: null, snapshot: { isNot: null } },
      data: { status: "VOIDED", voidedAt, voidedByUserId: input.actorUserId, voidReason: parsed.data.reason },
    });
    const document = await transaction.document.findFirst({
      where: { id: parsed.data.documentId, ...access, archivedAt: null },
      select: { id: true, status: true, documentNumber: true, snapshot: { select: { id: true } } },
    });
    if (!document || !document.snapshot || !document.documentNumber) throw new BusinessDataConflictError("This issued document is unavailable.");
    if (document.status === "VOIDED" && claimed.count === 0) return { documentId: document.id, documentNumber: document.documentNumber, idempotent: true };
    if (document.status !== "VOIDED" || claimed.count !== 1) throw new BusinessDataConflictError("Only an issued document can be voided.");
    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "DOCUMENT_VOIDED",
      resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT,
      resourceId: document.id,
      metadata: { documentNumber: document.documentNumber, reason: parsed.data.reason },
    });
    return { documentId: document.id, documentNumber: document.documentNumber, voidedAt, idempotent: false };
  }, businessDataTransactionOptions);
}
