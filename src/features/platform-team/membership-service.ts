import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { recordPlatformAuditEvent } from "./audit";
import { requirePlatformTeamManagerInTransaction } from "./authorization";
import {
  PlatformTeamAuthorizationError,
  PlatformTeamValidationError,
} from "./errors";
import {
  lockPlatformTeam,
  platformTeamTransactionOptions,
} from "./locking";
import {
  assertCanManagePlatformRole,
  assertPlatformOwnerInvariant,
} from "./policy";
import { platformMembershipMutationSchema } from "./validation";

export async function managePlatformMember(input: unknown) {
  const parsed = platformMembershipMutationSchema.safeParse(input);
  if (!parsed.success) {
    throw new PlatformTeamValidationError(parsed.error.flatten().fieldErrors);
  }
  const mutation = parsed.data;

  return db.$transaction(async (transaction) => {
    await lockPlatformTeam(transaction);
    const actor = await requirePlatformTeamManagerInTransaction(
      transaction,
      mutation.actorUserId,
    );
    const target = await transaction.platformMembership.findUnique({
      where: { id: mutation.targetMembershipId },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!target) throw new PlatformTeamAuthorizationError();

    const activeOwnerCount = await transaction.platformMembership.count({
      where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    });
    assertPlatformOwnerInvariant({
      targetRole: target.role,
      targetStatus: target.status,
      nextRole: mutation.role,
      nextStatus: mutation.status,
      activeOwnerCount,
    });
    assertCanManagePlatformRole(actor.role, target.role);
    if (mutation.role) assertCanManagePlatformRole(actor.role, mutation.role);

    const data: Prisma.PlatformMembershipUpdateInput = {};
    if (mutation.role) data.role = mutation.role;
    if (mutation.status) data.status = mutation.status;
    const updated = await transaction.platformMembership.update({
      where: { id: target.id },
      data,
      select: { id: true, role: true, status: true },
    });

    const displayName =
      target.user.name?.trim() || target.user.email || "Platform member";
    const updatedRole = mutation.role ?? target.role;
    if (target.role !== updated.role) {
      await recordPlatformAuditEvent(transaction, {
        actorUserId: mutation.actorUserId,
        action: "PLATFORM_MEMBER_ROLE_CHANGED",
        resourceType: "PLATFORM_MEMBERSHIP",
        resourceId: target.id,
        metadata: {
          memberDisplayName: displayName,
          fromRole: target.role,
          toRole: updatedRole,
        },
      });
    }
    if (target.status !== updated.status) {
      const action =
        updated.status === "SUSPENDED"
          ? "PLATFORM_MEMBER_SUSPENDED"
          : updated.status === "REMOVED"
            ? "PLATFORM_MEMBER_REMOVED"
            : updated.status === "ACTIVE"
              ? "PLATFORM_MEMBER_REACTIVATED"
              : null;
      if (action) {
        await recordPlatformAuditEvent(transaction, {
          actorUserId: mutation.actorUserId,
          action,
          resourceType: "PLATFORM_MEMBERSHIP",
          resourceId: target.id,
          metadata: { memberDisplayName: displayName, role: updatedRole },
        });
      }
    }
    return updated;
  }, platformTeamTransactionOptions);
}
