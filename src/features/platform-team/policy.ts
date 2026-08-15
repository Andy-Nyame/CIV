import type {
  PlatformMembershipStatus,
  PlatformRole,
} from "@/generated/prisma/enums";

import {
  PlatformOwnerProtectionError,
  PlatformTeamAuthorizationError,
} from "./errors";
import type { RecruitablePlatformRole } from "./validation";

export const RECRUITABLE_PLATFORM_ROLES = [
  "PLATFORM_ADMIN",
  "ANALYST",
  "SUPPORT",
  "FINANCE",
] as const satisfies readonly RecruitablePlatformRole[];

export function canManagePlatformRole(
  actorRole: PlatformRole,
  targetRole: PlatformRole,
) {
  if (targetRole === "PLATFORM_OWNER") return false;
  if (actorRole === "PLATFORM_OWNER") return true;
  return actorRole === "PLATFORM_ADMIN" && targetRole !== "PLATFORM_ADMIN";
}

export function assertCanManagePlatformRole(
  actorRole: PlatformRole,
  targetRole: PlatformRole,
): asserts targetRole is RecruitablePlatformRole {
  if (targetRole === "PLATFORM_OWNER") {
    throw new PlatformOwnerProtectionError();
  }
  if (!canManagePlatformRole(actorRole, targetRole)) {
    throw new PlatformTeamAuthorizationError();
  }
}

export function assertPlatformOwnerInvariant(input: {
  targetRole: PlatformRole;
  targetStatus: PlatformMembershipStatus;
  nextRole?: PlatformRole;
  nextStatus?: PlatformMembershipStatus;
  activeOwnerCount: number;
}) {
  if (input.activeOwnerCount !== 1) throw new PlatformOwnerProtectionError();
  if (input.targetRole === "PLATFORM_OWNER") {
    const nextRole = input.nextRole ?? input.targetRole;
    const nextStatus = input.nextStatus ?? input.targetStatus;
    if (
      nextRole !== "PLATFORM_OWNER" ||
      nextStatus !== input.targetStatus ||
      nextStatus !== "ACTIVE"
    ) {
      throw new PlatformOwnerProtectionError();
    }
  }
  if (input.nextRole === "PLATFORM_OWNER") {
    throw new PlatformOwnerProtectionError();
  }
}
