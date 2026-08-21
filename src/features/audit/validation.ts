import { z } from "zod";

import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from "./registry";

const displayNameSchema = z.string().trim().min(1).max(320);
const emailSchema = z.string().trim().toLowerCase().email().max(320);
const roleSchema = z.enum(["OWNER", "ADMIN", "MANAGER", "STAFF"]);
const planCodeSchema = z.string().trim().min(1).max(50);
const grantSourceSchema = z.enum([
  "AUTO_NEW_WORKSPACE",
  "PLATFORM_MANUAL",
  "PAYMENT_CONVERSION",
]);
const trialMetadataSchema = z
  .object({
    trialPlan: planCodeSchema,
    fallbackPlan: planCodeSchema,
    endsAt: z.string().trim().min(20).max(40),
    grantSource: grantSourceSchema,
  })
  .strict();

export const auditActionSchema = z.enum(Object.values(AUDIT_ACTIONS));
export const auditResourceTypeSchema = z.enum(
  Object.values(AUDIT_RESOURCE_TYPES),
);

export const auditMetadataSchemas = {
  WORKSPACE_CREATED: z
    .object({
      workspaceType: z.enum(["INDIVIDUAL", "BUSINESS", "ORGANIZATION"]),
      initialPlan: planCodeSchema,
    })
    .strict(),
  WORKSPACE_UPDATED: z.object({ changedFields: z.array(z.string()).max(20) }).strict(),
  WORKSPACE_PLAN_CHANGED: z
    .object({ fromPlan: planCodeSchema, toPlan: planCodeSchema })
    .strict(),
  SUBSCRIPTION_STARTED: z
    .object({
      fromPlan: planCodeSchema,
      toPlan: planCodeSchema,
      paymentReference: z.string().min(1).max(100),
    })
    .strict(),
  SUBSCRIPTION_RENEWED: z
    .object({
      planCode: planCodeSchema,
      periodStart: z.string().min(20).max(40),
      periodEnd: z.string().min(20).max(40),
      paymentReference: z.string().min(1).max(100),
    })
    .strict(),
  SUBSCRIPTION_PAYMENT_FAILED: z
    .object({
      planCode: planCodeSchema,
      periodEnd: z.string().min(20).max(40),
      invoiceCode: z.string().min(1).max(100).nullable(),
    })
    .strict(),
  SUBSCRIPTION_CANCELLATION_SCHEDULED: z
    .object({
      planCode: planCodeSchema,
      effectiveAt: z.string().min(20).max(40),
      nextPlan: planCodeSchema,
    })
    .strict(),
  SUBSCRIPTION_CANCELLED: z
    .object({ fromPlan: planCodeSchema, toPlan: planCodeSchema })
    .strict(),
  WORKSPACE_ARCHIVED: z.object({ workspaceName: displayNameSchema }).strict(),
  WORKSPACE_RESTORED: z.object({ workspaceName: displayNameSchema }).strict(),
  WORKSPACE_OWNERSHIP_TRANSFERRED: z
    .object({
      previousOwnerDisplayName: displayNameSchema,
      newOwnerDisplayName: displayNameSchema,
    })
    .strict(),
  WORKSPACE_LOGO_UPDATED: z
    .object({ replacedExistingLogo: z.boolean(), mimeType: z.string().max(50) })
    .strict(),
  WORKSPACE_LOGO_REMOVED: z
    .object({ mimeType: z.string().max(50) })
    .strict(),
  DOCUMENT_CREDITS_ACQUIRED: z
    .object({
      packCode: z.string().trim().min(1).max(50),
      credits: z.number().int().positive(),
      amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
      currency: z.string().length(3),
      acquisitionMethod: z.enum(["BETA", "PAYSTACK_TEST"]),
      paymentReference: z.string().trim().min(1).max(100).nullable(),
    })
    .strict(),
  PAYMENT_REFUND_SUCCEEDED: z
    .object({
      paymentReference: z.string().trim().min(1).max(100),
      refundReference: z.string().trim().min(1).max(100),
      purpose: z.enum(["DOCUMENT_CREDITS", "SUBSCRIPTION_INITIAL", "SUBSCRIPTION_RENEWAL", "MANUAL_PLAN_RENEWAL"]),
      amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
      currency: z.string().length(3),
      partial: z.boolean(),
    })
    .strict(),
  TRIAL_STARTED: trialMetadataSchema,
  TRIAL_EXPIRED: trialMetadataSchema,
  TRIAL_CANCELLED: trialMetadataSchema,
  TRIAL_CONVERTED: trialMetadataSchema,
  MEMBER_INVITED: z
    .object({ invitedEmail: emailSchema, role: roleSchema })
    .strict(),
  INVITATION_CANCELLED: z
    .object({ invitedEmail: emailSchema, role: roleSchema })
    .strict(),
  INVITATION_RENEWED: z
    .object({ invitedEmail: emailSchema, role: roleSchema })
    .strict(),
  INVITATION_ACCEPTED: z
    .object({ invitedEmail: emailSchema, role: roleSchema })
    .strict(),
  MEMBER_ROLE_CHANGED: z
    .object({
      memberDisplayName: displayNameSchema,
      fromRole: roleSchema,
      toRole: roleSchema,
    })
    .strict(),
  MEMBER_SUSPENDED: z
    .object({ memberDisplayName: displayNameSchema, role: roleSchema })
    .strict(),
  MEMBER_REACTIVATED: z
    .object({ memberDisplayName: displayNameSchema, role: roleSchema })
    .strict(),
  MEMBER_REMOVED: z
    .object({ memberDisplayName: displayNameSchema, role: roleSchema })
    .strict(),
  MEMBER_LEFT_WORKSPACE: z
    .object({ memberDisplayName: displayNameSchema, role: roleSchema })
    .strict(),
  DOCUMENT_CREATED: z.object({}).strict(),
  DOCUMENT_DRAFT_CREATED: z
    .object({
      documentType: z.enum(["INVOICE", "RECEIPT", "VAT_INVOICE"]),
      draftReference: z.string().trim().min(8).max(40),
    })
    .strict(),
  DOCUMENT_DRAFT_UPDATED: z
    .object({
      documentType: z.enum(["INVOICE", "RECEIPT", "VAT_INVOICE"]),
      draftReference: z.string().trim().min(8).max(40),
      total: z.string().regex(/^\d+(\.\d{1,4})?$/),
      currency: z.string().length(3),
    })
    .strict(),
  DOCUMENT_DRAFT_ARCHIVED: z
    .object({ draftReference: z.string().trim().min(8).max(40) })
    .strict(),
  DOCUMENT_ISSUED: z.object({}).strict(),
  DOCUMENT_VOIDED: z.object({}).strict(),
  DOCUMENT_STATUS_CHANGED: z.object({}).strict(),
  CUSTOMER_CREATED: z.object({ customerName: displayNameSchema }).strict(),
  CUSTOMER_UPDATED: z
    .object({ customerName: displayNameSchema, changedFields: z.array(z.string().max(40)).max(10) })
    .strict(),
  ITEM_CREATED: z.object({ itemName: displayNameSchema }).strict(),
  ITEM_UPDATED: z
    .object({ itemName: displayNameSchema, changedFields: z.array(z.string().max(40)).max(10) })
    .strict(),
  RATE_CREATED: z.object({ rateName: displayNameSchema, rateType: z.enum(["PERCENTAGE", "FIXED"]) }).strict(),
  RATE_UPDATED: z.object({ rateName: displayNameSchema, rateType: z.enum(["PERCENTAGE", "FIXED"]) }).strict(),
  RATE_DEACTIVATED: z.object({ rateName: displayNameSchema, rateType: z.enum(["PERCENTAGE", "FIXED"]) }).strict(),
} as const;

export const auditEventBaseSchema = z.object({
  workspaceId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  action: auditActionSchema,
  resourceType: auditResourceTypeSchema,
  resourceId: z.string().trim().min(1).max(100).nullable(),
});
