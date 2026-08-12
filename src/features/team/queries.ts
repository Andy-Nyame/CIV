import "server-only";

import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { db } from "@/lib/db";

export async function getTeamPageData() {
  const context = await requirePageCapability(CAPABILITIES.VIEW_TEAM);
  const members = await db.membership.findMany({
    where: { workspaceId: context.workspace.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      role: true,
      status: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });
  const canManageTeam = hasCapability(
    context.membership,
    CAPABILITIES.MANAGE_TEAM,
  );
  const invitations = canManageTeam
    ? await db.invitation.findMany({
        where: { workspaceId: context.workspace.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      })
    : [];

  return {
    workspace: context.workspace,
    currentMembership: context.membership,
    members,
    invitations,
    canManageTeam,
  };
}
