import "server-only";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { BusinessDataConflictError, BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions } from "@/features/business-data/locking";
import { consumeDocumentCapacityInTransaction } from "@/features/commercial/capacity";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { determineTaxPointDateTime, isVatEligibleAtTaxPoint } from "@/features/tax/eligibility";
import { resolveGhanaVatVersion } from "@/features/tax/resolver";
import { buildTaxSnapshot } from "@/features/tax/snapshot";
import type { TrustedTaxComponent, TrustedTaxVersion } from "@/features/tax/types";
import { authorizeWorkspaceDocumentReadinessInTransaction } from "@/features/workspaces/document-readiness-service";
import { evaluateWorkspaceDocumentReadiness } from "@/features/workspaces/document-readiness";
import { generateVerificationCode } from "@/features/documents/verification/code";

import { calculateDocumentLine, calculateDraftTotals, calculateNetPayable } from "./calculations";
import { allocateOfficialDocumentNumber } from "./numbering";
import { validateIssueReadinessInTransaction, workspaceIssuesForIssuance, type IssueReadinessError } from "./readiness";
import { buildIssuedDocumentSnapshot, issuedDocumentSnapshotSchema } from "./snapshots";
import { documentIdSchema } from "./validation";
import { hasAuthoritativeGraCertification, isStatutoryTaxDocument } from "./compliance";

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
  verificationCode: string | null;
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
  const snapshot = issuedDocumentSnapshotSchema.parse(document.snapshot.payload);
  if ((snapshot.verification?.code ?? null) !== document.verificationCode) {
    throw new DocumentIssueConflictError("The issued document verification identity is inconsistent.");
  }
  return {
    documentId: document.id,
    workspaceId: document.workspaceId,
    documentNumber: document.documentNumber,
    verificationCode: document.verificationCode,
    issuedAt: document.issuedAt,
    snapshotId: document.snapshot.id,
    snapshotVersion: document.snapshot.snapshotVersion,
    capacityConsumptionId: document.capacityConsumption.id,
    idempotent,
  };
}

async function issueDocumentOnce(input: {
  actorUserId: string;
  workspaceId: string;
  acknowledgeGraRequirement: boolean;
}, documentId: string, verificationCode: string, client: typeof db) {
  return client.$transaction(async (transaction) => {
    const authorization = await authorizeWorkspaceDocumentReadinessInTransaction({ actorUserId: input.actorUserId, workspaceId: input.workspaceId, capability: CAPABILITIES.ISSUE_DOCUMENT }, transaction);
    const membership = authorization.membership;
    const access = getDocumentAccessFilter(membership);

    // Claim and row-lock a draft with one conditional UPDATE. Concurrent issue
    // requests wait for the winner, then re-evaluate the DRAFT predicate and
    // fall through to the immutable issued-result path. This avoids a raw
    // advisory query at transaction start, which Prisma's pg adapter can
    // overlap with BEGIN, while retaining exactly-once issuance semantics.
    const claimed = access
      ? await transaction.document.updateMany({
          where: { id: documentId, ...access, status: "DRAFT", archivedAt: null },
          data: { updatedAt: new Date() },
        })
      : { count: 0 };
    const existing = access
      ? await transaction.document.findFirst({
          where: { id: documentId, ...access, archivedAt: null },
          include: { snapshot: true, capacityConsumption: { select: { id: true } } },
        })
      : null;
    if (!existing) throw new DocumentIssueConflictError("The draft is unavailable.");
    if (existing.status === "ISSUED") return issuedResult(existing, true);
    if (existing.status !== "DRAFT" || claimed.count !== 1) throw new DocumentIssueConflictError();

    const draft = await transaction.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { paymentEvents: { orderBy: { eventOrder: "asc" } }, lines: { orderBy: { lineOrder: "asc" } } },
    });
    if (!["INVOICE", "RECEIPT", "VAT_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(draft.type)) {
      throw new DocumentIssueReadinessError([{ code: "UNSUPPORTED_TYPE", message: "This document type cannot be issued yet.", field: "type" }]);
    }
    const documentType = draft.type as "INVOICE" | "RECEIPT" | "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
    const taxPointDateTime = determineTaxPointDateTime({ supplyDate: draft.supplyDate ?? draft.draftDate, documentDate: draft.draftDate, paymentDates: draft.paymentEvents.map(({ occurredAt }) => occurredAt) });
    const taxPointDate = taxPointDateTime;
    const workspaceReadiness = evaluateWorkspaceDocumentReadiness({ workspace: authorization.workspace, documentType, taxPointDate, isSuperAdmin: authorization.isSuperAdmin });
    if (!workspaceReadiness.ready) {
      throw new DocumentIssueReadinessError(workspaceIssuesForIssuance(workspaceReadiness.issues));
    }
    if (draft.isTestDocument !== workspaceReadiness.isTestWorkspace) {
      throw new DocumentIssueReadinessError([{ code: "TEST_STATUS_INVALID", message: "The document TEST status does not match its workspace and cannot be changed." }]);
    }
    const statutoryTaxDocument = isStatutoryTaxDocument(documentType, draft.receiptType);
    const requiresFiscalization = statutoryTaxDocument || documentType === "CREDIT_NOTE" || documentType === "DEBIT_NOTE";
    if (draft.receiptType === "VAT_SALES_RECEIPT" && !workspaceReadiness.isTestWorkspace && authorization.workspace.vatSalesReceiptAuthorization !== "AUTHORIZED") {
      throw new DocumentIssueReadinessError([{ code: "VAT_SALES_RECEIPT_NOT_AUTHORIZED", message: "This workspace has no recorded Commissioner-General authorization for VAT sales receipts. Use a commercial receipt or VAT invoice.", field: "receiptType" }]);
    }
    if (requiresFiscalization && !workspaceReadiness.isTestWorkspace) {
      const certified = hasAuthoritativeGraCertification({ status: draft.fiscalizationStatus, fiscalDocumentId: draft.graFiscalDocumentId, timestamp: draft.graTimestamp, providerReference: draft.graProviderReference });
      if (draft.fiscalizationStatus === "CERTIFIED" && !certified) {
        throw new DocumentIssueReadinessError([{ code: "FISCALIZATION_INVALID", message: "GRA certification cannot be recorded without an authoritative fiscal response.", field: "fiscalizationStatus" }]);
      }
      if (!certified && !input.acknowledgeGraRequirement) {
        throw new DocumentIssueReadinessError([{ code: "GRA_FISCALIZATION_ACKNOWLEDGEMENT_REQUIRED", message: "Acknowledge that this CIV record still requires GRA Certified Invoicing System processing for official use.", field: "fiscalizationStatus" }]);
      }
    }
    const supplierVatEligible = isVatEligibleAtTaxPoint(authorization.workspace, taxPointDate);
    let taxVersion: TrustedTaxVersion | null = null;
    let statutoryComponents: TrustedTaxComponent[] = [];
    if (documentType === "CREDIT_NOTE" || documentType === "DEBIT_NOTE") {
      const original = draft.originalDocumentId ? await transaction.document.findFirst({
        where: { id: draft.originalDocumentId, workspaceId: input.workspaceId, status: "ISSUED", archivedAt: null, type: { notIn: ["CREDIT_NOTE", "DEBIT_NOTE"] } },
        select: { taxVersionId: true, currency: true, snapshot: { select: { payload: true } } },
      }) : null;
      const originalSnapshot = original?.snapshot ? issuedDocumentSnapshotSchema.safeParse(original.snapshot.payload) : null;
      if (!original || !originalSnapshot?.success || !draft.adjustmentReason) {
        throw new DocumentIssueReadinessError([{ code: "ADJUSTMENT_REFERENCE_REQUIRED", message: "Select an issued original document and record the adjustment reason.", field: "originalDocumentId" }]);
      }
      if (original.currency !== draft.currency) {
        throw new DocumentIssueReadinessError([{ code: "CURRENCY_MISMATCH", message: "The adjustment currency must match the original document.", field: "currency" }]);
      }
      statutoryComponents = originalSnapshot.data.tax?.components.map((component) => ({ code: component.code, name: component.name, rate: component.rate, calculationOrder: component.order, baseStrategy: component.baseStrategy, contributesToTaxableValue: false, contributesToTotal: true })) ?? [];
      if (originalSnapshot.data.tax) taxVersion = { id: originalSnapshot.data.tax.version.id, version: originalSnapshot.data.tax.version.code, effectiveFrom: new Date(`${originalSnapshot.data.tax.version.effectiveFrom}T00:00:00.000Z`), effectiveTo: originalSnapshot.data.tax.version.effectiveTo ? new Date(`${originalSnapshot.data.tax.version.effectiveTo}T00:00:00.000Z`) : null, profile: originalSnapshot.data.tax.profile, components: statutoryComponents };
    } else if (supplierVatEligible && statutoryTaxDocument) {
      taxVersion = await resolveGhanaVatVersion(taxPointDate, transaction);
      statutoryComponents = taxVersion.components;
    }
    let calculatedLines;
    try {
      calculatedLines = draft.lines.map((line) => calculateDocumentLine({
        description: line.description,
        quantity: line.quantity.toString(),
        unitPrice: line.unitPrice.toString(),
        discountAmount: line.discountAmount.toString(),
        priceMode: draft.priceMode,
        taxTreatment: line.taxTreatment,
        reliefApplied: line.reliefApplied,
        supplierVatEligible: documentType === "CREDIT_NOTE" || documentType === "DEBIT_NOTE" ? statutoryComponents.length > 0 : supplierVatEligible && statutoryTaxDocument,
        statutoryComponents,
        rate: line.rateTypeSnapshot && line.rateValueSnapshot
          ? { type: line.rateTypeSnapshot, value: line.rateValueSnapshot.toString() }
          : null,
      }));
    } catch {
      throw new DocumentIssueReadinessError([{ code: "CALCULATION_INVALID", message: "The draft contains invalid financial values.", field: "lines" }]);
    }
    const totals = calculateDraftTotals(calculatedLines);
    const withholding = calculateNetPayable(totals.grandTotal, draft.withholdingApplied, draft.withholdingAmount.toString());
    const snapshotComponents = totals.taxComponents.length ? totals.taxComponents : taxVersion?.components.map((component) => ({ ...component, calculationBase: "0.00", amount: "0.00" })) ?? [];
    const calculation = {
      taxVersionId: taxVersion?.id ?? null,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      rateTotal: totals.rateTotal,
      taxableValue: totals.taxableValue,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      standardRatedValue: totals.standardRatedValue,
      zeroRatedValue: totals.zeroRatedValue,
      exemptValue: totals.exemptValue,
      relievedValue: totals.relievedValue,
      withholdingAmount: withholding.withholdingAmount,
      netPayable: withholding.netPayable,
      taxPointDate: taxPointDateTime,
      taxCalculation: taxVersion ? buildTaxSnapshot(taxVersion, { base: totals.taxableValue.toFixed(2), taxableValue: totals.taxableValue.toFixed(2), taxTotal: totals.taxTotal.toFixed(2), grossTotal: totals.taxableValue.add(totals.taxTotal).toFixed(2), components: snapshotComponents }) as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
    };

    for (const [index, line] of draft.lines.entries()) {
      await transaction.documentLine.update({
        where: { id: line.id },
        data: {
          lineSubtotal: calculatedLines[index]!.lineSubtotal,
          originalAmount: calculatedLines[index]!.originalAmount,
          discountAmount: calculatedLines[index]!.discountAmount,
          taxableBase: calculatedLines[index]!.taxableBase,
          rateTotal: calculatedLines[index]!.rateTotal,
          taxTotal: calculatedLines[index]!.taxTotal,
          taxCalculation: calculatedLines[index]!.taxComponents.length ? { components: calculatedLines[index]!.taxComponents.map((component) => ({ code: component.code, name: component.name, rate: component.rate, order: component.calculationOrder, baseStrategy: component.baseStrategy, calculationBase: component.calculationBase, amount: component.amount })) } as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
          lineTotal: calculatedLines[index]!.lineTotal,
        },
      });
    }
    await transaction.document.update({ where: { id: documentId }, data: calculation });

    const readiness = await validateIssueReadinessInTransaction(transaction, {
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      documentId,
    }, authorization);
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
        originalDocument: { select: { documentNumber: true, issueDate: true, snapshot: { select: { payload: true } } } },
        paymentEvents: { orderBy: { eventOrder: "asc" } },
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
      verificationCode,
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
        verificationCode,
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
        customerName: authoritativeDocument.customerName ?? authoritativeDocument.customer?.name ?? null,
        total: calculation.grandTotal.toFixed(2),
        currency: draft.currency,
      },
    });

    return {
      documentId,
      workspaceId: input.workspaceId,
      documentNumber,
      verificationCode,
      issuedAt,
      snapshotId: persistedSnapshot.id,
      snapshotVersion: persistedSnapshot.snapshotVersion,
      capacityConsumptionId: capacity.consumptionId,
      idempotent: false,
    };
  }, { ...businessDataTransactionOptions, timeout: 45_000 });
}

function isVerificationCodeCollision(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const metadata = JSON.stringify(error.meta ?? {});
  return metadata.includes("civDocumentId") || metadata.includes("verificationCode");
}

export async function issueDocument(input: {
  actorUserId: string;
  workspaceId: string;
  documentId: unknown;
  acknowledgeGraRequirement?: boolean;
}, client: typeof db = db, options: { generateCode?: () => string } = {}) {
  const parsedId = documentIdSchema.safeParse(input.documentId);
  if (!parsedId.success) {
    throw new BusinessDataValidationError({ documentId: ["Invalid document."] });
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await issueDocumentOnce(
        { actorUserId: input.actorUserId, workspaceId: input.workspaceId, acknowledgeGraRequirement: input.acknowledgeGraRequirement ?? false },
        parsedId.data,
        (options.generateCode ?? generateVerificationCode)(),
        client,
      );
    } catch (error) {
      if (!isVerificationCodeCollision(error)) throw error;
      if (attempt === 4) throw new DocumentIssueConflictError("Unable to allocate a unique CIV verification code.");
    }
  }
  throw new DocumentIssueConflictError("Unable to allocate a unique CIV verification code.");
}
