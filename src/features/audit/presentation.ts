import type { Prisma } from "@/generated/prisma/client";

import { isAuditAction, type AuditAction } from "./registry";

type PresentableAuditEvent = {
  action: string;
  metadata: Prisma.JsonValue | null;
  actor: { name: string | null; email: string | null } | null;
};

const actionLabels: Record<AuditAction, string> = {
  WORKSPACE_CREATED: "Workspace created",
  WORKSPACE_UPDATED: "Workspace updated",
  WORKSPACE_PLAN_CHANGED: "Plan changed",
  SUBSCRIPTION_STARTED: "Subscription started",
  SUBSCRIPTION_RENEWED: "Subscription renewed",
  SUBSCRIPTION_PAYMENT_FAILED: "Subscription payment failed",
  SUBSCRIPTION_CANCELLATION_SCHEDULED: "Subscription cancellation scheduled",
  SUBSCRIPTION_CANCELLED: "Subscription cancelled",
  WORKSPACE_ARCHIVED: "Workspace archived",
  WORKSPACE_RESTORED: "Workspace restored",
  WORKSPACE_OWNERSHIP_TRANSFERRED: "Ownership transferred",
  WORKSPACE_LOGO_UPDATED: "Workspace logo updated",
  WORKSPACE_LOGO_REMOVED: "Workspace logo removed",
  DOCUMENT_CREDITS_ACQUIRED: "Document credits acquired",
  PAYMENT_REFUND_SUCCEEDED: "Payment refunded",
  TRIAL_STARTED: "Trial started",
  TRIAL_EXPIRED: "Trial expired",
  TRIAL_CANCELLED: "Trial cancelled",
  TRIAL_CONVERTED: "Trial converted",
  MEMBER_INVITED: "Member invited",
  INVITATION_CANCELLED: "Invitation cancelled",
  INVITATION_RENEWED: "Invitation renewed",
  INVITATION_ACCEPTED: "Invitation accepted",
  MEMBER_ROLE_CHANGED: "Member role changed",
  MEMBER_SUSPENDED: "Member suspended",
  MEMBER_REACTIVATED: "Member reactivated",
  MEMBER_REMOVED: "Member removed",
  MEMBER_LEFT_WORKSPACE: "Member left",
  DOCUMENT_CREATED: "Document created",
  DOCUMENT_DRAFT_CREATED: "Draft created",
  DOCUMENT_DRAFT_UPDATED: "Draft updated",
  DOCUMENT_DRAFT_ARCHIVED: "Draft archived",
  DOCUMENT_ISSUED: "Document issued",
  DOCUMENT_VOIDED: "Document voided",
  DOCUMENT_STATUS_CHANGED: "Document status changed",
  CUSTOMER_CREATED: "Customer created",
  CUSTOMER_UPDATED: "Customer updated",
  ITEM_CREATED: "Item created",
  ITEM_UPDATED: "Item updated",
  RATE_CREATED: "Rate created",
  RATE_UPDATED: "Rate updated",
};

function metadataObject(metadata: Prisma.JsonValue | null) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {};
}

function metadataText(
  metadata: ReturnType<typeof metadataObject>,
  key: string,
  fallback: string,
) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function enumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function presentAuditEvent(event: PresentableAuditEvent) {
  const metadata = metadataObject(event.metadata);
  const actor =
    event.actor?.name?.trim() ||
    event.actor?.email ||
    metadataText(metadata, "actorDisplayName", "A former workspace member");
  const action = isAuditAction(event.action) ? event.action : null;
  const label = action ? actionLabels[action] : "Workspace activity";
  const invitedEmail = metadataText(metadata, "invitedEmail", "a team member");
  const member = metadataText(metadata, "memberDisplayName", "a team member");
  const role = enumLabel(metadataText(metadata, "role", "member"));

  const summary = (() => {
    switch (action) {
      case "WORKSPACE_CREATED":
        return `${actor} created this ${enumLabel(metadataText(metadata, "workspaceType", "workspace"))} workspace on the ${enumLabel(metadataText(metadata, "initialPlan", "Free"))} plan.`;
      case "WORKSPACE_UPDATED":
        return `${actor} updated this workspace.`;
      case "WORKSPACE_PLAN_CHANGED":
        return `${actor} switched this workspace from ${enumLabel(metadataText(metadata, "fromPlan", "a previous plan"))} to ${enumLabel(metadataText(metadata, "toPlan", "a new plan"))}.`;
      case "SUBSCRIPTION_STARTED":
        return `${actor} started the ${enumLabel(metadataText(metadata, "toPlan", "paid"))} subscription.`;
      case "SUBSCRIPTION_RENEWED":
        return `The ${enumLabel(metadataText(metadata, "planCode", "paid"))} subscription renewed successfully.`;
      case "SUBSCRIPTION_PAYMENT_FAILED":
        return `The ${enumLabel(metadataText(metadata, "planCode", "paid"))} subscription renewal payment failed.`;
      case "SUBSCRIPTION_CANCELLATION_SCHEDULED":
        return `${actor} scheduled the subscription to end at the close of the current billing period.`;
      case "SUBSCRIPTION_CANCELLED":
        return `The subscription ended and ${enumLabel(metadataText(metadata, "toPlan", "the fallback plan"))} limits resumed.`;
      case "WORKSPACE_ARCHIVED":
        return `${actor} archived this workspace.`;
      case "WORKSPACE_RESTORED":
        return `${actor} restored this workspace.`;
      case "WORKSPACE_OWNERSHIP_TRANSFERRED":
        return `${actor} transferred workspace ownership from ${metadataText(metadata, "previousOwnerDisplayName", "the previous Owner")} to ${metadataText(metadata, "newOwnerDisplayName", "the new Owner")}.`;
      case "WORKSPACE_LOGO_UPDATED":
        return `${actor} ${metadata.replacedExistingLogo === true ? "replaced" : "added"} the workspace logo.`;
      case "WORKSPACE_LOGO_REMOVED":
        return `${actor} removed the workspace logo.`;
      case "DOCUMENT_CREDITS_ACQUIRED":
        return `${actor} added ${typeof metadata.credits === "number" ? metadata.credits.toLocaleString("en-GH") : "document"} carry-forward document credits through ${enumLabel(metadataText(metadata, "packCode", "a credit pack"))}.`;
      case "PAYMENT_REFUND_SUCCEEDED":
        return `CIV confirmed a ${metadata.partial === true ? "partial " : ""}${metadataText(metadata, "currency", "payment")} ${metadataText(metadata, "amount", "")} refund for this workspace.`;
      case "TRIAL_STARTED":
        return `CIV started a ${enumLabel(metadataText(metadata, "trialPlan", "plan"))} trial for this workspace.`;
      case "TRIAL_EXPIRED":
        return `The ${enumLabel(metadataText(metadata, "trialPlan", "plan"))} trial expired and normal plan limits resumed.`;
      case "TRIAL_CANCELLED":
        return `CIV cancelled the ${enumLabel(metadataText(metadata, "trialPlan", "plan"))} trial and normal plan limits resumed.`;
      case "TRIAL_CONVERTED":
        return `The ${enumLabel(metadataText(metadata, "trialPlan", "plan"))} trial converted to a subscription.`;
      case "MEMBER_INVITED":
        return `${actor} invited ${invitedEmail} as ${role}.`;
      case "INVITATION_CANCELLED":
        return `${actor} cancelled the invitation for ${invitedEmail}.`;
      case "INVITATION_RENEWED":
        return `${actor} generated a new invitation link for ${invitedEmail}.`;
      case "INVITATION_ACCEPTED":
        return `${actor} accepted an invitation to this workspace as ${role}.`;
      case "MEMBER_ROLE_CHANGED":
        return `${actor} changed ${member}’s role from ${enumLabel(metadataText(metadata, "fromRole", "a previous role"))} to ${enumLabel(metadataText(metadata, "toRole", "a new role"))}.`;
      case "MEMBER_SUSPENDED":
        return `${actor} suspended ${member}.`;
      case "MEMBER_REACTIVATED":
        return `${actor} reactivated ${member}.`;
      case "MEMBER_REMOVED":
        return `${actor} removed ${member} from this workspace.`;
      case "MEMBER_LEFT_WORKSPACE":
        return `${member} left this workspace.`;
      case "DOCUMENT_CREATED":
        return `${actor} created a document.`;
      case "DOCUMENT_DRAFT_CREATED":
        return `${actor} created draft ${metadataText(metadata, "draftReference", "document")}.`;
      case "DOCUMENT_DRAFT_UPDATED":
        return `${actor} updated draft ${metadataText(metadata, "draftReference", "document")}.`;
      case "DOCUMENT_DRAFT_ARCHIVED":
        return `${actor} archived draft ${metadataText(metadata, "draftReference", "document")}.`;
      case "DOCUMENT_ISSUED":
        return `${actor} issued a document.`;
      case "DOCUMENT_VOIDED":
        return `${actor} voided a document.`;
      case "DOCUMENT_STATUS_CHANGED":
        return `${actor} changed a document’s status.`;
      case "CUSTOMER_CREATED":
        return `${actor} created a customer.`;
      case "CUSTOMER_UPDATED":
        return `${actor} updated a customer.`;
      case "ITEM_CREATED":
        return `${actor} created a catalogue item.`;
      case "ITEM_UPDATED":
        return `${actor} updated a catalogue item.`;
      case "RATE_CREATED":
        return `${actor} created a rate.`;
      case "RATE_UPDATED":
        return `${actor} updated a rate.`;
      default:
        return `${actor} performed an important workspace action.`;
    }
  })();

  return { label, summary };
}
