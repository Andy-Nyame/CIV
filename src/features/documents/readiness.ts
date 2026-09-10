import "server-only";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { businessDataTransactionOptions } from "@/features/business-data/locking";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { calculateTrustedTax } from "@/features/tax/calculation";
import { resolveGhanaVatVersion } from "@/features/tax/resolver";
import { calculateDraftLine, calculateDraftTotals } from "./calculations";
import { authorizeWorkspaceDocumentReadinessInTransaction } from "@/features/workspaces/document-readiness-service";
import type { WorkspaceReadinessIssue } from "@/features/workspaces/document-readiness";
import { evaluateWorkspaceDocumentReadiness } from "@/features/workspaces/document-readiness";

export type IssueReadinessCode =
  | "DRAFT_UNAVAILABLE" | "UNSUPPORTED_TYPE" | "NO_LINES" | "INVALID_TOTAL" | "INVALID_DATE"
  | "CURRENCY_MISMATCH" | "CUSTOM_RATE_UNAVAILABLE" | "CUSTOMER_REQUIRED" | "CALCULATION_INVALID"
  | "WORKSPACE_SETUP_INCOMPLETE" | "VAT_REGISTRATION_REQUIRED" | "TEST_WORKSPACE_ACCESS_REQUIRED"
  | "TEST_STATUS_INVALID" | "TRUSTED_TAX_UNAVAILABLE" | "TAX_CALCULATION_STALE";

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
    const workspaceReadiness = evaluateWorkspaceDocumentReadiness({ workspace: readinessContext.workspace, documentType: document.type, isSuperAdmin: readinessContext.isSuperAdmin });
    errors.push(...workspaceIssuesForIssuance(workspaceReadiness.issues));
    if (document.isTestDocument !== workspaceReadiness.isTestWorkspace) {
      errors.push({ code: "TEST_STATUS_INVALID", message: "The document TEST status does not match its workspace and cannot be changed." });
    }
    if (!["INVOICE", "RECEIPT", "VAT_INVOICE"].includes(document.type)) errors.push({ code: "UNSUPPORTED_TYPE", message: "This document type cannot be issued yet.", field: "type" });
    if (!document.lines.length) errors.push({ code: "NO_LINES", message: "Add at least one valid line item.", field: "lines" });
    if (!(document.customerName?.trim() || document.customer?.name)) errors.push({ code: "CUSTOMER_REQUIRED", message: "Enter a customer name before issuing this document.", field: "customerName" });
    if (document.grandTotal.lte(0) || document.subtotal.lt(0)) errors.push({ code: "INVALID_TOTAL", message: "The draft must have a positive, valid total.", field: "grandTotal" });
    if (document.dueDate && document.dueDate < document.draftDate) errors.push({ code: "INVALID_DATE", message: "The due date cannot be before the document date.", field: "dueDate" });
    if (document.lines.some((line) => line.customRate && line.customRate.workspaceId !== input.workspaceId)) errors.push({ code: "CUSTOM_RATE_UNAVAILABLE", message: "A custom rate does not belong to this workspace.", field: "lines" });
    try {
      const recalculatedLines = document.lines.map((line) => calculateDraftLine({ description: line.description, quantity: line.quantity.toString(), unitPrice: line.unitPrice.toString(), rate: line.rateTypeSnapshot && line.rateValueSnapshot ? { type: line.rateTypeSnapshot, value: line.rateValueSnapshot.toString() } : null }));
      const totals = calculateDraftTotals(recalculatedLines);
      if (!totals.subtotal.eq(document.subtotal) || document.type !== "VAT_INVOICE" && (!totals.rateTotal.eq(document.rateTotal) || !totals.grandTotal.eq(document.grandTotal))) errors.push({ code: "CALCULATION_INVALID", message: "Re-save the draft to refresh its authoritative calculation.", field: "lines" });
    } catch {
      errors.push({ code: "CALCULATION_INVALID", message: "The draft contains invalid financial values.", field: "lines" });
    }

    if (document.type === "VAT_INVOICE") {
      if (document.currency !== "GHS") errors.push({ code: "CURRENCY_MISMATCH", message: "Ghana VAT invoices must use GHS.", field: "currency" });
      try {
        const version = await resolveGhanaVatVersion(document.draftDate, transaction);
        const calculated = calculateTrustedTax(document.subtotal, version.components);
        if (document.taxVersionId !== version.id || !document.taxCalculation || !new Prisma.Decimal(calculated.grossTotal).eq(document.grandTotal) || !new Prisma.Decimal(calculated.taxTotal).eq(document.taxTotal)) {
          errors.push({ code: "TAX_CALCULATION_STALE", message: "Re-save the draft to refresh its trusted Ghana VAT calculation.", field: "taxCalculation" });
        }
      } catch {
        errors.push({ code: "TRUSTED_TAX_UNAVAILABLE", message: "A valid trusted Ghana VAT configuration is not available for this date.", field: "draftDate" });
      }
    }
  return { ready: errors.length === 0, errors };
}
