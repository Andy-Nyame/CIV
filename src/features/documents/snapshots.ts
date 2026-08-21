import "server-only";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export function buildCustomerSnapshot(customer: {
  id: string; name: string; email: string | null; phone: string | null;
  address: string | null; businessTin: string | null;
} | null) {
  return customer ? {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    businessTin: customer.businessTin,
  } : null;
}

export function buildIssuerSnapshot(workspace: {
  id: string; name: string; type: string; country: string; currency: string;
  email: string | null; phone: string | null; address: string | null;
  registrationNumber: string | null; businessTin: string | null;
  logo: { storageKey: string; mimeType: string; width: number; height: number; checksum: string } | null;
}) {
  return {
    workspaceId: workspace.id,
    displayName: workspace.name,
    issuerType: workspace.type,
    country: workspace.country,
    currency: workspace.currency,
    email: workspace.email,
    phone: workspace.phone,
    address: workspace.address,
    registrationNumber: workspace.registrationNumber,
    businessTin: workspace.businessTin,
    logo: workspace.logo ? { ...workspace.logo } : null,
  };
}

export function buildLineSnapshots(lines: Array<{
  description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal; rateNameSnapshot: string | null;
  rateTypeSnapshot: string | null; rateValueSnapshot: Prisma.Decimal | null;
  rateTotal: Prisma.Decimal; lineTotal: Prisma.Decimal; lineOrder: number;
}>) {
  return lines.map((line) => ({
    order: line.lineOrder,
    description: line.description,
    quantity: line.quantity.toString(),
    unitPrice: line.unitPrice.toFixed(2),
    subtotal: line.lineSubtotal.toFixed(2),
    customRate: line.rateTypeSnapshot && line.rateValueSnapshot ? {
      name: line.rateNameSnapshot,
      type: line.rateTypeSnapshot,
      value: line.rateValueSnapshot.toString(),
      amount: line.rateTotal.toFixed(2),
    } : null,
    total: line.lineTotal.toFixed(2),
  }));
}

export async function buildFutureDocumentSnapshot(input: {
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
      include: {
        customer: true,
        workspace: { include: { logo: true } },
        lines: { orderBy: { lineOrder: "asc" } },
      },
    }) : null;
    if (!document) throw new Error("Draft is unavailable for issue preparation.");

    return {
      snapshotVersion: 1,
      document: {
        id: document.id,
        draftReference: document.draftReference,
        type: document.type,
        currency: document.currency,
        draftDate: document.draftDate.toISOString().slice(0, 10),
        dueDate: document.dueDate?.toISOString().slice(0, 10) ?? null,
        notes: document.notes,
      },
      issuer: buildIssuerSnapshot(document.workspace),
      customer: buildCustomerSnapshot(document.customer),
      lines: buildLineSnapshots(document.lines),
      tax: document.taxCalculation,
      totals: {
        subtotal: document.subtotal.toFixed(2),
        discount: document.discountTotal.toFixed(2),
        customRates: document.type === "VAT_INVOICE" ? "0.00" : document.rateTotal.toFixed(2),
        taxableValue: document.taxableValue.toFixed(2),
        trustedTax: document.taxTotal.toFixed(2),
        grandTotal: document.grandTotal.toFixed(2),
      },
    } as const;
  });
}
