import { z } from "zod";

import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from "./registry";

const displayNameSchema = z.string().trim().min(1).max(320);
const emailSchema = z.string().trim().toLowerCase().email().max(320);
const roleSchema = z.enum(["OWNER", "ADMIN", "MANAGER", "STAFF"]);
const planCodeSchema = z.string().trim().min(1).max(50);

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
