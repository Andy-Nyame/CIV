import type {
  MembershipRole,
  MembershipStatus,
} from "@/generated/prisma/enums";

import { OwnerProtectionError } from "./errors";

type OwnerProtectionInput = {
  actorRole: MembershipRole;
  targetRole: MembershipRole;
  targetStatus: MembershipStatus;
  nextRole?: MembershipRole;
  nextStatus?: MembershipStatus;
  activeOwnerCount: number;
};

export function assertOwnerProtections({
  actorRole,
  targetRole,
  targetStatus,
  nextRole = targetRole,
  nextStatus = targetStatus,
  activeOwnerCount,
}: OwnerProtectionInput) {
  if (activeOwnerCount < 1) {
    throw new OwnerProtectionError();
  }

  if (targetRole === "OWNER" && actorRole !== "OWNER") {
    throw new OwnerProtectionError();
  }

  // New Owners must be created through a future, dedicated ownership flow.
  if (targetRole !== "OWNER" && nextRole === "OWNER") {
    throw new OwnerProtectionError();
  }

  const targetIsActiveOwner =
    targetRole === "OWNER" && targetStatus === "ACTIVE";
  const targetRemainsActiveOwner =
    nextRole === "OWNER" && nextStatus === "ACTIVE";

  if (
    targetIsActiveOwner &&
    !targetRemainsActiveOwner &&
    activeOwnerCount <= 1
  ) {
    throw new OwnerProtectionError();
  }
}
