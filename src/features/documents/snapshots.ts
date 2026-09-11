import "server-only";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { businessDataTransactionOptions } from "@/features/business-data/locking";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { z } from "zod";

const moneySchema = z.string().regex(/^\d+\.\d{2}$/);
const nullableText = z.string().nullable();
const taxComponentSnapshotSchema = z.object({
  code: z.string().min(1).max(100), name: z.string().min(1).max(200),
  rate: z.string().regex(/^\d+(\.\d{1,6})?$/), order: z.number().int().nonnegative(),
  baseStrategy: z.enum(["ORIGINAL_BASE", "BASE_PLUS_APPLICABLE_LEVIES"]),
  calculationBase: moneySchema, amount: moneySchema,
}).strict();

export const documentTaxSnapshotSchema = z.object({
  profile: z.object({ jurisdiction: z.string().length(2), code: z.string().min(1).max(100), name: z.string().min(1).max(200) }).strict(),
  version: z.object({ id: z.string().uuid(), code: z.string().min(1).max(50), effectiveFrom: z.string().date(), effectiveTo: z.string().date().nullable() }).strict(),
  base: moneySchema, taxableValue: moneySchema, taxTotal: moneySchema, grossTotal: moneySchema,
  components: z.array(taxComponentSnapshotSchema).min(1).max(20),
}).strict();

export const issuedDocumentSnapshotSchema = z.object({
  snapshotVersion: z.literal(1),
  document: z.object({
    id: z.string().uuid(), draftReference: z.string().min(8).max(40),
    documentNumber: z.string().min(5).max(100), type: z.enum(["INVOICE", "RECEIPT", "VAT_INVOICE"]),
    status: z.literal("ISSUED"), currency: z.string().length(3), issueDate: z.string().date(),
    issuedAt: z.string().datetime(), dueDate: z.string().date().nullable(), notes: z.string().nullable(),
    isTestDocument: z.boolean().optional().default(false),
  }).strict(),
  issuer: z.object({
    workspaceId: z.string().uuid(), displayName: z.string().min(1).max(200),
    issuerType: z.enum(["INDIVIDUAL", "BUSINESS", "ORGANIZATION"]), country: z.string().length(2), currency: z.string().length(3),
    legalName: nullableText.optional().default(null), tradingName: nullableText.optional().default(null),
    email: nullableText, phone: nullableText, address: nullableText, registrationNumber: nullableText, businessTin: nullableText,
    taxpayerIdType: z.enum(["GHANA_CARD_PIN", "GRA_TIN"]).nullable().optional().default(null),
    taxpayerId: nullableText.optional().default(null),
    taxpayerVerificationStatus: z.enum(["UNVERIFIED", "VERIFIED"]).nullable().optional().default(null),
    vatRegistered: z.boolean().nullable().optional().default(null),
    logo: z.object({ storageKey: z.string().min(1).max(1024), mimeType: z.string().min(1).max(50), width: z.number().int().positive(), height: z.number().int().positive(), checksum: z.string().length(64) }).strict().nullable(),
  }).strict(),
  customer: z.object({ id: z.string().uuid().nullable(), name: z.string().min(1).max(200), email: nullableText, phone: nullableText, address: nullableText, businessTin: nullableText }).strict().nullable(),
  lines: z.array(z.object({
    order: z.number().int().positive(), description: z.string().min(1).max(2_000), quantity: z.string().regex(/^\d+(\.\d{1,6})?$/),
    unitPrice: moneySchema, subtotal: moneySchema,
    customRate: z.object({ name: z.string().nullable(), type: z.enum(["PERCENTAGE", "FIXED"]), value: z.string().regex(/^\d+(\.\d{1,6})?$/), amount: moneySchema }).strict().nullable(),
    total: moneySchema,
  }).strict()).min(1).max(100),
  tax: documentTaxSnapshotSchema.nullable(),
  totals: z.object({ subtotal: moneySchema, discount: moneySchema, customRates: moneySchema, taxableValue: moneySchema, trustedTax: moneySchema, grandTotal: moneySchema }).strict(),
  issuedBy: z.object({ userId: z.string().uuid(), displayName: z.string().min(1).max(320) }).strict(),
  presentation: z.object({ template: z.null(), signature: z.null() }).strict(),
  verification: z.object({ code: z.string().min(1).max(200) }).strict().nullable().optional().default(null),
}).strict();

export type IssuedDocumentSnapshot = z.infer<typeof issuedDocumentSnapshotSchema>;

export function buildCustomerSnapshot(document: {
  customerId: string | null; customerName: string | null; customerEmail: string | null;
  customerPhone: string | null; customerAddress: string | null; customerBusinessTin: string | null;
  customer: { id: string; name: string; email: string | null; phone: string | null; address: string | null; businessTin: string | null } | null;
}) {
  const name = document.customerName?.trim() || document.customer?.name;
  return name ? {
    id: document.customerId ?? document.customer?.id ?? null,
    name,
    email: document.customerEmail ?? document.customer?.email ?? null,
    phone: document.customerPhone ?? document.customer?.phone ?? null,
    address: document.customerAddress ?? document.customer?.address ?? null,
    businessTin: document.customerBusinessTin ?? document.customer?.businessTin ?? null,
  } : null;
}

export function buildIssuerSnapshot(workspace: {
  id: string; name: string; type: "INDIVIDUAL" | "BUSINESS" | "ORGANIZATION"; country: string; currency: string;
  legalName?: string | null; tradingName?: string | null;
  email: string | null; phone: string | null; address: string | null;
  registrationNumber: string | null; businessTin: string | null;
  taxpayerIdType?: "GHANA_CARD_PIN" | "GRA_TIN" | null; taxpayerId?: string | null;
  taxpayerVerificationStatus?: "UNVERIFIED" | "VERIFIED" | null; vatRegistered?: boolean | null;
  logo: { storageKey: string; mimeType: string; width: number; height: number; checksum: string } | null;
}) {
  return {
    workspaceId: workspace.id,
    displayName: workspace.name,
    issuerType: workspace.type,
    country: workspace.country,
    currency: workspace.currency,
    legalName: workspace.legalName ?? null,
    tradingName: workspace.tradingName ?? null,
    email: workspace.email,
    phone: workspace.phone,
    address: workspace.address,
    registrationNumber: workspace.registrationNumber,
    businessTin: workspace.businessTin,
    taxpayerIdType: workspace.taxpayerIdType ?? null,
    taxpayerId: workspace.taxpayerId ?? null,
    taxpayerVerificationStatus: workspace.taxpayerVerificationStatus ?? null,
    vatRegistered: workspace.vatRegistered ?? null,
    logo: workspace.logo ? { ...workspace.logo } : null,
  };
}

export function buildLineSnapshots(lines: Array<{
  description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal; rateNameSnapshot: string | null;
  rateTypeSnapshot: "PERCENTAGE" | "FIXED" | null; rateValueSnapshot: Prisma.Decimal | null;
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

export function buildIssuedDocumentSnapshot(input: {
  document: {
    id: string; draftReference: string; type: "INVOICE" | "RECEIPT" | "VAT_INVOICE"; currency: string;
    isTestDocument: boolean;
    draftDate: Date; dueDate: Date | null; notes: string | null; taxCalculation: Prisma.JsonValue | null;
    subtotal: Prisma.Decimal; discountTotal: Prisma.Decimal; rateTotal: Prisma.Decimal; taxableValue: Prisma.Decimal; taxTotal: Prisma.Decimal; grandTotal: Prisma.Decimal;
    workspace: Parameters<typeof buildIssuerSnapshot>[0];
    customerId: string | null; customerName: string | null; customerEmail: string | null;
    customerPhone: string | null; customerAddress: string | null; customerBusinessTin: string | null;
    customer: Parameters<typeof buildCustomerSnapshot>[0]["customer"];
    lines: Parameters<typeof buildLineSnapshots>[0];
  };
  documentNumber: string;
  verificationCode: string;
  issuedAt: Date;
  actor: { id: string; name: string | null; email: string | null };
}) {
  const payload = {
    snapshotVersion: 1,
    document: {
      id: input.document.id,
      draftReference: input.document.draftReference,
      documentNumber: input.documentNumber,
      type: input.document.type,
      status: "ISSUED",
      currency: input.document.currency,
      issueDate: input.document.draftDate.toISOString().slice(0, 10),
      issuedAt: input.issuedAt.toISOString(),
      dueDate: input.document.dueDate?.toISOString().slice(0, 10) ?? null,
      notes: input.document.notes,
      isTestDocument: input.document.isTestDocument,
    },
    issuer: buildIssuerSnapshot(input.document.workspace),
    customer: buildCustomerSnapshot(input.document),
    lines: buildLineSnapshots(input.document.lines),
    tax: input.document.type === "VAT_INVOICE" ? input.document.taxCalculation : null,
    totals: {
      subtotal: input.document.subtotal.toFixed(2),
      discount: input.document.discountTotal.toFixed(2),
      customRates: input.document.type === "VAT_INVOICE" ? "0.00" : input.document.rateTotal.toFixed(2),
      taxableValue: input.document.taxableValue.toFixed(2),
      trustedTax: input.document.taxTotal.toFixed(2),
      grandTotal: input.document.grandTotal.toFixed(2),
    },
    issuedBy: { userId: input.actor.id, displayName: input.actor.name?.trim() || input.actor.email || "Workspace member" },
    presentation: { template: null, signature: null },
    verification: { code: input.verificationCode },
  };
  return issuedDocumentSnapshotSchema.parse(payload);
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
      customer: buildCustomerSnapshot(document),
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
  }, businessDataTransactionOptions);
}
