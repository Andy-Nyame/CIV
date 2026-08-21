import "server-only";
import { notFound } from "next/navigation";
import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { db } from "@/lib/db";
import { resolveGhanaVatVersion } from "@/features/tax/resolver";
import { issuedDocumentSnapshotSchema } from "./snapshots";

export async function getDocumentsPageData(search = "") {
  const context = await requireCapability(CAPABILITIES.VIEW_OWN_DOCUMENTS);
  const access = getDocumentAccessFilter({ role: context.membership.role, userId: context.user.id, workspaceId: context.workspace.id });
  const query = search.trim().slice(0, 100);
  const documents = access ? await db.document.findMany({ where: { ...access, archivedAt: null, status: { in: ["DRAFT", "ISSUED"] }, ...(query ? { OR: [{ draftReference: { contains: query, mode: "insensitive" } }, { documentNumber: { contains: query, mode: "insensitive" } }, { customer: { name: { contains: query, mode: "insensitive" } } }] } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, draftReference: true, documentNumber: true, type: true, status: true, currency: true, grandTotal: true, draftDate: true, issuedAt: true, updatedAt: true, customer: { select: { name: true } }, createdBy: { select: { name: true, email: true } }, issuedBy: { select: { name: true, email: true } } } }) : [];
  return { context, documents };
}

export async function getDocumentRecordPageData(documentId: string) {
  const context = await requireCapability(CAPABILITIES.VIEW_OWN_DOCUMENTS);
  const access = getDocumentAccessFilter({ role: context.membership.role, userId: context.user.id, workspaceId: context.workspace.id });
  const document = access ? await db.document.findFirst({
    where: { id: documentId, ...access, archivedAt: null },
    include: { snapshot: true },
  }) : null;
  if (!document || (document.status !== "DRAFT" && document.status !== "ISSUED")) notFound();
  if (document.status === "ISSUED") {
    if (!document.snapshot) throw new Error("The issued document snapshot is unavailable.");
    return { context, document, snapshot: issuedDocumentSnapshotSchema.parse(document.snapshot.payload) } as const;
  }
  return { context, document, snapshot: null } as const;
}

export async function getVaultIssuedRecords() {
  const context = await requireCapability(CAPABILITIES.VIEW_VAULT);
  const access = getDocumentAccessFilter({ role: context.membership.role, userId: context.user.id, workspaceId: context.workspace.id });
  const records = access ? await db.document.findMany({
    where: { ...access, status: "ISSUED", archivedAt: null, snapshot: { isNot: null } },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, documentNumber: true, type: true, currency: true, grandTotal: true, issuedAt: true, customer: { select: { name: true } } },
  }) : [];
  return { context, records };
}

export async function getDraftEditorData(documentId?: string) {
  const context = await requireCapability(documentId ? CAPABILITIES.UPDATE_DRAFT_DOCUMENT : CAPABILITIES.CREATE_DOCUMENT);
  const access = getDocumentAccessFilter({ role: context.membership.role, userId: context.user.id, workspaceId: context.workspace.id });
  const document = documentId && access ? await db.document.findFirst({ where: { id: documentId, ...access, status: "DRAFT", archivedAt: null }, include: { lines: { orderBy: { lineOrder: "asc" } } } }) : null;
  if (documentId && !document) notFound();
  const existingCatalogueItemIds = document?.lines.flatMap(({ catalogItemId }) => catalogItemId ? [catalogItemId] : []) ?? [];
  const existingRateIds = document?.lines.flatMap(({ customRateId }) => customRateId ? [customRateId] : []) ?? [];
  const relevantDate = document?.draftDate ?? new Date();
  const [customers, items, rates, trustedTaxVersion] = await Promise.all([
    db.customer.findMany({ where: { workspaceId: context.workspace.id, ...(document?.customerId ? { OR: [{ archivedAt: null }, { id: document.customerId }] } : { archivedAt: null }) }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }),
    db.itemService.findMany({ where: { workspaceId: context.workspace.id, OR: [{ archivedAt: null }, { id: { in: existingCatalogueItemIds } }] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, description: true, unitPrice: true, currency: true, unitLabel: true } }),
    db.customRate.findMany({ where: { workspaceId: context.workspace.id, OR: [{ isActive: true }, { id: { in: existingRateIds } }] }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true, type: true, value: true } }),
    resolveGhanaVatVersion(relevantDate),
  ]);
  return { context, customers, items, rates, document, trustedTaxVersion };
}
