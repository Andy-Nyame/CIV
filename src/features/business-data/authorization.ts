import "server-only";

import { CAPABILITIES, getDocumentAccessFilter, hasCapability, type Capability } from "@/features/authorization/capabilities";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import type { Prisma } from "@/generated/prisma/client";

export async function requireWorkspaceCapabilityInTransaction(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  workspaceId: string,
  capability: Capability,
) {
  const membership = await transaction.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actorUserId } },
    select: { role: true, status: true, userId: true, workspaceId: true, workspace: { select: { archivedAt: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.workspace.archivedAt || !hasCapability(membership, capability)) {
    throw new WorkspaceAuthorizationError();
  }
  return membership;
}

export async function requireDocumentAccessInTransaction(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  workspaceId: string,
  documentId: string,
) {
  const membership = await requireWorkspaceCapabilityInTransaction(
    transaction,
    actorUserId,
    workspaceId,
    CAPABILITIES.UPDATE_DRAFT_DOCUMENT,
  );
  const filter = getDocumentAccessFilter(membership);
  if (!filter) throw new WorkspaceAuthorizationError();
  const document = await transaction.document.findFirst({
    where: { id: documentId, ...filter, status: "DRAFT", archivedAt: null },
  });
  if (!document) throw new WorkspaceAuthorizationError();
  return { membership, document };
}
