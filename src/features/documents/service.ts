import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { requireDocumentAccessInTransaction, requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { BusinessDataConflictError, BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions, lockBusinessResource } from "@/features/business-data/locking";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireWorkspaceDocumentReadinessInTransaction } from "@/features/workspaces/document-readiness-service";
import { calculateTrustedTax } from "@/features/tax/calculation";
import { resolveDocumentTaxVersion } from "@/features/tax/resolver";
import { buildTaxSnapshot } from "@/features/tax/snapshot";
import { calculateDraftLine, calculateDraftTotals } from "./calculations";
import { documentIdSchema, draftInputSchema } from "./validation";

function draftReference() { return `DRAFT-${randomBytes(6).toString("hex").toUpperCase()}`; }

type DraftCustomerInput = {
  customerId: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerBusinessTin?: string | null;
};

type StoredDraftCustomer = {
  customerId: string | null; customerName: string | null; customerEmail: string | null;
  customerPhone: string | null; customerAddress: string | null; customerBusinessTin: string | null;
};

type CustomerAutoSave = (input: { actorUserId: string; workspaceId: string; documentId: string }) => Promise<string | null>;
type DraftServiceOptions = { autoSaveCustomer?: CustomerAutoSave };

async function resolveDraftCustomer(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  customer: DraftCustomerInput,
  existing?: StoredDraftCustomer,
): Promise<StoredDraftCustomer> {
  const sameName = existing?.customerName?.trim().toLowerCase() === customer.customerName.toLowerCase();
  if (!customer.customerId) return {
    customerId: null,
    customerName: customer.customerName,
    customerEmail: customer.customerEmail !== undefined ? customer.customerEmail : sameName ? existing.customerEmail : null,
    customerPhone: customer.customerPhone !== undefined ? customer.customerPhone : sameName ? existing.customerPhone : null,
    customerAddress: customer.customerAddress !== undefined ? customer.customerAddress : sameName ? existing.customerAddress : null,
    customerBusinessTin: customer.customerBusinessTin !== undefined ? customer.customerBusinessTin : sameName ? existing.customerBusinessTin : null,
  };
  const saved = await tx.customer.findFirst({
    where: { id: customer.customerId, workspaceId, ...(customer.customerId === existing?.customerId ? {} : { archivedAt: null }) },
    select: { id: true, name: true, email: true, phone: true, address: true, businessTin: true },
  });
  if (!saved) throw new BusinessDataValidationError({ customerId: ["Customer is unavailable."] });
  const preserveExisting = customer.customerId === existing?.customerId && sameName;
  return {
    customerId: saved.id,
    customerName: customer.customerName,
    customerEmail: customer.customerEmail !== undefined ? customer.customerEmail : preserveExisting ? existing.customerEmail : saved.email,
    customerPhone: customer.customerPhone !== undefined ? customer.customerPhone : preserveExisting ? existing.customerPhone : saved.phone,
    customerAddress: customer.customerAddress !== undefined ? customer.customerAddress : preserveExisting ? existing.customerAddress : saved.address,
    customerBusinessTin: customer.customerBusinessTin !== undefined ? customer.customerBusinessTin : preserveExisting ? existing.customerBusinessTin : saved.businessTin,
  };
}

export async function autoSaveDocumentCustomer(input: {
  actorUserId: string;
  workspaceId: string;
  documentId: string;
}) {
  return db.$transaction(async (tx) => {
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.CREATE_DOCUMENT);
    const document = await tx.document.findFirst({
      where: { id: input.documentId, workspaceId: input.workspaceId, status: "DRAFT", archivedAt: null },
      select: { customerId: true, customerName: true, customerEmail: true, customerPhone: true, customerAddress: true, customerBusinessTin: true },
    });
    if (!document?.customerName || document.customerId) return document?.customerId ?? null;

    const normalizedIdentity = document.customerName.trim().toLowerCase();
    const identityLock = createHash("sha256").update(normalizedIdentity).digest("hex");
    await lockBusinessResource(tx, `document-customer:${input.workspaceId}:${identityLock}`);

    const existing = await tx.customer.findFirst({
      where: {
        workspaceId: input.workspaceId,
        archivedAt: null,
        name: { equals: document.customerName, mode: "insensitive" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const customer = existing ?? await tx.customer.create({
      data: {
        workspaceId: input.workspaceId,
        createdByUserId: input.actorUserId,
        name: document.customerName,
        email: document.customerEmail,
        phone: document.customerPhone,
        address: document.customerAddress,
        businessTin: document.customerBusinessTin,
      },
      select: { id: true },
    });
    if (!existing) await recordAuditEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "CUSTOMER_CREATED",
      resourceType: AUDIT_RESOURCE_TYPES.CUSTOMER,
      resourceId: customer.id,
      metadata: { customerName: document.customerName },
    });
    await tx.document.updateMany({
      where: { id: input.documentId, workspaceId: input.workspaceId, status: "DRAFT", archivedAt: null, customerId: null },
      data: { customerId: customer.id },
    });
    return customer.id;
  }, businessDataTransactionOptions);
}

async function attachReusableCustomer<T extends { id: string; customerId: string | null; customerName: string | null }>(
  document: T,
  input: { actorUserId: string; workspaceId: string },
  options: DraftServiceOptions,
) {
  if (document.customerId || !document.customerName) return document;
  try {
    const customerId = await (options.autoSaveCustomer ?? autoSaveDocumentCustomer)({ ...input, documentId: document.id });
    return customerId ? { ...document, customerId } : document;
  } catch {
    // The document is already safely persisted. Reusable-contact saving is best effort.
    return document;
  }
}

async function prepareLines(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  currency: string,
  lines: ReturnType<typeof draftInputSchema.parse>["lines"],
  existingReferences: { catalogueItemIds: Set<string>; rateIds: Set<string>; lines: Map<string, { customRateId: string | null; rateNameSnapshot: string | null; rateTypeSnapshot: "PERCENTAGE" | "FIXED" | null; rateValueSnapshot: Prisma.Decimal | null }> } = { catalogueItemIds: new Set(), rateIds: new Set(), lines: new Map() },
) {
  const catalogueIds = [...new Set(lines.flatMap((line) => line.catalogItemId ? [line.catalogItemId] : []))];
  const rateIds = [...new Set(lines.flatMap((line) => line.customRateId ? [line.customRateId] : []))];
  // Interactive transactions use one checked-out pg client. Keep its queries
  // sequential so node-postgres never receives overlapping client.query calls.
  const items = await tx.itemService.findMany({ where: { id: { in: catalogueIds }, workspaceId, OR: [{ archivedAt: null }, { id: { in: [...existingReferences.catalogueItemIds] } }] } });
  const rates = await tx.customRate.findMany({ where: { id: { in: rateIds }, workspaceId, OR: [{ isActive: true }, { id: { in: [...existingReferences.rateIds] } }] } });
  if (items.length !== catalogueIds.length) throw new BusinessDataValidationError({ lines: ["A selected catalogue item is unavailable."] });
  const itemIds = new Set(items.map(({ id }) => id)); const itemMap = new Map(items.map((item) => [item.id, item])); const rateMap = new Map(rates.map((rate) => [rate.id, rate]));
  const prepared = lines.map((line, index) => {
    if (line.catalogItemId && !itemIds.has(line.catalogItemId)) throw new BusinessDataValidationError({ lines: ["A selected catalogue entry is invalid."] });
    if (line.catalogItemId && itemMap.get(line.catalogItemId)?.currency !== currency) throw new BusinessDataValidationError({ lines: ["Catalogue item currency must match the document currency."] });
    const previous = line.id ? existingReferences.lines.get(line.id) : null;
    const preserveRateSnapshot = Boolean(previous && previous.customRateId === line.customRateId && previous.rateTypeSnapshot && previous.rateValueSnapshot);
    const candidateRate = line.customRateId ? rateMap.get(line.customRateId) : null;
    const liveRate = candidateRate?.isActive ? candidateRate : null;
    if (line.customRateId && !preserveRateSnapshot && !liveRate) throw new BusinessDataValidationError({ lines: ["A selected workspace custom rate is unavailable."] });
    const rate = preserveRateSnapshot ? { id: line.customRateId!, name: previous!.rateNameSnapshot!, type: previous!.rateTypeSnapshot!, value: previous!.rateValueSnapshot! } : liveRate;
    let calculated; try { calculated = calculateDraftLine({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, rate: rate ? { type: rate.type, value: rate.value.toString() } : null }); } catch { throw new BusinessDataValidationError({ lines: ["Line quantities, prices, or rates are invalid."] }); }
    return { catalogItemId: line.catalogItemId, customRateId: rate?.id ?? null, description: calculated.description, quantity: calculated.quantity, unitPrice: calculated.unitPrice, lineSubtotal: calculated.lineSubtotal, rateNameSnapshot: rate?.name ?? null, rateTypeSnapshot: rate?.type ?? null, rateValueSnapshot: rate?.value ?? null, rateTotal: calculated.rateTotal, lineTotal: calculated.lineTotal, lineOrder: index + 1 };
  });
  return { prepared, totals: calculateDraftTotals(prepared) };
}

async function prepareDocumentCalculation(tx: Prisma.TransactionClient, parsed: ReturnType<typeof draftInputSchema.parse>, totals: Awaited<ReturnType<typeof prepareLines>>["totals"]) {
  const version = await resolveDocumentTaxVersion(parsed.type, parsed.draftDate, tx);
  if (!version) return { taxVersionId: null, taxableValue: totals.subtotal, taxTotal: new Prisma.Decimal(0), taxCalculation: Prisma.JsonNull, ...totals };
  const calculation = calculateTrustedTax(totals.subtotal, version.components);
  const snapshot = buildTaxSnapshot(version, calculation);
  return { taxVersionId: version.id, subtotal: totals.subtotal, discountTotal: new Prisma.Decimal(0), rateTotal: new Prisma.Decimal(0), taxableValue: new Prisma.Decimal(calculation.taxableValue), taxTotal: new Prisma.Decimal(calculation.taxTotal), grandTotal: new Prisma.Decimal(calculation.grossTotal), taxCalculation: snapshot as unknown as Prisma.InputJsonValue };
}

export async function createDraft(input: { actorUserId: string; workspaceId: string; data: unknown }, options: DraftServiceOptions = {}) {
  const parsed = draftInputSchema.safeParse(input.data); if (!parsed.success) throw new BusinessDataValidationError(parsed.error.flatten().fieldErrors);
  const document = await db.$transaction(async (tx) => {
    const { readiness } = await requireWorkspaceDocumentReadinessInTransaction({
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      documentType: parsed.data.type,
      capability: CAPABILITIES.CREATE_DOCUMENT,
    }, tx);
    const customer = await resolveDraftCustomer(tx, input.workspaceId, parsed.data);
    const { prepared, totals } = await prepareLines(tx, input.workspaceId, parsed.data.currency, parsed.data.lines);
    const calculation = await prepareDocumentCalculation(tx, parsed.data, totals);
    let document = null;
    for (let attempt = 0; attempt < 5 && !document; attempt++) {
      try {
        document = await tx.document.create({ data: { workspaceId: input.workspaceId, createdByUserId: input.actorUserId, ...customer, type: parsed.data.type, status: "DRAFT", isTestDocument: readiness.isTestWorkspace, draftReference: draftReference(), documentNumber: null, currency: parsed.data.currency, draftDate: new Date(`${parsed.data.draftDate}T00:00:00.000Z`), dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null, notes: parsed.data.notes, ...calculation, lines: { create: prepared } }, include: { lines: true } });
      } catch (error) {
        const isDraftReferenceCollision = error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === "P2002"
          && Array.isArray(error.meta?.target)
          && error.meta.target.includes("draftReference");
        if (!isDraftReferenceCollision) throw error;
        if (attempt === 4) throw new BusinessDataConflictError("Unable to allocate a unique draft reference.");
      }
    }
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_CREATED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: document!.id, metadata: { documentType: parsed.data.type, draftReference: document!.draftReference } });
    return document!;
  }, businessDataTransactionOptions);
  return attachReusableCustomer(document, input, options);
}

export async function updateDraft(input: { actorUserId: string; workspaceId: string; documentId: unknown; data: unknown }, options: DraftServiceOptions = {}) {
  const id = documentIdSchema.safeParse(input.documentId); const parsed = draftInputSchema.safeParse(input.data);
  if (!id.success || !parsed.success) throw new BusinessDataValidationError(parsed.success ? {} : parsed.error.flatten().fieldErrors);
  const document = await db.$transaction(async (tx) => {
    await lockBusinessResource(tx, `document:${id.data}`); const { document: before } = await requireDocumentAccessInTransaction(tx, input.actorUserId, input.workspaceId, id.data);
    const { readiness } = await requireWorkspaceDocumentReadinessInTransaction({
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      documentType: parsed.data.type,
      capability: CAPABILITIES.UPDATE_DRAFT_DOCUMENT,
    }, tx);
    if (before.isTestDocument !== readiness.isTestWorkspace) {
      throw new BusinessDataConflictError("A document's TEST status cannot be changed.");
    }
    const customer = await resolveDraftCustomer(tx, input.workspaceId, parsed.data, before);
    const existingLines = await tx.documentLine.findMany({ where: { documentId: id.data }, select: { id: true, catalogItemId: true, customRateId: true, rateNameSnapshot: true, rateTypeSnapshot: true, rateValueSnapshot: true } });
    const { prepared, totals } = await prepareLines(tx, input.workspaceId, parsed.data.currency, parsed.data.lines, {
      catalogueItemIds: new Set(existingLines.flatMap(({ catalogItemId }) => catalogItemId ? [catalogItemId] : [])),
      rateIds: new Set(existingLines.flatMap(({ customRateId }) => customRateId ? [customRateId] : [])),
      lines: new Map(existingLines.map((line) => [line.id, line])),
    });
    const calculation = await prepareDocumentCalculation(tx, parsed.data, totals);
    await tx.documentLine.deleteMany({ where: { documentId: id.data } });
    const document = await tx.document.update({ where: { id: id.data }, data: { ...customer, type: parsed.data.type, currency: parsed.data.currency, draftDate: new Date(`${parsed.data.draftDate}T00:00:00.000Z`), dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null, notes: parsed.data.notes, ...calculation, lines: { create: prepared } }, include: { lines: true } });
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_UPDATED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: document.id, metadata: { documentType: parsed.data.type, draftReference: before.draftReference, total: document.grandTotal.toString(), currency: document.currency } });
    return document;
  }, businessDataTransactionOptions);
  return attachReusableCustomer(document, input, options);
}

export async function archiveDraft(input: { actorUserId: string; workspaceId: string; documentId: unknown }) {
  const id = documentIdSchema.safeParse(input.documentId); if (!id.success) throw new BusinessDataValidationError({ documentId: ["Invalid draft."] });
  return db.$transaction(async (tx) => { await lockBusinessResource(tx, `document:${id.data}`); const { document } = await requireDocumentAccessInTransaction(tx, input.actorUserId, input.workspaceId, id.data); const archived = await tx.document.update({ where: { id: id.data }, data: { archivedAt: new Date() } }); await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_ARCHIVED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: id.data, metadata: { draftReference: document.draftReference } }); return archived; }, businessDataTransactionOptions);
}
