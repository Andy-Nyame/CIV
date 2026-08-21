import "server-only";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions, lockBusinessResource } from "@/features/business-data/locking";
import { db } from "@/lib/db";
import { customRateIdSchema, customRateInputSchema } from "./validation";

export async function createCustomRate(input: { actorUserId: string; workspaceId: string; data: unknown }) {
  const parsed = customRateInputSchema.safeParse(input.data);
  if (!parsed.success) throw new BusinessDataValidationError(parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.MANAGE_RATES);
    const rate = await tx.customRate.create({ data: { ...parsed.data, workspaceId: input.workspaceId, scope: "CUSTOM" } });
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "RATE_CREATED", resourceType: AUDIT_RESOURCE_TYPES.RATE, resourceId: rate.id, metadata: { rateName: rate.name, rateType: rate.type } });
    return rate;
  }, businessDataTransactionOptions);
}

export async function updateCustomRate(input: { actorUserId: string; workspaceId: string; rateId: unknown; data: unknown; active?: boolean }) {
  const id = customRateIdSchema.safeParse(input.rateId); const parsed = customRateInputSchema.safeParse(input.data);
  if (!id.success || !parsed.success) throw new BusinessDataValidationError(parsed.success ? {} : parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await lockBusinessResource(tx, `rate:${id.data}`);
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.MANAGE_RATES);
    const before = await tx.customRate.findFirst({ where: { id: id.data, workspaceId: input.workspaceId, scope: "CUSTOM" } });
    if (!before) throw new BusinessDataValidationError({ rateId: ["Custom rate not found."] });
    const rate = await tx.customRate.update({ where: { id: id.data }, data: { ...parsed.data, ...(input.active === undefined ? {} : { isActive: input.active }) } });
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: input.active === false ? "RATE_DEACTIVATED" : "RATE_UPDATED", resourceType: AUDIT_RESOURCE_TYPES.RATE, resourceId: rate.id, metadata: { rateName: rate.name, rateType: rate.type } });
    return rate;
  }, businessDataTransactionOptions);
}
