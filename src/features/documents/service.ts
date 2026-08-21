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
import { calculateDraftLine, calculateDraftTotals } from "./calculations";
import { documentIdSchema, draftInputSchema } from "./validation";

function draftReference() { return `DRAFT-${randomBytes(6).toString("hex").toUpperCase()}`; }

async function prepareLines(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  lines: ReturnType<typeof draftInputSchema.parse>["lines"],
  existingReferences: { catalogueItemIds: Set<string>; rateIds: Set<string> } = { catalogueItemIds: new Set(), rateIds: new Set() },
) {
  const catalogueIds = [...new Set(lines.flatMap((line) => line.catalogItemId ? [line.catalogItemId] : []))];
  const rateIds = [...new Set(lines.flatMap((line) => line.customRateId ? [line.customRateId] : []))];
  const [items, rates] = await Promise.all([
    tx.itemService.findMany({ where: { id: { in: catalogueIds }, workspaceId, OR: [{ archivedAt: null }, { id: { in: [...existingReferences.catalogueItemIds] } }] } }),
    tx.customRate.findMany({ where: { id: { in: rateIds }, workspaceId, OR: [{ isActive: true }, { id: { in: [...existingReferences.rateIds] } }] } }),
  ]);
  if (items.length !== catalogueIds.length || rates.length !== rateIds.length) throw new BusinessDataValidationError({ lines: ["A selected catalogue item or rate is unavailable."] });
  const itemIds = new Set(items.map(({ id }) => id)); const rateMap = new Map(rates.map((rate) => [rate.id, rate]));
  const prepared = lines.map((line, index) => {
    if (line.catalogItemId && !itemIds.has(line.catalogItemId)) throw new BusinessDataValidationError({ lines: ["A selected catalogue entry is invalid."] });
    const rate = line.customRateId ? rateMap.get(line.customRateId)! : null;
    let calculated; try { calculated = calculateDraftLine({ description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, rate: rate ? { type: rate.type, value: rate.value.toString() } : null }); } catch { throw new BusinessDataValidationError({ lines: ["Line quantities, prices, or rates are invalid."] }); }
    return { catalogItemId: line.catalogItemId, customRateId: rate?.id ?? null, description: calculated.description, quantity: calculated.quantity, unitPrice: calculated.unitPrice, lineSubtotal: calculated.lineSubtotal, rateNameSnapshot: rate?.name ?? null, rateTypeSnapshot: rate?.type ?? null, rateValueSnapshot: rate?.value ?? null, rateTotal: calculated.rateTotal, lineTotal: calculated.lineTotal, lineOrder: index + 1 };
  });
  return { prepared, totals: calculateDraftTotals(prepared) };
}

export async function createDraft(input: { actorUserId: string; workspaceId: string; data: unknown }) {
  const parsed = draftInputSchema.safeParse(input.data); if (!parsed.success) throw new BusinessDataValidationError(parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.CREATE_DOCUMENT);
    if (parsed.data.customerId && !(await tx.customer.findFirst({ where: { id: parsed.data.customerId, workspaceId: input.workspaceId, archivedAt: null }, select: { id: true } }))) throw new BusinessDataValidationError({ customerId: ["Customer is unavailable."] });
    const { prepared, totals } = await prepareLines(tx, input.workspaceId, parsed.data.lines);
    let document = null;
    for (let attempt = 0; attempt < 5 && !document; attempt++) {
      try {
        document = await tx.document.create({ data: { workspaceId: input.workspaceId, createdByUserId: input.actorUserId, customerId: parsed.data.customerId, type: parsed.data.type, status: "DRAFT", draftReference: draftReference(), documentNumber: null, currency: parsed.data.currency, draftDate: new Date(`${parsed.data.draftDate}T00:00:00.000Z`), dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null, notes: parsed.data.notes, ...totals, lines: { create: prepared } }, include: { lines: true } });
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
    const existingLines = await tx.documentLine.findMany({ where: { documentId: id.data }, select: { catalogItemId: true, customRateId: true } });
    const { prepared, totals } = await prepareLines(tx, input.workspaceId, parsed.data.lines, {
      catalogueItemIds: new Set(existingLines.flatMap(({ catalogItemId }) => catalogItemId ? [catalogItemId] : [])),
      rateIds: new Set(existingLines.flatMap(({ customRateId }) => customRateId ? [customRateId] : [])),
    });
    await tx.documentLine.deleteMany({ where: { documentId: id.data } });
    const document = await tx.document.update({ where: { id: id.data }, data: { customerId: parsed.data.customerId, type: parsed.data.type, currency: parsed.data.currency, draftDate: new Date(`${parsed.data.draftDate}T00:00:00.000Z`), dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null, notes: parsed.data.notes, ...totals, lines: { create: prepared } }, include: { lines: true } });
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_UPDATED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: document.id, metadata: { documentType: parsed.data.type, draftReference: before.draftReference, total: document.grandTotal.toString(), currency: document.currency } });
    return document;
  }, businessDataTransactionOptions);
}

export async function archiveDraft(input: { actorUserId: string; workspaceId: string; documentId: unknown }) {
  const id = documentIdSchema.safeParse(input.documentId); if (!id.success) throw new BusinessDataValidationError({ documentId: ["Invalid draft."] });
  return db.$transaction(async (tx) => { await lockBusinessResource(tx, `document:${id.data}`); const { document } = await requireDocumentAccessInTransaction(tx, input.actorUserId, input.workspaceId, id.data); const archived = await tx.document.update({ where: { id: id.data }, data: { archivedAt: new Date() } }); await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_ARCHIVED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: id.data, metadata: { draftReference: document.draftReference } }); return archived; }, businessDataTransactionOptions);
}
