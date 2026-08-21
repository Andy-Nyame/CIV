import "server-only";

import { CAPABILITIES } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions, lockBusinessResource } from "@/features/business-data/locking";
import { db } from "@/lib/db";

import { customerIdSchema, customerInputSchema } from "./validation";

export async function createCustomer(input: { actorUserId: string; workspaceId: string; data: unknown }) {
  const parsed = customerInputSchema.safeParse(input.data);
  if (!parsed.success) throw new BusinessDataValidationError(parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.MANAGE_CUSTOMERS);
    const customer = await tx.customer.create({ data: { ...parsed.data, workspaceId: input.workspaceId, createdByUserId: input.actorUserId } });
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "CUSTOMER_CREATED", resourceType: AUDIT_RESOURCE_TYPES.CUSTOMER, resourceId: customer.id, metadata: { customerName: customer.name } });
    return customer;
  }, businessDataTransactionOptions);
}

export async function updateCustomer(input: { actorUserId: string; workspaceId: string; customerId: unknown; data: unknown; archived?: boolean }) {
  const id = customerIdSchema.safeParse(input.customerId);
  const parsed = customerInputSchema.safeParse(input.data);
  if (!id.success || !parsed.success) throw new BusinessDataValidationError(parsed.success ? {} : parsed.error.flatten().fieldErrors);
  return db.$transaction(async (tx) => {
    await lockBusinessResource(tx, `customer:${id.data}`);
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.MANAGE_CUSTOMERS);
    const before = await tx.customer.findFirst({ where: { id: id.data, workspaceId: input.workspaceId } });
    if (!before) throw new BusinessDataValidationError({ customerId: ["Customer not found."] });
    const customer = await tx.customer.update({ where: { id: id.data }, data: { ...parsed.data, ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }) } });
    const changedFields = Object.keys(parsed.data).filter((key) => String(Reflect.get(before, key) ?? "") !== String(Reflect.get(parsed.data, key) ?? ""));
    if (input.archived !== undefined) changedFields.push("archivedAt");
    if (changedFields.length) await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "CUSTOMER_UPDATED", resourceType: AUDIT_RESOURCE_TYPES.CUSTOMER, resourceId: customer.id, metadata: { customerName: customer.name, changedFields } });
    return customer;
  }, businessDataTransactionOptions);
}
