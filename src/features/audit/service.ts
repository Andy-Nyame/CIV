import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { z } from "zod";

import {
  AUDIT_ACTION_RESOURCE,
  type AuditAction,
  type AuditResourceType,
} from "./registry";
import { auditEventBaseSchema, auditMetadataSchemas } from "./validation";

type AuditMetadataByAction = {
  [Action in AuditAction]: z.input<(typeof auditMetadataSchemas)[Action]>;
};

export type RecordAuditEventInput<Action extends AuditAction = AuditAction> = {
  workspaceId: string;
  actorUserId: string | null;
  action: Action;
  resourceType: (typeof AUDIT_ACTION_RESOURCE)[Action];
  resourceId: string | null;
  metadata: AuditMetadataByAction[Action];
};

export class AuditValidationError extends Error {
  constructor() {
    super("Audit event data is invalid.");
    this.name = "AuditValidationError";
  }
}

export async function recordAuditEvent<Action extends AuditAction>(
  transaction: Prisma.TransactionClient,
  input: RecordAuditEventInput<Action>,
) {
  const base = auditEventBaseSchema.safeParse(input);
  if (
    !base.success ||
    AUDIT_ACTION_RESOURCE[base.data.action] !== base.data.resourceType
  ) {
    throw new AuditValidationError();
  }

  const metadataSchema = auditMetadataSchemas[base.data.action];
  const metadata = metadataSchema.safeParse(input.metadata);
  if (!metadata.success) {
    throw new AuditValidationError();
  }

  const actor = base.data.actorUserId
    ? await transaction.user.findUnique({
        where: { id: base.data.actorUserId },
        select: {
          name: true,
          email: true,
          memberships: {
            where: {
              workspaceId: base.data.workspaceId,
              status: "ACTIVE",
              workspace: { archivedAt: null },
            },
            take: 1,
            select: { id: true },
          },
        },
      })
    : null;

  if (base.data.actorUserId && (!actor || actor.memberships.length === 0)) {
    throw new AuditValidationError();
  }

  const actorDisplayName = actor
    ? actor.name?.trim() || actor.email || "Workspace member"
    : undefined;
  const safeMetadata = {
    ...metadata.data,
    ...(actorDisplayName ? { actorDisplayName } : {}),
  } as Prisma.InputJsonObject;

  return transaction.auditEvent.create({
    data: {
      workspaceId: base.data.workspaceId,
      actorUserId: base.data.actorUserId,
      action: base.data.action,
      resourceType: base.data.resourceType as AuditResourceType,
      resourceId: base.data.resourceId,
      metadata: safeMetadata,
    },
    select: { id: true, createdAt: true },
  });
}
