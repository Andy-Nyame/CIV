import "server-only";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { BusinessDataConflictError, BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions, lockBusinessResource } from "@/features/business-data/locking";
import { consumeDocumentCapacityInTransaction } from "@/features/commercial/capacity";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { calculateTrustedTax } from "@/features/tax/calculation";
import { resolveGhanaVatVersion } from "@/features/tax/resolver";
import { buildTaxSnapshot } from "@/features/tax/snapshot";

import { calculateDraftLine, calculateDraftTotals } from "./calculations";
import { allocateOfficialDocumentNumber } from "./numbering";
import { validateIssueReadinessInTransaction, type IssueReadinessError } from "./readiness";
import { buildIssuedDocumentSnapshot, issuedDocumentSnapshotSchema } from "./snapshots";
import { documentIdSchema } from "./validation";

export class DocumentIssueReadinessError extends Error {
  constructor(readonly errors: IssueReadinessError[]) {
    super("This draft is not ready to issue.");
    this.name = "DocumentIssueReadinessError";
  }
}

export class DocumentIssueConflictError extends BusinessDataConflictError {
  constructor(message = "This document cannot be issued in its current state.") {
    super(message);
    this.name = "DocumentIssueConflictError";
  }
}

export function buildIssueSourceReference(documentId: string) {
  return `DOCUMENT_ISSUE:${documentId}`;
}

function issuedResult(document: {
  id: string;
  workspaceId: string;
  status: string;
  documentNumber: string | null;
  issuedAt: Date | null;
  snapshot: { id: string; snapshotVersion: number; payload: Prisma.JsonValue } | null;
  capacityConsumption: { id: string } | null;
}, idempotent: boolean) {
  if (
    document.status !== "ISSUED" ||
    !document.documentNumber ||
    !document.issuedAt ||
    !document.snapshot ||
    !document.capacityConsumption
  ) {
    throw new DocumentIssueConflictError("The issued document record is incomplete.");
  }
  issuedDocumentSnapshotSchema.parse(document.snapshot.payload);
  return {
    documentId: document.id,
    workspaceId: document.workspaceId,
    documentNumber: document.documentNumber,
    issuedAt: document.issuedAt,
    snapshotId: document.snapshot.id,
    snapshotVersion: document.snapshot.snapshotVersion,
    capacityConsumptionId: document.capacityConsumption.id,
    idempotent,
  };
}

export async function issueDocument(input: {
  actorUserId: string;
  workspaceId: string;
  documentId: unknown;
}, client: typeof db = db) {
  const parsedId = documentIdSchema.safeParse(input.documentId);
  if (!parsedId.success) {
    throw new BusinessDataValidationError({ documentId: ["Invalid document."] });
  }
  const documentId = parsedId.data;

  return client.$transaction(async (transaction) => {
    await lockBusinessResource(transaction, `document:${documentId}`);
    const membership = await requireWorkspaceCapabilityInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
      CAPABILITIES.ISSUE_DOCUMENT,
    );
    const access = getDocumentAccessFilter(membership);
    const existing = access
      ? await transaction.document.findFirst({
          where: { id: documentId, ...access, archivedAt: null },
          include: { snapshot: true, capacityConsumption: { select: { id: true } } },
        })
      : null;
    if (!existing) throw new DocumentIssueConflictError("The draft is unavailable.");
    if (existing.status === "ISSUED") return issuedResult(existing, true);
    if (existing.status !== "DRAFT") throw new DocumentIssueConflictError();

    const draft = await transaction.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { lines: { orderBy: { lineOrder: "asc" } } },
    });
    if (!["INVOICE", "RECEIPT", "VAT_INVOICE"].includes(draft.type)) {
      throw new DocumentIssueReadinessError([{ code: "UNSUPPORTED_TYPE", message: "This document type cannot be issued yet.", field: "type" }]);
    }
    const documentType = draft.type as "INVOICE" | "RECEIPT" | "VAT_INVOICE";
    let calculatedLines;
    try {
      calculatedLines = draft.lines.map((line) => calculateDraftLine({
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        rate: line.rateTypeSnapshot && line.rateValueSnapshot
          ? { type: line.rateTypeSnapshot, value: line.rateValueSnapshot.toString() }
          : null,
      }));
    } catch {
      throw new DocumentIssueReadinessError([{ code: "CALCULATION_INVALID", message: "The draft contains invalid financial values.", field: "lines" }]);
    }
    const totals = calculateDraftTotals(calculatedLines);
    let calculation: {
      taxVersionId: string | null;
      subtotal: Prisma.Decimal;
      discountTotal: Prisma.Decimal;
      rateTotal: Prisma.Decimal;
      taxableValue: Prisma.Decimal;
      taxTotal: Prisma.Decimal;
      grandTotal: Prisma.Decimal;
      taxCalculation: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    };
    if (documentType === "VAT_INVOICE") {
      const taxVersion = await resolveGhanaVatVersion(draft.draftDate, transaction);
      const trustedTax = calculateTrustedTax(totals.subtotal, taxVersion.components);
      calculation = {
        taxVersionId: taxVersion.id,
        subtotal: totals.subtotal,
        discountTotal: new Prisma.Decimal(0),
        rateTotal: new Prisma.Decimal(0),
        taxableValue: new Prisma.Decimal(trustedTax.taxableValue),
        taxTotal: new Prisma.Decimal(trustedTax.taxTotal),
        grandTotal: new Prisma.Decimal(trustedTax.grossTotal),
        taxCalculation: buildTaxSnapshot(taxVersion, trustedTax) as unknown as Prisma.InputJsonValue,
      };
    } else {
      calculation = {
        taxVersionId: null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        rateTotal: totals.rateTotal,
        taxableValue: totals.subtotal,
        taxTotal: new Prisma.Decimal(0),
        grandTotal: totals.grandTotal,
        taxCalculation: Prisma.JsonNull,
      };
    }

    for (const [index, line] of draft.lines.entries()) {
      await transaction.documentLine.update({
        where: { id: line.id },
        data: {
          lineSubtotal: calculatedLines[index]!.lineSubtotal,
          rateTotal: calculatedLines[index]!.rateTotal,
          lineTotal: calculatedLines[index]!.lineTotal,
        },
      });
    }
    await transaction.document.update({ where: { id: documentId }, data: calculation });

    const readiness = await validateIssueReadinessInTransaction(transaction, {
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      documentId,
    });
    if (!readiness.ready) throw new DocumentIssueReadinessError(readiness.errors);

    const { documentNumber } = await allocateOfficialDocumentNumber(
      transaction,
      input.workspaceId,
      documentType,
    );
    const capacity = await consumeDocumentCapacityInTransaction(transaction, {
      workspaceId: input.workspaceId,
      amount: 1,
      sourceReference: buildIssueSourceReference(documentId),
      actorUserId: input.actorUserId,
      documentId,
    });
    const issuedAt = new Date();
    const authoritativeDocument = await transaction.document.findUniqueOrThrow({
      where: { id: documentId },
      include: {
        workspace: { include: { logo: true } },
        customer: true,
        lines: { orderBy: { lineOrder: "asc" } },
      },
    });
    const actor = await transaction.user.findUniqueOrThrow({
      where: { id: input.actorUserId },
      select: { id: true, name: true, email: true },
    });
    const snapshot = buildIssuedDocumentSnapshot({
      document: { ...authoritativeDocument, type: documentType },
      documentNumber,
      issuedAt,
      actor,
    });
    const persistedSnapshot = await transaction.documentSnapshot.create({
      data: {
        documentId,
        snapshotVersion: snapshot.snapshotVersion,
        payload: snapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, snapshotVersion: true },
    });
    await transaction.document.update({
      where: { id: documentId },
      data: {
        status: "ISSUED",
        documentNumber,
        issueDate: draft.draftDate,
        issuedAt,
        issuedByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "DOCUMENT_ISSUED",
      resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT,
      resourceId: documentId,
      metadata: {
        documentType,
        documentNumber,
        customerName: authoritativeDocument.customer?.name ?? null,
        total: calculation.grandTotal.toFixed(2),
        currency: draft.currency,
      },
    });

    return {
      documentId,
      workspaceId: input.workspaceId,
      documentNumber,
      issuedAt,
      snapshotId: persistedSnapshot.id,
      snapshotVersion: persistedSnapshot.snapshotVersion,
      capacityConsumptionId: capacity.consumptionId,
      idempotent: false,
    };
  }, { ...businessDataTransactionOptions, timeout: 45_000 });
}
