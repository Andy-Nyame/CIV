import "server-only";
import { randomBytes } from "node:crypto";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { requireDocumentAccessInTransaction, requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { BusinessDataConflictError, BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions, lockBusinessResource } from "@/features/business-data/locking";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { calculateTrustedTax } from "@/features/tax/calculation";
import { resolveGhanaVatVersion } from "@/features/tax/resolver";
import { buildTaxSnapshot } from "@/features/tax/snapshot";
import { calculateDraftLine, calculateDraftTotals } from "./calculations";
import { documentIdSchema, draftInputSchema } from "./validation";

function draftReference() { return `DRAFT-${randomBytes(6).toString("hex").toUpperCase()}`; }

async function prepareLines(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  currency: string,
  lines: ReturnType<typeof draftInputSchema.parse>["lines"],
  existingReferences: { catalogueItemIds: Set<string>; rateIds: Set<string>; lines: Map<string, { customRateId: string | null; rateNameSnapshot: string | null; rateTypeSnapshot: "PERCENTAGE" | "FIXED" | null; rateValueSnapshot: Prisma.Decimal | null }> } = { catalogueItemIds: new Set(), rateIds: new Set(), lines: new Map() },
) {
  const catalogueIds = [...new Set(lines.flatMap((line) => line.catalogItemId ? [line.catalogItemId] : []))];
  const rateIds = [...new Set(lines.flatMap((line) => line.customRateId ? [line.customRateId] : []))];
  const [items, rates] = await Promise.all([
    tx.itemService.findMany({ where: { id: { in: catalogueIds }, workspaceId, OR: [{ archivedAt: null }, { id: { in: [...existingReferences.catalogueItemIds] } }] } }),
    tx.customRate.findMany({ where: { id: { in: rateIds }, workspaceId, OR: [{ isActive: true }, { id: { in: [...existingReferences.rateIds] } }] } }),
  ]);
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
  if (parsed.type !== "VAT_INVOICE") return { taxVersionId: null, taxableValue: totals.subtotal, taxTotal: new Prisma.Decimal(0), taxCalculation: Prisma.JsonNull, ...totals };
  const version = await resolveGhanaVatVersion(parsed.draftDate, tx);
  const calculation = calculateTrustedTax(totals.subtotal, version.components);
  const snapshot = buildTaxSnapshot(version, calculation);
  return { taxVersionId: version.id, subtotal: totals.subtotal, discountTotal: new Prisma.Decimal(0), rateTotal: new Prisma.Decimal(0), taxableValue: new Prisma.Decimal(calculation.taxableValue), taxTotal: new Prisma.Decimal(calculation.taxTotal), grandTotal: new Prisma.Decimal(calculation.grossTotal), taxCalculation: snapshot as unknown as Prisma.InputJsonValue };
}

export async function createDraft(input: { actorUserId: string; workspaceId: string; data: unknown }) {
  const parsed = draftInputSchema.safeParse(input.data); if (!parsed.success) throw new BusinessDataValidationError(parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.CREATE_DOCUMENT);
    if (parsed.data.customerId && !(await tx.customer.findFirst({ where: { id: parsed.data.customerId, workspaceId: input.workspaceId, archivedAt: null }, select: { id: true } }))) throw new BusinessDataValidationError({ customerId: ["Customer is unavailable."] });
    const { prepared, totals } = await prepareLines(tx, input.workspaceId, parsed.data.currency, parsed.data.lines);
    const calculation = await prepareDocumentCalculation(tx, parsed.data, totals);
    let document = null;
    for (let attempt = 0; attempt < 5 && !document; attempt++) {
      try {
        document = await tx.document.create({ data: { workspaceId: input.workspaceId, createdByUserId: input.actorUserId, customerId: parsed.data.customerId, type: parsed.data.type, status: "DRAFT", draftReference: draftReference(), documentNumber: null, currency: parsed.data.currency, draftDate: new Date(`${parsed.data.draftDate}T00:00:00.000Z`), dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null, notes: parsed.data.notes, ...calculation, lines: { create: prepared } }, include: { lines: true } });
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
}

export async function updateDraft(input: { actorUserId: string; workspaceId: string; documentId: unknown; data: unknown }) {
  const id = documentIdSchema.safeParse(input.documentId); const parsed = draftInputSchema.safeParse(input.data);
  if (!id.success || !parsed.success) throw new BusinessDataValidationError(parsed.success ? {} : parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await lockBusinessResource(tx, `document:${id.data}`); const { document: before } = await requireDocumentAccessInTransaction(tx, input.actorUserId, input.workspaceId, id.data);
    if (parsed.data.customerId && parsed.data.customerId !== before.customerId && !(await tx.customer.findFirst({ where: { id: parsed.data.customerId, workspaceId: input.workspaceId, archivedAt: null }, select: { id: true } }))) throw new BusinessDataValidationError({ customerId: ["Customer is unavailable."] });
    const existingLines = await tx.documentLine.findMany({ where: { documentId: id.data }, select: { id: true, catalogItemId: true, customRateId: true, rateNameSnapshot: true, rateTypeSnapshot: true, rateValueSnapshot: true } });
    const { prepared, totals } = await prepareLines(tx, input.workspaceId, parsed.data.currency, parsed.data.lines, {
      catalogueItemIds: new Set(existingLines.flatMap(({ catalogItemId }) => catalogItemId ? [catalogItemId] : [])),
      rateIds: new Set(existingLines.flatMap(({ customRateId }) => customRateId ? [customRateId] : [])),
      lines: new Map(existingLines.map((line) => [line.id, line])),
    });
    const calculation = await prepareDocumentCalculation(tx, parsed.data, totals);
    await tx.documentLine.deleteMany({ where: { documentId: id.data } });
    const document = await tx.document.update({ where: { id: id.data }, data: { customerId: parsed.data.customerId, type: parsed.data.type, currency: parsed.data.currency, draftDate: new Date(`${parsed.data.draftDate}T00:00:00.000Z`), dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null, notes: parsed.data.notes, ...calculation, lines: { create: prepared } }, include: { lines: true } });
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_UPDATED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: document.id, metadata: { documentType: parsed.data.type, draftReference: before.draftReference, total: document.grandTotal.toString(), currency: document.currency } });
    return document;
  }, businessDataTransactionOptions);
}

export async function archiveDraft(input: { actorUserId: string; workspaceId: string; documentId: unknown }) {
  const id = documentIdSchema.safeParse(input.documentId); if (!id.success) throw new BusinessDataValidationError({ documentId: ["Invalid draft."] });
  return db.$transaction(async (tx) => { await lockBusinessResource(tx, `document:${id.data}`); const { document } = await requireDocumentAccessInTransaction(tx, input.actorUserId, input.workspaceId, id.data); const archived = await tx.document.update({ where: { id: id.data }, data: { archivedAt: new Date() } }); await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_ARCHIVED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: id.data, metadata: { draftReference: document.draftReference } }); return archived; }, businessDataTransactionOptions);
}
