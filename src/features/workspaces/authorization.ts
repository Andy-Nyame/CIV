import "server-only";

import { CAPABILITIES, hasCapability } from "@/features/authorization/capabilities";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import type { Prisma } from "@/generated/prisma/client";

import { WorkspaceLifecycleError } from "./settings-errors";

export const workspaceTransactionOptions = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

export async function lockWorkspace(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text AS lock
  `;
}

export async function requireWorkspaceSettingsManagerInTransaction(
  transaction: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
) {
  const membership = await transaction.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: {
      role: true,
      status: true,
      workspace: { select: { archivedAt: true } },
    },
  });

  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.workspace.archivedAt !== null ||
    !hasCapability(membership, CAPABILITIES.MANAGE_WORKSPACE_SETTINGS)
  ) {
    throw new WorkspaceAuthorizationError();
  }

  return membership;
}

export async function requireWorkspaceOwnerInTransaction(
  transaction: Prisma.TransactionClient,
  userId: string,
  workspaceId: string,
  options: { allowArchived?: boolean } = {},
) {
  const membership = await transaction.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: {
      id: true,
      role: true,
      status: true,
      user: { select: { name: true, email: true } },
      workspace: {
        select: { id: true, name: true, archivedAt: true },
      },
    },
  });

  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.role !== "OWNER" ||
    (!options.allowArchived && membership.workspace.archivedAt !== null)
  ) {
    throw new WorkspaceLifecycleError("OWNER_REQUIRED");
  }

  return membership;
}
