"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { BusinessDataConflictError, BusinessDataValidationError } from "@/features/business-data/errors";
import { InsufficientDocumentCapacityError } from "@/features/commercial/errors";
import { WorkspaceDocumentReadinessError } from "@/features/workspaces/document-readiness";
import { archiveDraft, createDraft, updateDraft } from "./service";
import { DocumentIssueConflictError, DocumentIssueReadinessError, issueDocument } from "./issuance";
import { voidIssuedDocument } from "./lifecycle";

export type DraftFormState = { message?: string; errors?: Record<string, string[] | undefined> };
function parse(form: FormData) {
  const optional = (name: string) => form.has(name) ? form.get(name) : undefined;
  let lines: unknown = []; try { lines = JSON.parse(String(form.get("lines") ?? "[]")); } catch { /* validated below */ }
  let paymentEvents: unknown = []; try { paymentEvents = JSON.parse(String(form.get("paymentEvents") ?? "[]")); } catch { /* validated below */ }
  return {
    type: form.get("type"), customerId: form.get("customerId"),
    customerName: form.get("customerName"),
    customerAddress: optional("customerAddress"), customerTaxpayerIdType: optional("customerTaxpayerIdType"),
    customerTaxpayerId: optional("customerTaxpayerId"), customerVatRegistrationStatus: optional("customerVatRegistrationStatus"),
    customerTaxStatus: form.get("customerTaxStatus"),
    currency: form.get("currency"), draftDate: form.get("draftDate"), supplyDate: form.get("supplyDate"), dueDate: form.get("dueDate"),
    transactionType: form.get("transactionType"), servicePeriodStart: form.get("servicePeriodStart"), servicePeriodEnd: form.get("servicePeriodEnd"), receiptType: form.get("receiptType"), priceMode: form.get("priceMode"),
    originalDocumentId: form.get("originalDocumentId"), adjustmentReason: form.get("adjustmentReason"),
    withholdingApplied: form.get("withholdingApplied"), withholdingAmount: form.get("withholdingAmount"),
    withholdingReference: form.get("withholdingReference"), withholdingDate: form.get("withholdingDate"), withholdingAgent: form.get("withholdingAgent"), withholdingEvidence: form.get("withholdingEvidence"),
    paymentEvents, notes: form.get("notes"), lines,
  };
}
export async function saveDraftAction(documentId: string | null, _state: DraftFormState, form: FormData): Promise<DraftFormState> {
  try { const context = await requireCapability(documentId ? CAPABILITIES.UPDATE_DRAFT_DOCUMENT : CAPABILITIES.CREATE_DOCUMENT); const document = documentId ? await updateDraft({ actorUserId: context.user.id, workspaceId: context.workspace.id, documentId, data: parse(form) }) : await createDraft({ actorUserId: context.user.id, workspaceId: context.workspace.id, data: parse(form) }); revalidatePath("/app/documents"); revalidatePath(`/app/documents/${document.id}`); if (!documentId) redirect(`/app/documents/${document.id}`); return { message: "Draft saved." }; }
  catch (error) {
    if (error instanceof BusinessDataValidationError) return { message: "Check the draft information and line items.", errors: error.fields };
    if (error instanceof WorkspaceDocumentReadinessError) return { message: error.message, errors: { workspace: error.issues.map(({ message }) => message) } };
    throw error;
  }
}
export async function archiveDraftAction(documentId: string) { const context = await requireCapability(CAPABILITIES.UPDATE_DRAFT_DOCUMENT); await archiveDraft({ actorUserId: context.user.id, workspaceId: context.workspace.id, documentId }); revalidatePath("/app/documents"); redirect("/app/documents"); }

export type VoidDocumentState = { message?: string; success?: boolean };
export async function voidDocumentAction(documentId: string, _state: VoidDocumentState, form: FormData): Promise<VoidDocumentState> {
  const context = await requireCapability(CAPABILITIES.VOID_DOCUMENT);
  try {
    await voidIssuedDocument({ actorUserId: context.user.id, workspaceId: context.workspace.id, documentId, reason: form.get("reason") });
    revalidatePath("/app/documents");
    revalidatePath("/app/vault");
    revalidatePath(`/app/documents/${documentId}`);
    return { success: true, message: "Document voided. Its original number, snapshot, and verification identity remain retained." };
  } catch (error) {
    if (error instanceof BusinessDataValidationError) return { message: error.fields.reason?.[0] ?? "Enter a valid void reason." };
    if (error instanceof DocumentIssueConflictError || error instanceof BusinessDataConflictError) return { message: error.message };
    throw error;
  }
}

export type IssueDocumentState = { message?: string; readiness?: string[] };
export async function issueDocumentAction(documentId: string, _state: IssueDocumentState, form: FormData): Promise<IssueDocumentState> {
  if (form.get("confirmation") !== "ISSUE") return { message: "Confirm that you understand this document will become read-only." };
  const context = await requireCapability(CAPABILITIES.ISSUE_DOCUMENT);
  try {
    const issued = await issueDocument({ actorUserId: context.user.id, workspaceId: context.workspace.id, documentId, acknowledgeGraRequirement: form.get("graAcknowledgement") === "REQUIRES_GRA" });
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
