import "server-only";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { db } from "@/lib/db";

export async function getCataloguePageData(search = "") {
  const context = await requireCapability(CAPABILITIES.VIEW_ITEMS); const query = search.trim().slice(0, 100);
  const items = await db.itemService.findMany({ where: { workspaceId: context.workspace.id, ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] } : {}) }, orderBy: [{ archivedAt: "asc" }, { name: "asc" }], take: 100 });
  return { context, items, canManage: context.capabilities.includes(CAPABILITIES.MANAGE_ITEMS) };
}

export async function getCatalogueItemForEdit(itemId: string) {
  const context = await requireCapability(CAPABILITIES.MANAGE_ITEMS);
  return { context, item: await db.itemService.findFirst({ where: { id: itemId, workspaceId: context.workspace.id } }) };
}
