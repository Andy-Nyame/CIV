import "server-only";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions, lockBusinessResource } from "@/features/business-data/locking";
import { db } from "@/lib/db";
import { catalogueIdSchema, catalogueInputSchema } from "./validation";

export async function createCatalogueItem(input: { actorUserId: string; workspaceId: string; data: unknown }) {
  const parsed = catalogueInputSchema.safeParse(input.data);
  if (!parsed.success) throw new BusinessDataValidationError(parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.MANAGE_ITEMS);
    const item = await tx.itemService.create({ data: { ...parsed.data, workspaceId: input.workspaceId, createdByUserId: input.actorUserId } });
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "ITEM_CREATED", resourceType: AUDIT_RESOURCE_TYPES.ITEM, resourceId: item.id, metadata: { itemName: item.name } });
    return item;
  }, businessDataTransactionOptions);
}

export async function updateCatalogueItem(input: { actorUserId: string; workspaceId: string; itemId: unknown; data: unknown; active?: boolean }) {
  const id = catalogueIdSchema.safeParse(input.itemId); const parsed = catalogueInputSchema.safeParse(input.data);
  if (!id.success || !parsed.success) throw new BusinessDataValidationError(parsed.success ? {} : parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await lockBusinessResource(tx, `item:${id.data}`);
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.MANAGE_ITEMS);
    const before = await tx.itemService.findFirst({ where: { id: id.data, workspaceId: input.workspaceId } });
    if (!before) throw new BusinessDataValidationError({ itemId: ["Catalogue item not found."] });
    const item = await tx.itemService.update({ where: { id: id.data }, data: { ...parsed.data, ...(input.active === undefined ? {} : { archivedAt: input.active ? null : new Date() }) } });
    const changedFields = Object.keys(parsed.data).filter((key) => String(Reflect.get(before, key) ?? "") !== String(Reflect.get(parsed.data, key) ?? ""));
    if (input.active !== undefined) changedFields.push("archivedAt");
    if (changedFields.length) await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "ITEM_UPDATED", resourceType: AUDIT_RESOURCE_TYPES.ITEM, resourceId: item.id, metadata: { itemName: item.name, changedFields } });
    return item;
  }, businessDataTransactionOptions);
}
