import "server-only";

import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { db } from "@/lib/db";

import { canManagePlatformRole, RECRUITABLE_PLATFORM_ROLES } from "./policy";

export async function getPlatformTeamPageData() {
  const context = await requirePlatformPageCapability(
    PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM,
  );
  const [members, invitations] = await Promise.all([
    db.platformMembership.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    db.platformInvitation.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
    }),
  ]);

  const roleOptions = RECRUITABLE_PLATFORM_ROLES.filter((role) =>
    canManagePlatformRole(context.membership.role, role),
  );

  return {
    currentMembership: context.membership,
    roleOptions,
    members: members.map((member) => ({
      ...member,
      manageable: canManagePlatformRole(context.membership.role, member.role),
    })),
    invitations: invitations.map((invitation) => ({
      ...invitation,
      manageable: canManagePlatformRole(
        context.membership.role,
        invitation.role,
      ),
      effectiveStatus:
        invitation.status === "PENDING" && invitation.expiresAt <= new Date()
          ? ("EXPIRED" as const)
          : invitation.status,
    })),
  };
}
