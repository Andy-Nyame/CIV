import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";

import { PlatformAuditValidationError } from "./errors";
import { recruitablePlatformRoleSchema } from "./validation";

export const PLATFORM_AUDIT_ACTIONS = {
  PLATFORM_MEMBER_INVITED: "PLATFORM_MEMBER_INVITED",
  PLATFORM_INVITATION_CANCELLED: "PLATFORM_INVITATION_CANCELLED",
  PLATFORM_INVITATION_RENEWED: "PLATFORM_INVITATION_RENEWED",
  PLATFORM_INVITATION_ACCEPTED: "PLATFORM_INVITATION_ACCEPTED",
  PLATFORM_MEMBER_ROLE_CHANGED: "PLATFORM_MEMBER_ROLE_CHANGED",
  PLATFORM_MEMBER_SUSPENDED: "PLATFORM_MEMBER_SUSPENDED",
  PLATFORM_MEMBER_REACTIVATED: "PLATFORM_MEMBER_REACTIVATED",
  PLATFORM_MEMBER_REMOVED: "PLATFORM_MEMBER_REMOVED",
  PLATFORM_PLAN_UPDATED: "PLATFORM_PLAN_UPDATED",
  PLATFORM_CREDIT_PACK_CREATED: "PLATFORM_CREDIT_PACK_CREATED",
  PLATFORM_CREDIT_PACK_UPDATED: "PLATFORM_CREDIT_PACK_UPDATED",
  PLATFORM_CREDIT_PACK_ACTIVATED: "PLATFORM_CREDIT_PACK_ACTIVATED",
  PLATFORM_CREDIT_PACK_DEACTIVATED: "PLATFORM_CREDIT_PACK_DEACTIVATED",
} as const;

export type PlatformAuditAction =
  (typeof PLATFORM_AUDIT_ACTIONS)[keyof typeof PLATFORM_AUDIT_ACTIONS];

export const PLATFORM_AUDIT_RESOURCE_TYPES = {
  PLATFORM_INVITATION: "PLATFORM_INVITATION",
  PLATFORM_MEMBERSHIP: "PLATFORM_MEMBERSHIP",
  PLAN: "PLAN",
  DOCUMENT_CREDIT_PACK: "DOCUMENT_CREDIT_PACK",
} as const;

export type PlatformAuditResourceType =
  (typeof PLATFORM_AUDIT_RESOURCE_TYPES)[keyof typeof PLATFORM_AUDIT_RESOURCE_TYPES];

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const displayNameSchema = z.string().trim().min(1).max(320);

export const platformAuditMetadataSchemas = {
  PLATFORM_MEMBER_INVITED: z
    .object({ invitedEmail: emailSchema, role: recruitablePlatformRoleSchema })
    .strict(),
  PLATFORM_INVITATION_CANCELLED: z
    .object({ invitedEmail: emailSchema, role: recruitablePlatformRoleSchema })
    .strict(),
  PLATFORM_INVITATION_RENEWED: z
    .object({ invitedEmail: emailSchema, role: recruitablePlatformRoleSchema })
    .strict(),
  PLATFORM_INVITATION_ACCEPTED: z
    .object({ invitedEmail: emailSchema, role: recruitablePlatformRoleSchema })
    .strict(),
  PLATFORM_MEMBER_ROLE_CHANGED: z
    .object({
      memberDisplayName: displayNameSchema,
      fromRole: recruitablePlatformRoleSchema,
      toRole: recruitablePlatformRoleSchema,
    })
    .strict(),
  PLATFORM_MEMBER_SUSPENDED: z
    .object({ memberDisplayName: displayNameSchema, role: recruitablePlatformRoleSchema })
    .strict(),
  PLATFORM_MEMBER_REACTIVATED: z
    .object({ memberDisplayName: displayNameSchema, role: recruitablePlatformRoleSchema })
    .strict(),
  PLATFORM_MEMBER_REMOVED: z
    .object({ memberDisplayName: displayNameSchema, role: recruitablePlatformRoleSchema })
    .strict(),
  PLATFORM_PLAN_UPDATED: z
    .object({ planCode: z.string().min(1).max(50), changedFields: z.array(z.string().min(1).max(50)).min(1).max(12) })
    .strict(),
  PLATFORM_CREDIT_PACK_CREATED: z
    .object({ packCode: z.string().min(1).max(50), credits: z.number().int().positive() })
    .strict(),
  PLATFORM_CREDIT_PACK_UPDATED: z
    .object({ packCode: z.string().min(1).max(50), changedFields: z.array(z.string().min(1).max(50)).min(1).max(10) })
    .strict(),
  PLATFORM_CREDIT_PACK_ACTIVATED: z.object({ packCode: z.string().min(1).max(50) }).strict(),
  PLATFORM_CREDIT_PACK_DEACTIVATED: z.object({ packCode: z.string().min(1).max(50) }).strict(),
} as const;

const platformAuditActionSchema = z.enum(Object.values(PLATFORM_AUDIT_ACTIONS));
const platformAuditResourceTypeSchema = z.enum(
  Object.values(PLATFORM_AUDIT_RESOURCE_TYPES),
);

const actionResource = {
  PLATFORM_MEMBER_INVITED: "PLATFORM_INVITATION",
  PLATFORM_INVITATION_CANCELLED: "PLATFORM_INVITATION",
  PLATFORM_INVITATION_RENEWED: "PLATFORM_INVITATION",
  PLATFORM_INVITATION_ACCEPTED: "PLATFORM_INVITATION",
  PLATFORM_MEMBER_ROLE_CHANGED: "PLATFORM_MEMBERSHIP",
  PLATFORM_MEMBER_SUSPENDED: "PLATFORM_MEMBERSHIP",
  PLATFORM_MEMBER_REACTIVATED: "PLATFORM_MEMBERSHIP",
  PLATFORM_MEMBER_REMOVED: "PLATFORM_MEMBERSHIP",
  PLATFORM_PLAN_UPDATED: "PLAN",
  PLATFORM_CREDIT_PACK_CREATED: "DOCUMENT_CREDIT_PACK",
  PLATFORM_CREDIT_PACK_UPDATED: "DOCUMENT_CREDIT_PACK",
  PLATFORM_CREDIT_PACK_ACTIVATED: "DOCUMENT_CREDIT_PACK",
  PLATFORM_CREDIT_PACK_DEACTIVATED: "DOCUMENT_CREDIT_PACK",
} as const satisfies Record<PlatformAuditAction, PlatformAuditResourceType>;

type PlatformAuditMetadataByAction = {
  [Action in PlatformAuditAction]: z.input<
    (typeof platformAuditMetadataSchemas)[Action]
  >;
};

export type RecordPlatformAuditEventInput<
  Action extends PlatformAuditAction = PlatformAuditAction,
> = {
  actorUserId: string | null;
  action: Action;
  resourceType: (typeof actionResource)[Action];
  resourceId: string | null;
  metadata: PlatformAuditMetadataByAction[Action];
};

export async function recordPlatformAuditEvent<
  Action extends PlatformAuditAction,
>(
  transaction: Prisma.TransactionClient,
  input: RecordPlatformAuditEventInput<Action>,
) {
  const base = z
    .object({
      actorUserId: z.string().uuid().nullable(),
      action: platformAuditActionSchema,
      resourceType: platformAuditResourceTypeSchema,
      resourceId: z.string().trim().min(1).max(100).nullable(),
    })
    .safeParse(input);
  if (
    !base.success ||
    actionResource[base.data.action] !== base.data.resourceType
  ) {
    throw new PlatformAuditValidationError();
  }

  const metadata = platformAuditMetadataSchemas[base.data.action].safeParse(
    input.metadata,
  );
  if (!metadata.success) throw new PlatformAuditValidationError();

  const actor = base.data.actorUserId
    ? await transaction.user.findUnique({
        where: { id: base.data.actorUserId },
        select: {
          name: true,
          email: true,
          platformMembership: { select: { status: true } },
        },
      })
    : null;
  if (
    base.data.actorUserId &&
    (!actor || actor.platformMembership?.status !== "ACTIVE")
  ) {
    throw new PlatformAuditValidationError();
  }

  const actorDisplayName = actor
    ? actor.name?.trim() || actor.email || "CIV operator"
    : null;

  return transaction.platformAuditEvent.create({
    data: {
      actorUserId: base.data.actorUserId,
      actorDisplayName,
      action: base.data.action,
      resourceType: base.data.resourceType,
      resourceId: base.data.resourceId,
      metadata: metadata.data as Prisma.InputJsonObject,
    },
    select: { id: true, createdAt: true },
  });
}

export function platformAuditActionLabel(action: string) {
  const labels: Record<PlatformAuditAction, string> = {
    PLATFORM_MEMBER_INVITED: "Platform team invitation created",
    PLATFORM_INVITATION_CANCELLED: "Platform team invitation cancelled",
    PLATFORM_INVITATION_RENEWED: "Platform team invitation renewed",
    PLATFORM_INVITATION_ACCEPTED: "Platform team invitation accepted",
    PLATFORM_MEMBER_ROLE_CHANGED: "Platform team role changed",
    PLATFORM_MEMBER_SUSPENDED: "Platform member suspended",
    PLATFORM_MEMBER_REACTIVATED: "Platform member reactivated",
    PLATFORM_MEMBER_REMOVED: "Platform member removed",
    PLATFORM_PLAN_UPDATED: "Platform plan updated",
    PLATFORM_CREDIT_PACK_CREATED: "Document credit pack created",
    PLATFORM_CREDIT_PACK_UPDATED: "Document credit pack updated",
    PLATFORM_CREDIT_PACK_ACTIVATED: "Document credit pack activated",
    PLATFORM_CREDIT_PACK_DEACTIVATED: "Document credit pack deactivated",
  };
  return action in labels ? labels[action as PlatformAuditAction] : "Platform operation";
}

type PlatformAuditDisplayEvent = {
  action: string;
  actorDisplayName: string | null;
  context: unknown;
};

function readMetadata(metadata: unknown) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function platformAuditEventDescription(event: PlatformAuditDisplayEvent) {
  const actor = event.actorDisplayName?.trim() || "A CIV operator";
  const metadata = readMetadata(event.context);
  const member = text(metadata.memberDisplayName, "a platform member");
  const email = text(metadata.invitedEmail, "an invited account");
  const role = text(metadata.role, "a platform role")
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

  switch (event.action) {
    case "PLATFORM_MEMBER_INVITED":
      return `${actor} invited ${email} as ${role}.`;
    case "PLATFORM_INVITATION_CANCELLED":
      return `${actor} cancelled the invitation for ${email}.`;
    case "PLATFORM_INVITATION_RENEWED":
      return `${actor} generated a new invitation link for ${email}.`;
    case "PLATFORM_INVITATION_ACCEPTED":
      return `${actor} accepted a platform team invitation as ${role}.`;
    case "PLATFORM_MEMBER_ROLE_CHANGED": {
      const fromRole = text(metadata.fromRole, "the previous role");
      const toRole = text(metadata.toRole, "the new role");
      return `${actor} changed ${member}'s role from ${fromRole} to ${toRole}.`;
    }
    case "PLATFORM_MEMBER_SUSPENDED":
      return `${actor} suspended ${member}'s platform access.`;
    case "PLATFORM_MEMBER_REACTIVATED":
      return `${actor} reactivated ${member}'s platform access.`;
    case "PLATFORM_MEMBER_REMOVED":
      return `${actor} removed ${member} from the platform team.`;
    case "PLATFORM_PLAN_UPDATED":
      return `${actor} updated the ${text(metadata.planCode, "CIV")} plan.`;
    case "PLATFORM_CREDIT_PACK_CREATED":
      return `${actor} created the ${text(metadata.packCode, "document credit")} pack.`;
    case "PLATFORM_CREDIT_PACK_UPDATED":
      return `${actor} updated the ${text(metadata.packCode, "document credit")} pack.`;
    case "PLATFORM_CREDIT_PACK_ACTIVATED":
      return `${actor} activated the ${text(metadata.packCode, "document credit")} pack.`;
    case "PLATFORM_CREDIT_PACK_DEACTIVATED":
      return `${actor} deactivated the ${text(metadata.packCode, "document credit")} pack.`;
    default:
      return `${actor} completed a platform operation.`;
  }
}
