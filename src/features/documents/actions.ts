"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { InsufficientDocumentCapacityError } from "@/features/commercial/errors";
import { archiveDraft, createDraft, updateDraft } from "./service";
import { DocumentIssueConflictError, DocumentIssueReadinessError, issueDocument } from "./issuance";

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

export type IssueDocumentState = { message?: string; readiness?: string[] };
export async function issueDocumentAction(documentId: string, _state: IssueDocumentState, form: FormData): Promise<IssueDocumentState> {
  if (form.get("confirmation") !== "ISSUE") return { message: "Confirm that you understand this document will become read-only." };
  const context = await requireCapability(CAPABILITIES.ISSUE_DOCUMENT);
  try {
    const issued = await issueDocument({ actorUserId: context.user.id, workspaceId: context.workspace.id, documentId });
    revalidatePath("/app");
    revalidatePath("/app/documents");
    revalidatePath(`/app/documents/${issued.documentId}`);
  } catch (error) {
    if (error instanceof DocumentIssueReadinessError) return { message: "This draft is not ready to issue.", readiness: error.errors.map(({ message }) => message) };
    if (error instanceof InsufficientDocumentCapacityError) return { message: "This workspace does not have enough document capacity. Add credits or change the plan before issuing." };
    if (error instanceof DocumentIssueConflictError) return { message: error.message };
    throw error;
  }
  redirect(`/app/documents/${documentId}`);
}
