import "server-only";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { db } from "@/lib/db";

export async function getCustomRatesPageData() {
  const context = await requireCapability(CAPABILITIES.VIEW_RATES);
  const rates = await db.customRate.findMany({ where: { workspaceId: context.workspace.id, scope: "CUSTOM" }, orderBy: [{ isActive: "desc" }, { name: "asc" }], take: 100 });
  return { context, rates, canManage: context.capabilities.includes(CAPABILITIES.MANAGE_RATES) };
}

export async function getCustomRateForEdit(rateId: string) {
  const context = await requireCapability(CAPABILITIES.MANAGE_RATES);
  const rate = await db.customRate.findFirst({ where: { id: rateId, workspaceId: context.workspace.id, scope: "CUSTOM" } });
  return { context, rate };
}
