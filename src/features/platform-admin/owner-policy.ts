import type {
  PlatformMembershipStatus,
  PlatformRole,
} from "@/generated/prisma/enums";

import { PlatformOwnerProtectionError } from "./errors";

export function assertPlatformOwnerProtections(input: {
  targetRole: PlatformRole;
  targetStatus: PlatformMembershipStatus;
  nextRole?: PlatformRole;
  nextStatus?: PlatformMembershipStatus;
  activeOwnerCount: number;
}) {
  const nextRole = input.nextRole ?? input.targetRole;
  const nextStatus = input.nextStatus ?? input.targetStatus;

  if (input.activeOwnerCount < 1) throw new PlatformOwnerProtectionError();

  // Ordinary platform-team operations cannot grant, demote, suspend, or remove
  // the protected ownership role. A future explicit transfer service owns that.
  if (
    input.targetRole === "PLATFORM_OWNER" ||
    nextRole === "PLATFORM_OWNER"
  ) {
    const unchanged =
      input.targetRole === "PLATFORM_OWNER" &&
      nextRole === "PLATFORM_OWNER" &&
      input.targetStatus === nextStatus;
    if (!unchanged) throw new PlatformOwnerProtectionError();
  }
}
