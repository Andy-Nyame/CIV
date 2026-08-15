import "server-only";

import { z } from "zod";

import { recordAuditEvent } from "@/features/audit/service";
import { requireTeamManagerInTransaction } from "@/features/team/authorization";
import { MemberLimitError } from "@/features/team/errors";
import {
  assertActiveMemberCapacity,
  lockWorkspaceTeam,
  teamTransactionOptions,
} from "@/features/team/limits";

import { CAPABILITIES, hasCapability } from "./capabilities";
import {
  OwnerProtectionError,
  WorkspaceAuthorizationError,
} from "./errors";
import { assertOwnerProtections } from "./owner-policy";
import {
  MembershipRole,
  MembershipStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { db } from "@/lib/db";

const membershipMutationSchema = z
  .object({
    actorUserId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    targetMembershipId: z.string().uuid(),
    role: z.enum(["OWNER", "ADMIN", "MANAGER", "STAFF"]).optional(),
    status: z
      .enum(["ACTIVE", "INVITED", "SUSPENDED", "REMOVED"])
      .optional(),
  })
  .refine((input) => input.role !== undefined || input.status !== undefined);

const teamMembershipMutationSchema = z
  .object({
    actorUserId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    targetMembershipId: z.string().uuid(),
    role: z.enum(["ADMIN", "MANAGER", "STAFF"]).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "REMOVED"]).optional(),
  })
  .refine((input) => input.role !== undefined || input.status !== undefined);

export type MembershipMutationInput = z.infer<
  typeof membershipMutationSchema
>;

type MembershipAuditTarget = {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  user: { name: string | null; email: string | null };
};

async function recordMembershipMutationAuditEvents(
  transaction: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    workspaceId: string;
    before: MembershipAuditTarget;
    after: Pick<MembershipAuditTarget, "id" | "role" | "status">;
  },
) {
  const memberDisplayName =
    input.before.user.name?.trim() ||
    input.before.user.email ||
    "Workspace member";

  if (input.before.role !== input.after.role) {
    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "MEMBER_ROLE_CHANGED",
      resourceType: "MEMBERSHIP",
      resourceId: input.after.id,
      metadata: {
        memberDisplayName,
        fromRole: input.before.role,
        toRole: input.after.role,
      },
    });
  }

  if (input.before.status === input.after.status) return;

  const action =
    input.after.status === MembershipStatus.SUSPENDED
      ? "MEMBER_SUSPENDED"
      : input.after.status === MembershipStatus.REMOVED
        ? "MEMBER_REMOVED"
        : input.after.status === MembershipStatus.ACTIVE
          ? "MEMBER_REACTIVATED"
          : null;

  if (!action) return;

  await recordAuditEvent(transaction, {
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action,
    resourceType: "MEMBERSHIP",
    resourceId: input.after.id,
    metadata: {
      memberDisplayName,
      role: input.after.role,
    },
  });
}

export async function updateWorkspaceMembership(input: unknown) {
  const result = membershipMutationSchema.safeParse(input);

  if (!result.success) {
    throw new WorkspaceAuthorizationError();
  }

  const mutation = result.data;

  return db.$transaction(async (transaction) => {
    // Serialize supported membership mutations per workspace so two requests
    // cannot concurrently remove the last active Owner.
    await transaction.$queryRaw<[{ lock: string }]>`
      SELECT pg_advisory_xact_lock(hashtext(${mutation.workspaceId}))::text AS lock
    `;

    const actor = await transaction.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: mutation.workspaceId,
          userId: mutation.actorUserId,
        },
      },
      select: {
        role: true,
        status: true,
        workspace: { select: { archivedAt: true } },
      },
    });

    if (
      !actor ||
      actor.status !== MembershipStatus.ACTIVE ||
      actor.workspace.archivedAt !== null ||
      !hasCapability(actor, CAPABILITIES.MANAGE_TEAM)
    ) {
      throw new WorkspaceAuthorizationError();
    }

    const target = await transaction.membership.findFirst({
      where: {
        id: mutation.targetMembershipId,
        workspaceId: mutation.workspaceId,
      },
      select: {
        id: true,
        role: true,
        status: true,
        user: { select: { name: true, email: true } },
      },
    });

    if (!target) {
      throw new WorkspaceAuthorizationError();
    }

    const activeOwnerCount = await transaction.membership.count({
      where: {
        workspaceId: mutation.workspaceId,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });

    assertOwnerProtections({
      actorRole: actor.role,
      targetRole: target.role,
      targetStatus: target.status,
      nextRole: mutation.role,
      nextStatus: mutation.status,
      activeOwnerCount,
    });

    const data: Prisma.MembershipUpdateInput = {};

    if (mutation.role !== undefined) {
      data.role = mutation.role;
    }

    if (mutation.status !== undefined) {
      data.status = mutation.status;
    }

    const updated = await transaction.membership.update({
      where: { id: target.id },
      data,
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    await recordMembershipMutationAuditEvents(transaction, {
      actorUserId: mutation.actorUserId,
      workspaceId: mutation.workspaceId,
      before: target,
      after: updated,
    });

    return updated;
  }, teamTransactionOptions);
}

export async function manageWorkspaceMember(input: unknown) {
  const result = teamMembershipMutationSchema.safeParse(input);
  if (!result.success) throw new WorkspaceAuthorizationError();
  const mutation = result.data;

  return db.$transaction(async (transaction) => {
    await lockWorkspaceTeam(transaction, mutation.workspaceId);
    const actor = await requireTeamManagerInTransaction(
      transaction,
      mutation.actorUserId,
      mutation.workspaceId,
    );
    const target = await transaction.membership.findFirst({
      where: {
        id: mutation.targetMembershipId,
        workspaceId: mutation.workspaceId,
      },
      select: {
        id: true,
        role: true,
        status: true,
        user: { select: { name: true, email: true } },
      },
    });

    if (!target) throw new WorkspaceAuthorizationError();
    if (target.role === MembershipRole.OWNER) {
      throw new OwnerProtectionError();
    }

    const activeOwnerCount = await transaction.membership.count({
      where: {
        workspaceId: mutation.workspaceId,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });
    assertOwnerProtections({
      actorRole: actor.role,
      targetRole: target.role,
      targetStatus: target.status,
      nextRole: mutation.role,
      nextStatus: mutation.status,
      activeOwnerCount,
    });

    if (
      mutation.status === "ACTIVE" &&
      target.status !== MembershipStatus.ACTIVE
    ) {
      await assertActiveMemberCapacity(transaction, mutation.workspaceId);
    }

    const data: Prisma.MembershipUpdateInput = {};
    if (mutation.role !== undefined) data.role = mutation.role;
    if (mutation.status !== undefined) data.status = mutation.status;

    const updated = await transaction.membership.update({
      where: { id: target.id },
      data,
      select: { id: true, role: true, status: true },
    });

    await recordMembershipMutationAuditEvents(transaction, {
      actorUserId: mutation.actorUserId,
      workspaceId: mutation.workspaceId,
      before: target,
      after: updated,
    });

    return updated;
  }, teamTransactionOptions);
}

export {
  MemberLimitError,
  OwnerProtectionError,
  WorkspaceAuthorizationError,
};
