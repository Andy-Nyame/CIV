import "server-only";
import { notFound } from "next/navigation";
import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { db } from "@/lib/db";
import { resolveGhanaVatVersion, resolveOptionalGhanaVatVersion } from "@/features/tax/resolver";
import { issuedDocumentSnapshotSchema } from "./snapshots";
import { getWorkspaceDocumentReadiness } from "@/features/workspaces/document-readiness-service";

export async function getDocumentsPageData(search = "") {
  const context = await requireCapability(CAPABILITIES.VIEW_OWN_DOCUMENTS);
  const access = getDocumentAccessFilter({ role: context.membership.role, userId: context.user.id, workspaceId: context.workspace.id });
  const query = search.trim().slice(0, 100);
  const [documents, creationReadiness, vatCreationReadiness] = await Promise.all([
    access ? db.document.findMany({ where: { ...access, archivedAt: null, status: { in: ["DRAFT", "ISSUED", "VOIDED"] }, ...(query ? { OR: [{ draftReference: { contains: query, mode: "insensitive" } }, { documentNumber: { contains: query, mode: "insensitive" } }, { customerName: { contains: query, mode: "insensitive" } }, { customer: { name: { contains: query, mode: "insensitive" } } }] } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, draftReference: true, documentNumber: true, type: true, status: true, isTestDocument: true, currency: true, grandTotal: true, draftDate: true, issuedAt: true, updatedAt: true, customerName: true, customer: { select: { name: true } }, createdBy: { select: { name: true, email: true } }, issuedBy: { select: { name: true, email: true } } } }) : [],
    getWorkspaceDocumentReadiness({ actorUserId: context.user.id, workspaceId: context.workspace.id }),
    getWorkspaceDocumentReadiness({ actorUserId: context.user.id, workspaceId: context.workspace.id, documentType: "VAT_INVOICE" }),
  ]);
  return { context, documents, creationReadiness, vatCreationReadiness };
}

export async function getDocumentRecordPageData(documentId: string) {
  const context = await requireCapability(CAPABILITIES.VIEW_OWN_DOCUMENTS);
  const access = getDocumentAccessFilter({ role: context.membership.role, userId: context.user.id, workspaceId: context.workspace.id });
  const document = access ? await db.document.findFirst({
    where: { id: documentId, ...access, archivedAt: null },
    include: { snapshot: true },
  }) : null;
  if (!document || !["DRAFT", "ISSUED", "VOIDED"].includes(document.status)) notFound();
  if (document.status === "ISSUED" || document.status === "VOIDED") {
    if (!document.snapshot) throw new Error("The issued document snapshot is unavailable.");
    return { context, document, snapshot: issuedDocumentSnapshotSchema.parse(document.snapshot.payload) } as const;
  }
  return { context, document, snapshot: null } as const;
}

export async function getVaultIssuedRecords() {
  const context = await requireCapability(CAPABILITIES.VIEW_VAULT);
  const access = getDocumentAccessFilter({ role: context.membership.role, userId: context.user.id, workspaceId: context.workspace.id });
  const records = access ? await db.document.findMany({
    where: { ...access, status: { in: ["ISSUED", "VOIDED"] }, archivedAt: null, snapshot: { isNot: null } },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, documentNumber: true, type: true, status: true, isTestDocument: true, currency: true, grandTotal: true, issuedAt: true, customerName: true, customer: { select: { name: true } } },
  }) : [];
  return { context, records };
}

export async function listWorkspaceCustomerSuggestions(workspaceId: string, currentCustomerId?: string | null) {
  return db.customer.findMany({
    where: {
      workspaceId,
      ...(currentCustomerId ? { OR: [{ archivedAt: null }, { id: currentCustomerId }] } : { archivedAt: null }),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 200,
    select: { id: true, name: true, address: true, taxpayerIdType: true, taxpayerId: true, vatRegistrationStatus: true, taxStatus: true },
  });
}

export async function getDraftEditorData(
  documentId?: string,
  requestedType?: "INVOICE" | "RECEIPT" | "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE",
) {
  const context = await requireCapability(documentId ? CAPABILITIES.UPDATE_DRAFT_DOCUMENT : CAPABILITIES.CREATE_DOCUMENT);
  const access = getDocumentAccessFilter({ role: context.membership.role, userId: context.user.id, workspaceId: context.workspace.id });
  const document = documentId && access ? await db.document.findFirst({ where: { id: documentId, ...access, status: "DRAFT", archivedAt: null }, include: { customer: true, paymentEvents: { orderBy: { eventOrder: "asc" } }, lines: { orderBy: { lineOrder: "asc" } } } }) : null;
  if (documentId && !document) notFound();
  const existingCatalogueItemIds = document?.lines.flatMap(({ catalogItemId }) => catalogItemId ? [catalogItemId] : []) ?? [];
  const existingRateIds = document?.lines.flatMap(({ customRateId }) => customRateId ? [customRateId] : []) ?? [];
  const relevantDate = document?.draftDate ?? new Date();
  const requiresVat = document?.type === "VAT_INVOICE" || requestedType === "VAT_INVOICE";
  const [customers, items, rates, trustedTaxVersion, creationReadiness, vatCreationReadiness, workspaceTaxState, originalDocuments] = await Promise.all([
    listWorkspaceCustomerSuggestions(context.workspace.id, document?.customerId),
    db.itemService.findMany({ where: { workspaceId: context.workspace.id, OR: [{ archivedAt: null }, { id: { in: existingCatalogueItemIds } }] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, description: true, unitPrice: true, currency: true, unitLabel: true, defaultTaxTreatment: true, taxTreatmentReason: true, taxTreatmentReference: true } }),
    db.customRate.findMany({ where: { workspaceId: context.workspace.id, OR: [{ isActive: true }, { id: { in: existingRateIds } }] }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true, type: true, value: true } }),
    requiresVat
      ? resolveGhanaVatVersion(relevantDate)
      : resolveOptionalGhanaVatVersion(relevantDate),
    getWorkspaceDocumentReadiness({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      documentType: document?.type ?? requestedType,
      taxPointDate: relevantDate,
    }),
    getWorkspaceDocumentReadiness({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      documentType: "VAT_INVOICE",
      taxPointDate: relevantDate,
    }),
    db.workspace.findUniqueOrThrow({ where: { id: context.workspace.id }, select: { environment: true, vatRegistrationStatus: true, vatRegistrationEffectiveDate: true, vatDeregistrationEffectiveDate: true, vatSalesReceiptAuthorization: true } }),
    db.document.findMany({
      where: { workspaceId: context.workspace.id, status: "ISSUED", archivedAt: null, type: { in: ["INVOICE", "RECEIPT", "VAT_INVOICE"] } },
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { id: true, documentNumber: true, type: true, issueDate: true, currency: true },
    }),
  ]);
  return { context, customers, items, rates, document, trustedTaxVersion, creationReadiness, vatCreationReadiness, workspaceTaxState, originalDocuments };
}
