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
  DOCUMENT_ISSUED: z.object({}).strict(),
  DOCUMENT_VOIDED: z.object({}).strict(),
  DOCUMENT_STATUS_CHANGED: z.object({}).strict(),
  CUSTOMER_CREATED: z.object({}).strict(),
  CUSTOMER_UPDATED: z.object({}).strict(),
  ITEM_CREATED: z.object({}).strict(),
  ITEM_UPDATED: z.object({}).strict(),
  RATE_CREATED: z.object({}).strict(),
  RATE_UPDATED: z.object({}).strict(),
} as const;

export const auditEventBaseSchema = z.object({
  workspaceId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  action: auditActionSchema,
  resourceType: auditResourceTypeSchema,
  resourceId: z.string().trim().min(1).max(100).nullable(),
});
