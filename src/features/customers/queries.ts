import "server-only";

import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { db } from "@/lib/db";

export async function getCustomersPageData(search = "") {
  const context = await requireCapability(CAPABILITIES.VIEW_CUSTOMERS);
  const query = search.trim().slice(0, 100);
  const customers = await db.customer.findMany({
    where: { workspaceId: context.workspace.id, archivedAt: null, ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { phone: { contains: query, mode: "insensitive" } }] } : {}) },
    orderBy: [{ name: "asc" }, { id: "asc" }], take: 100,
  });
  return { context, customers, canManage: context.capabilities.includes(CAPABILITIES.MANAGE_CUSTOMERS) };
}

export async function getCustomerForEdit(customerId: string) {
  const context = await requireCapability(CAPABILITIES.MANAGE_CUSTOMERS);
  const customer = await db.customer.findFirst({ where: { id: customerId, workspaceId: context.workspace.id } });
  return { context, customer };
}
