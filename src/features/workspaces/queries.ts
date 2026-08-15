import "server-only";

import { CAPABILITIES, hasCapability } from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { db } from "@/lib/db";

export async function getWorkspaceSettingsPageData() {
  const context = await requirePageCapability(CAPABILITIES.VIEW_WORKSPACE);
  const [workspace, archivedOwnedMemberships] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: context.workspace.id },
      select: {
      id: true,
      name: true,
      type: true,
      country: true,
      currency: true,
      email: true,
      phone: true,
      address: true,
      registrationNumber: true,
      businessTin: true,
      archivedAt: true,
      logo: {
        select: { updatedAt: true, mimeType: true, width: true, height: true },
      },
      memberships: {
        where: {
          status: "ACTIVE",
          role: { in: ["ADMIN", "MANAGER", "STAFF"] },
        },
        orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }],
        select: {
          id: true,
          role: true,
          user: { select: { name: true, email: true } },
        },
      },
      },
    }),
    getArchivedOwnedWorkspaces(context.user.id),
  ]);

  return {
    user: context.user,
    membership: context.membership,
    workspace,
    canManageSettings: hasCapability(
      context.membership,
      CAPABILITIES.MANAGE_WORKSPACE_SETTINGS,
    ),
    canViewSubscription: hasCapability(
      context.membership,
      CAPABILITIES.VIEW_SUBSCRIPTION,
    ),
    isOwner: context.membership.role === "OWNER",
    logoUrl: workspace.logo
      ? `/api/workspaces/current/logo?v=${workspace.logo.updatedAt.getTime()}`
      : null,
    archivedOwnedWorkspaces: archivedOwnedMemberships.map(
      ({ workspace: archivedWorkspace }) => archivedWorkspace,
    ),
  };
}

export async function getArchivedOwnedWorkspaces(userId: string) {
  return db.membership.findMany({
    where: {
      userId,
      role: "OWNER",
      status: "ACTIVE",
      workspace: { archivedAt: { not: null } },
    },
    orderBy: { workspace: { archivedAt: "desc" } },
    select: {
      workspace: {
        select: { id: true, name: true, type: true, archivedAt: true },
      },
    },
  });
}
