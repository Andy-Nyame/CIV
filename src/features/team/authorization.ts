import "server-only";

import { CAPABILITIES, hasCapability } from "@/features/authorization/capabilities";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import type { Prisma } from "@/generated/prisma/client";

export async function requireTeamManagerInTransaction(
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
    !hasCapability(membership, CAPABILITIES.MANAGE_TEAM)
  ) {
    throw new WorkspaceAuthorizationError();
  }

  return membership;
}
