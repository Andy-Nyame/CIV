import "server-only";

import { recordAuditEvent } from "@/features/audit/service";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { db } from "@/lib/db";

import {
  lockWorkspace,
  requireWorkspaceOwnerInTransaction,
  workspaceTransactionOptions,
} from "./authorization";
import { WorkspaceLifecycleError } from "./settings-errors";
import { transferOwnershipSchema, workspaceIdSchema } from "./validation";

function displayName(user: { name: string | null; email: string | null }) {
  return user.name?.trim() || user.email || "Workspace member";
}

export async function archiveWorkspace(input: {
  actorUserId: string;
  workspaceId: string;
}) {
  return db.$transaction(async (transaction) => {
    await lockWorkspace(transaction, input.workspaceId);
    const owner = await requireWorkspaceOwnerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );
    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "WORKSPACE_ARCHIVED",
      resourceType: "WORKSPACE",
      resourceId: input.workspaceId,
      metadata: { workspaceName: owner.workspace.name },
    });
    const updated = await transaction.workspace.updateMany({
      where: { id: input.workspaceId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (updated.count !== 1) throw new WorkspaceLifecycleError("ALREADY_ARCHIVED");
  }, workspaceTransactionOptions);
}

export async function restoreWorkspace(input: {
  actorUserId: string;
  workspaceId: unknown;
}) {
  const workspaceId = workspaceIdSchema.safeParse(input.workspaceId);
  if (!workspaceId.success) throw new WorkspaceAuthorizationError();

  return db.$transaction(async (transaction) => {
    await lockWorkspace(transaction, workspaceId.data);
    const owner = await requireWorkspaceOwnerInTransaction(
      transaction,
      input.actorUserId,
      workspaceId.data,
      { allowArchived: true },
    );
    const updated = await transaction.workspace.updateMany({
      where: { id: workspaceId.data, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    if (updated.count !== 1) throw new WorkspaceLifecycleError("NOT_ARCHIVED");

    await recordAuditEvent(transaction, {
      workspaceId: workspaceId.data,
      actorUserId: input.actorUserId,
      action: "WORKSPACE_RESTORED",
      resourceType: "WORKSPACE",
      resourceId: workspaceId.data,
      metadata: { workspaceName: owner.workspace.name },
    });
    return { workspaceId: workspaceId.data };
  }, workspaceTransactionOptions);
}

export async function leaveWorkspace(input: {
  actorUserId: string;
  workspaceId: string;
}) {
  return db.$transaction(async (transaction) => {
    await lockWorkspace(transaction, input.workspaceId);
    const membership = await transaction.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
        },
      },
      select: {
        id: true,
        role: true,
        status: true,
        user: { select: { name: true, email: true } },
        workspace: { select: { archivedAt: true } },
      },
    });
    if (
      !membership ||
      membership.status !== "ACTIVE" ||
      membership.workspace.archivedAt !== null
    ) {
      throw new WorkspaceAuthorizationError();
    }
    if (membership.role === "OWNER") {
      throw new WorkspaceLifecycleError("OWNER_CANNOT_LEAVE");
    }

    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "MEMBER_LEFT_WORKSPACE",
      resourceType: "MEMBERSHIP",
      resourceId: membership.id,
      metadata: {
        memberDisplayName: displayName(membership.user),
        role: membership.role,
      },
    });
    await transaction.membership.update({
      where: { id: membership.id },
      data: { status: "REMOVED" },
    });
  }, workspaceTransactionOptions);
}

export async function transferWorkspaceOwnership(input: {
  actorUserId: string;
  workspaceId: string;
  values: unknown;
}) {
  const result = transferOwnershipSchema.safeParse(input.values);
  if (!result.success) throw new WorkspaceLifecycleError("CONFIRMATION_REQUIRED");

  return db.$transaction(async (transaction) => {
    await lockWorkspace(transaction, input.workspaceId);
    const owner = await requireWorkspaceOwnerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );
    const target = await transaction.membership.findFirst({
      where: {
        id: result.data.targetMembershipId,
        workspaceId: input.workspaceId,
        status: "ACTIVE",
        role: { in: ["ADMIN", "MANAGER", "STAFF"] },
      },
      select: {
        id: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!target) throw new WorkspaceLifecycleError("INVALID_TARGET");

    await transaction.membership.update({
      where: { id: target.id },
      data: { role: "OWNER" },
    });
    await transaction.membership.update({
      where: { id: owner.id },
      data: { role: "ADMIN" },
    });
    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "WORKSPACE_OWNERSHIP_TRANSFERRED",
      resourceType: "WORKSPACE",
      resourceId: input.workspaceId,
      metadata: {
        previousOwnerDisplayName: displayName(owner.user),
        newOwnerDisplayName: displayName(target.user),
      },
    });

    return { newOwnerMembershipId: target.id };
  }, workspaceTransactionOptions);
}

export const workspacePermanentDeletionPolicy = {
  available: false,
  reason:
    "Permanent workspace deletion is unavailable in CIV V1. Archive preserves retained business and audit history.",
} as const;
