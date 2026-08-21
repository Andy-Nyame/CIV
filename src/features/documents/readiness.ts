import "server-only";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { calculateTrustedTax } from "@/features/tax/calculation";
import { resolveGhanaVatVersion } from "@/features/tax/resolver";
import { calculateDraftLine, calculateDraftTotals } from "./calculations";

export type IssueReadinessCode =
  | "DRAFT_UNAVAILABLE" | "NO_LINES" | "INVALID_TOTAL" | "INVALID_DATE"
  | "CURRENCY_MISMATCH" | "CUSTOM_RATE_UNAVAILABLE" | "CUSTOMER_REQUIRED" | "CALCULATION_INVALID"
  | "ISSUER_TIN_REQUIRED" | "TRUSTED_TAX_UNAVAILABLE" | "TAX_CALCULATION_STALE";

export type IssueReadinessError = { code: IssueReadinessCode; message: string; field?: string };

export async function validateIssueReadiness(input: {
  actorUserId: string;
  workspaceId: string;
  documentId: string;
}) {
  return db.$transaction(async (transaction) => {
    const membership = await requireWorkspaceCapabilityInTransaction(
      transaction, input.actorUserId, input.workspaceId, CAPABILITIES.ISSUE_DOCUMENT,
    );
    const access = getDocumentAccessFilter(membership);
    const document = access ? await transaction.document.findFirst({
      where: { id: input.documentId, ...access, status: "DRAFT", archivedAt: null },
      include: { customer: true, workspace: true, lines: { include: { customRate: { select: { workspaceId: true } } } } },
    }) : null;
    if (!document) return { ready: false, errors: [{ code: "DRAFT_UNAVAILABLE", message: "The draft is unavailable for issue preparation." }] satisfies IssueReadinessError[] };

    const errors: IssueReadinessError[] = [];
    if (!document.lines.length) errors.push({ code: "NO_LINES", message: "Add at least one valid line item.", field: "lines" });
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
      if (!document.customer) errors.push({ code: "CUSTOMER_REQUIRED", message: "Select a customer before issuing a VAT invoice.", field: "customerId" });
      if (!document.workspace.businessTin?.trim()) errors.push({ code: "ISSUER_TIN_REQUIRED", message: "Add the workspace TIN before issuing a VAT invoice.", field: "businessTin" });
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
  });
}
