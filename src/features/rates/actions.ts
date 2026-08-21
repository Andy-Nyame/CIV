"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { createCustomRate, updateCustomRate } from "./service";

export type RateFormState = { message?: string; errors?: Record<string, string[] | undefined> };
const data = (form: FormData) => ({ name: form.get("name"), type: form.get("type"), value: form.get("value"), description: form.get("description") });
export async function saveCustomRateAction(rateId: string | null, _state: RateFormState, form: FormData): Promise<RateFormState> {
  try { const context = await requireCapability(CAPABILITIES.MANAGE_RATES); if (rateId) await updateCustomRate({ actorUserId: context.user.id, workspaceId: context.workspace.id, rateId, data: data(form) }); else await createCustomRate({ actorUserId: context.user.id, workspaceId: context.workspace.id, data: data(form) }); revalidatePath("/app/settings/rates"); if (rateId) redirect("/app/settings/rates"); return { message: "Custom rate saved." }; }
  catch (error) { if (error instanceof BusinessDataValidationError) return { message: "Check the custom rate details.", errors: error.fields }; throw error; }
}
export async function setCustomRateActiveAction(rateId: string, active: boolean, form: FormData) { const context = await requireCapability(CAPABILITIES.MANAGE_RATES); await updateCustomRate({ actorUserId: context.user.id, workspaceId: context.workspace.id, rateId, active, data: data(form) }); revalidatePath("/app/settings/rates"); redirect("/app/settings/rates"); }
