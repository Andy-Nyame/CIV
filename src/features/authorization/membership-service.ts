import "server-only";

import { z } from "zod";

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

export type MembershipMutationInput = z.infer<
  typeof membershipMutationSchema
>;

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

    return transaction.membership.update({
      where: { id: target.id },
      data,
      select: {
        id: true,
        role: true,
        status: true,
      },
    });
  });
}

export { OwnerProtectionError, WorkspaceAuthorizationError };
