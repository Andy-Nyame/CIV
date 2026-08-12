import "server-only";

import { CAPABILITIES } from "@/features/authorization/capabilities";
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

  return {
    workspace: context.workspace,
    currentMembership: context.membership,
    members,
  };
}
