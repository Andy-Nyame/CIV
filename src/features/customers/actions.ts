"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { createCustomer, updateCustomer } from "./service";

export type CustomerFormState = { message?: string; errors?: Record<string, string[] | undefined> };
const data = (form: FormData) => ({ name: form.get("name"), email: form.get("email"), phone: form.get("phone"), address: form.get("address"), businessTin: form.get("businessTin"), notes: form.get("notes") });

export async function saveCustomerAction(customerId: string | null, _state: CustomerFormState, form: FormData): Promise<CustomerFormState> {
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_CUSTOMERS);
    if (customerId) await updateCustomer({ actorUserId: context.user.id, workspaceId: context.workspace.id, customerId, data: data(form) });
    else await createCustomer({ actorUserId: context.user.id, workspaceId: context.workspace.id, data: data(form) });
    revalidatePath("/app/customers");
  } catch (error) {
    return error instanceof BusinessDataValidationError ? { message: "Check the highlighted information.", errors: error.fields } : { message: "Unable to save this customer." };
  }
  redirect("/app/customers");
}

export async function archiveCustomerAction(customerId: string, form: FormData) {
  const context = await requireCapability(CAPABILITIES.MANAGE_CUSTOMERS);
  await updateCustomer({ actorUserId: context.user.id, workspaceId: context.workspace.id, customerId, data: data(form), archived: true });
  revalidatePath("/app/customers");
  redirect("/app/customers");
}
