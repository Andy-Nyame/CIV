"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { createCatalogueItem, updateCatalogueItem } from "./service";

export type CatalogueFormState = { message?: string; errors?: Record<string, string[] | undefined> };
const data = (form: FormData) => ({ name: form.get("name"), description: form.get("description"), type: form.get("type"), unitPrice: form.get("unitPrice"), currency: form.get("currency"), unitLabel: form.get("unitLabel"), sku: form.get("sku") });
export async function saveCatalogueItemAction(itemId: string | null, _state: CatalogueFormState, form: FormData): Promise<CatalogueFormState> {
  try { const context = await requireCapability(CAPABILITIES.MANAGE_ITEMS); if (itemId) await updateCatalogueItem({ actorUserId: context.user.id, workspaceId: context.workspace.id, itemId, data: data(form) }); else await createCatalogueItem({ actorUserId: context.user.id, workspaceId: context.workspace.id, data: data(form) }); revalidatePath("/app/items"); }
  catch (error) { return error instanceof BusinessDataValidationError ? { message: "Check the highlighted information.", errors: error.fields } : { message: "Unable to save this catalogue entry." }; }
  redirect("/app/items");
}
export async function setCatalogueItemActiveAction(itemId: string, active: boolean, form: FormData) { const context = await requireCapability(CAPABILITIES.MANAGE_ITEMS); await updateCatalogueItem({ actorUserId: context.user.id, workspaceId: context.workspace.id, itemId, data: data(form), active }); revalidatePath("/app/items"); redirect("/app/items"); }
