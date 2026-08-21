"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { archiveDraft, createDraft, updateDraft } from "./service";

export type DraftFormState = { message?: string; errors?: Record<string, string[] | undefined> };
function parse(form: FormData) {
  let lines: unknown = []; try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { /* validated below */ }
  return { type: form.get("type"), customerId: form.get("customerId"), currency: form.get("currency"), draftDate: form.get("draftDate"), dueDate: form.get("dueDate"), notes: form.get("notes"), lines };
}
export async function saveDraftAction(documentId: string | null, _state: DraftFormState, form: FormData): Promise<DraftFormState> {
  try { const context = await requireCapability(documentId ? CAPABILITIES.UPDATE_DRAFT_DOCUMENT : CAPABILITIES.CREATE_DOCUMENT); const document = documentId ? await updateDraft({ actorUserId: context.user.id, workspaceId: context.workspace.id, documentId, data: parse(form) }) : await createDraft({ actorUserId: context.user.id, workspaceId: context.workspace.id, data: parse(form) }); revalidatePath("/app/documents"); revalidatePath(`/app/documents/${document.id}`); if (!documentId) redirect(`/app/documents/${document.id}`); return { message: "Draft saved." }; }
  catch (error) { if (error instanceof BusinessDataValidationError) return { message: "Check the draft information and line items.", errors: error.fields }; throw error; }
}
export async function archiveDraftAction(documentId: string) { const context = await requireCapability(CAPABILITIES.UPDATE_DRAFT_DOCUMENT); await archiveDraft({ actorUserId: context.user.id, workspaceId: context.workspace.id, documentId }); revalidatePath("/app/documents"); redirect("/app/documents"); }
