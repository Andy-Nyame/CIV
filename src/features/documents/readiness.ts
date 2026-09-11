import "server-only";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { businessDataTransactionOptions } from "@/features/business-data/locking";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { determineTaxPoint, isVatEligibleAtTaxPoint } from "@/features/tax/eligibility";
import { resolveGhanaVatVersion } from "@/features/tax/resolver";
import { calculateDocumentLine, calculateDraftTotals, calculateNetPayable } from "./calculations";
import { documentTaxSnapshotSchema } from "./snapshots";
import { authorizeWorkspaceDocumentReadinessInTransaction } from "@/features/workspaces/document-readiness-service";
import type { WorkspaceReadinessIssue } from "@/features/workspaces/document-readiness";
import { evaluateWorkspaceDocumentReadiness } from "@/features/workspaces/document-readiness";

export type IssueReadinessCode =
  | "DRAFT_UNAVAILABLE" | "UNSUPPORTED_TYPE" | "NO_LINES" | "INVALID_TOTAL" | "INVALID_DATE"
  | "CURRENCY_MISMATCH" | "CUSTOM_RATE_UNAVAILABLE" | "CUSTOMER_REQUIRED" | "CALCULATION_INVALID"
  | "WORKSPACE_SETUP_INCOMPLETE" | "VAT_REGISTRATION_REQUIRED" | "TEST_WORKSPACE_ACCESS_REQUIRED"
  | "TEST_STATUS_INVALID" | "TRUSTED_TAX_UNAVAILABLE" | "TAX_CALCULATION_STALE"
  | "CLASSIFICATION_EVIDENCE_REQUIRED" | "RELIEF_EVIDENCE_REQUIRED" | "VAT_INVOICE_EXEMPT_ONLY"
  | "ADJUSTMENT_REFERENCE_REQUIRED" | "WITHHOLDING_INVALID";

export type IssueReadinessError = { code: IssueReadinessCode; message: string; field?: string };

export function workspaceIssuesForIssuance(issues: WorkspaceReadinessIssue[]): IssueReadinessError[] {
  return issues.map((issue) => ({
    code: issue.code === "VAT_REGISTRATION_REQUIRED"
      ? "VAT_REGISTRATION_REQUIRED"
      : issue.code === "TEST_WORKSPACE_ACCESS_REQUIRED"
        ? "TEST_WORKSPACE_ACCESS_REQUIRED"
        : "WORKSPACE_SETUP_INCOMPLETE",
    message: issue.message,
    field: issue.field,
  }));
}

export async function validateIssueReadiness(input: {
  actorUserId: string;
  workspaceId: string;
  documentId: string;
}) {
  return db.$transaction((transaction) => validateIssueReadinessInTransaction(transaction, input), businessDataTransactionOptions);
}

export async function validateIssueReadinessInTransaction(
  transaction: Prisma.TransactionClient,
  input: { actorUserId: string; workspaceId: string; documentId: string },
  authorizedContext?: Awaited<ReturnType<typeof authorizeWorkspaceDocumentReadinessInTransaction>>,
) {
    const readinessContext = authorizedContext ?? await authorizeWorkspaceDocumentReadinessInTransaction({ actorUserId: input.actorUserId, workspaceId: input.workspaceId, capability: CAPABILITIES.ISSUE_DOCUMENT }, transaction);
    const membership = readinessContext.membership;
    const access = getDocumentAccessFilter(membership);
    const document = access ? await transaction.document.findFirst({
      where: { id: input.documentId, ...access, status: "DRAFT", archivedAt: null },
      include: { customer: true, workspace: true, lines: { include: { customRate: { select: { workspaceId: true } } } } },
    }) : null;
    if (!document) return { ready: false, errors: [{ code: "DRAFT_UNAVAILABLE", message: "The draft is unavailable for issue preparation." }] satisfies IssueReadinessError[] };

    const errors: IssueReadinessError[] = [];
    const taxPointDate = determineTaxPoint({ supplyDate: document.supplyDate ?? document.draftDate, documentDate: document.draftDate });
    const workspaceReadiness = evaluateWorkspaceDocumentReadiness({ workspace: readinessContext.workspace, documentType: document.type, taxPointDate, isSuperAdmin: readinessContext.isSuperAdmin });
    errors.push(...workspaceIssuesForIssuance(workspaceReadiness.issues));
    if (document.isTestDocument !== workspaceReadiness.isTestWorkspace) {
      errors.push({ code: "TEST_STATUS_INVALID", message: "The document TEST status does not match its workspace and cannot be changed." });
    }
    if (!["INVOICE", "RECEIPT", "VAT_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(document.type)) errors.push({ code: "UNSUPPORTED_TYPE", message: "This document type cannot be issued yet.", field: "type" });
    if (!document.lines.length) errors.push({ code: "NO_LINES", message: "Add at least one valid line item.", field: "lines" });
    if (!(document.customerName?.trim() || document.customer?.name)) errors.push({ code: "CUSTOMER_REQUIRED", message: "Enter a customer name before issuing this document.", field: "customerName" });
    if (document.grandTotal.lte(0) || document.subtotal.lt(0)) errors.push({ code: "INVALID_TOTAL", message: "The draft must have a positive, valid total.", field: "grandTotal" });
    if (document.dueDate && document.dueDate < document.draftDate) errors.push({ code: "INVALID_DATE", message: "The due date cannot be before the document date.", field: "dueDate" });
    if (document.lines.some((line) => line.customRate && line.customRate.workspaceId !== input.workspaceId)) errors.push({ code: "CUSTOM_RATE_UNAVAILABLE", message: "A custom rate does not belong to this workspace.", field: "lines" });
    if (document.lines.some((line) => line.taxTreatment !== "STANDARD_RATED" && !line.taxTreatmentReason?.trim())) errors.push({ code: "CLASSIFICATION_EVIDENCE_REQUIRED", message: "Every zero-rated or exempt line needs a classification reason.", field: "lines" });
    if (document.lines.some((line) => line.taxTreatment === "ZERO_RATED" && !line.taxTreatmentReference?.trim())) errors.push({ code: "CLASSIFICATION_EVIDENCE_REQUIRED", message: "Every zero-rated line needs a supporting reference.", field: "lines" });
    if (document.lines.some((line) => line.reliefApplied && (!line.reliefReason?.trim() || !line.reliefReference?.trim()))) errors.push({ code: "RELIEF_EVIDENCE_REQUIRED", message: "Every relieved line needs a reason and supporting reference.", field: "lines" });
    if (document.lines.some((line) => line.reliefApplied && line.taxTreatment !== "STANDARD_RATED")) errors.push({ code: "RELIEF_EVIDENCE_REQUIRED", message: "Relief may only be applied separately to a standard-rated line.", field: "lines" });
    if (document.type === "VAT_INVOICE" && document.lines.length > 0 && document.lines.every((line) => line.taxTreatment === "EXEMPT")) errors.push({ code: "VAT_INVOICE_EXEMPT_ONLY", message: "A VAT invoice cannot be issued when every supply is exempt. Use an ordinary invoice or receipt.", field: "type" });
    if (["CREDIT_NOTE", "DEBIT_NOTE"].includes(document.type) && (!document.originalDocumentId || !document.adjustmentReason?.trim())) errors.push({ code: "ADJUSTMENT_REFERENCE_REQUIRED", message: "An adjustment note must reference its original issued document and state a reason.", field: "originalDocumentId" });
    if (document.withholdingApplied && (!document.withholdingReference?.trim() || document.withholdingAmount.lte(0))) errors.push({ code: "WITHHOLDING_INVALID", message: "VAT withholding requires a certified amount and reference.", field: "withholdingReference" });
    try {
      const parsedTax = document.taxCalculation ? documentTaxSnapshotSchema.safeParse(document.taxCalculation) : null;
      if (parsedTax && !parsedTax.success) throw new Error("Invalid saved tax calculation.");
      const statutoryComponents = parsedTax?.success ? parsedTax.data.components.map((component) => ({ code: component.code, name: component.name, rate: component.rate, calculationOrder: component.order, baseStrategy: component.baseStrategy, contributesToTaxableValue: false, contributesToTotal: true })) : [];
      const adjustment = document.type === "CREDIT_NOTE" || document.type === "DEBIT_NOTE";
      const supplierVatEligible = adjustment ? statutoryComponents.length > 0 : isVatEligibleAtTaxPoint(readinessContext.workspace, taxPointDate);
      const recalculatedLines = document.lines.map((line) => calculateDocumentLine({ description: line.description, quantity: line.quantity.toString(), unitPrice: line.unitPrice.toString(), discountAmount: line.discountAmount.toString(), priceMode: document.priceMode, taxTreatment: line.taxTreatment, reliefApplied: line.reliefApplied, supplierVatEligible, statutoryComponents, rate: line.rateTypeSnapshot && line.rateValueSnapshot ? { type: line.rateTypeSnapshot, value: line.rateValueSnapshot.toString() } : null }));
      const totals = calculateDraftTotals(recalculatedLines);
      const withholding = calculateNetPayable(totals.grandTotal, document.withholdingApplied, document.withholdingAmount.toString());
      if (!totals.subtotal.eq(document.subtotal) || !totals.discountTotal.eq(document.discountTotal) || !totals.rateTotal.eq(document.rateTotal) || !totals.taxTotal.eq(document.taxTotal) || !totals.grandTotal.eq(document.grandTotal) || !withholding.netPayable.eq(document.netPayable)) errors.push({ code: "CALCULATION_INVALID", message: "Re-save the draft to refresh its authoritative calculation.", field: "lines" });
    } catch {
      errors.push({ code: "CALCULATION_INVALID", message: "The draft contains invalid financial values.", field: "lines" });
    }

    const needsCurrentTaxVersion = !["CREDIT_NOTE", "DEBIT_NOTE"].includes(document.type) && isVatEligibleAtTaxPoint(readinessContext.workspace, taxPointDate) && (document.type === "VAT_INVOICE" || document.lines.some((line) => line.taxTreatment === "STANDARD_RATED" && !line.reliefApplied));
    if (needsCurrentTaxVersion) {
      if (document.currency !== "GHS") errors.push({ code: "CURRENCY_MISMATCH", message: "Documents charging Ghana VAT-family taxes must use GHS.", field: "currency" });
      try {
        const version = await resolveGhanaVatVersion(taxPointDate, transaction);
        if (document.taxVersionId !== version.id || !document.taxCalculation) {
          errors.push({ code: "TAX_CALCULATION_STALE", message: "Re-save the draft to refresh its trusted Ghana VAT calculation.", field: "taxCalculation" });
        }
      } catch {
        errors.push({ code: "TRUSTED_TAX_UNAVAILABLE", message: "A valid trusted Ghana VAT configuration is not available for this date.", field: "draftDate" });
      }
    }
  return { ready: errors.length === 0, errors };
}
