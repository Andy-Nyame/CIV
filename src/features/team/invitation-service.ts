import "server-only";

import { recordAuditEvent } from "@/features/audit/service";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { requireTeamManagerInTransaction } from "./authorization";
import {
  InvitationConflictError,
  InvitationUnavailableError,
  TeamValidationError,
} from "./errors";
import {
  assertActiveMemberCapacity,
  assertInvitationCapacity,
  lockWorkspaceTeam,
  teamTransactionOptions,
} from "./limits";
import {
  createInvitationToken,
  hashInvitationToken,
  isValidInvitationToken,
} from "./token";
import { invitationIdSchema, invitationInputSchema } from "./validation";

export const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

type CreateInvitationInput = {
  actorUserId: string;
  workspaceId: string;
  input: unknown;
};

async function expireStalePendingInvitations(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  now: Date,
) {
  await transaction.invitation.updateMany({
    where: {
      workspaceId,
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });
}

export async function createInvitation({
  actorUserId,
  workspaceId,
  input,
}: CreateInvitationInput) {
  const result = invitationInputSchema.safeParse(input);

  if (!result.success) {
    throw new TeamValidationError(result.error.flatten().fieldErrors);
  }

  const { token, tokenHash } = createInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + invitationLifetimeMs);

  try {
    const invitation = await db.$transaction(async (transaction) => {
      await lockWorkspaceTeam(transaction, workspaceId);
      await requireTeamManagerInTransaction(
        transaction,
        actorUserId,
        workspaceId,
      );
      await expireStalePendingInvitations(transaction, workspaceId, now);

      const existingUser = await transaction.user.findUnique({
        where: { email: result.data.email },
        select: {
          memberships: {
            where: { workspaceId },
            select: { status: true },
          },
        },
      });
      const membership = existingUser?.memberships[0];

      if (membership?.status === "ACTIVE") {
        throw new InvitationConflictError("MEMBER");
      }
      if (membership) {
        throw new InvitationConflictError("INACTIVE_MEMBER");
      }

      const duplicate = await transaction.invitation.findFirst({
        where: {
          workspaceId,
          email: result.data.email,
          status: "PENDING",
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new InvitationConflictError("PENDING");
      }

      await assertInvitationCapacity(transaction, workspaceId, now);

      const invitation = await transaction.invitation.create({
        data: {
          workspaceId,
          email: result.data.email,
          tokenHash,
          role: result.data.role,
          invitedByUserId: actorUserId,
          expiresAt,
        },
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
        },
      });

      await recordAuditEvent(transaction, {
        workspaceId,
        actorUserId,
        action: "MEMBER_INVITED",
        resourceType: "INVITATION",
        resourceId: invitation.id,
        metadata: {
          invitedEmail: invitation.email,
          role: invitation.role,
        },
      });

      return invitation;
    }, teamTransactionOptions);

    return { ...invitation, token };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new InvitationConflictError("PENDING");
    }

    throw error;
  }
}

export async function cancelInvitation({
  actorUserId,
  workspaceId,
  invitationId,
}: {
  actorUserId: string;
  workspaceId: string;
  invitationId: unknown;
}) {
  const result = invitationIdSchema.safeParse(invitationId);
  if (!result.success) throw new InvitationUnavailableError("INVALID");

  return db.$transaction(async (transaction) => {
    await lockWorkspaceTeam(transaction, workspaceId);
    await requireTeamManagerInTransaction(
      transaction,
      actorUserId,
      workspaceId,
    );
    const invitation = await transaction.invitation.findFirst({
      where: {
        id: result.data,
        workspaceId,
        status: "PENDING",
      },
      select: { id: true, email: true, role: true },
    });

    if (!invitation) throw new InvitationUnavailableError("INVALID");

    const cancelled = await transaction.invitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED", revokedAt: new Date() },
      select: { id: true },
    });

    await recordAuditEvent(transaction, {
      workspaceId,
      actorUserId,
      action: "INVITATION_CANCELLED",
      resourceType: "INVITATION",
      resourceId: invitation.id,
      metadata: {
        invitedEmail: invitation.email,
        role: invitation.role,
      },
    });

    return cancelled;
  }, teamTransactionOptions);
}

export async function renewInvitation({
  actorUserId,
  workspaceId,
  invitationId,
}: {
  actorUserId: string;
  workspaceId: string;
  invitationId: unknown;
}) {
  const result = invitationIdSchema.safeParse(invitationId);
  if (!result.success) throw new InvitationUnavailableError("INVALID");
  const { token, tokenHash } = createInvitationToken();
  const expiresAt = new Date(Date.now() + invitationLifetimeMs);

  const invitation = await db.$transaction(async (transaction) => {
    await lockWorkspaceTeam(transaction, workspaceId);
    await requireTeamManagerInTransaction(
      transaction,
      actorUserId,
      workspaceId,
    );
    const existing = await transaction.invitation.findFirst({
      where: {
        id: result.data,
        workspaceId,
        status: "PENDING",
      },
      select: { id: true, email: true, role: true },
    });

    if (!existing) throw new InvitationUnavailableError("INVALID");

    const renewed = await transaction.invitation.update({
      where: { id: existing.id },
      data: { tokenHash, expiresAt, revokedAt: null },
      select: { id: true, email: true, role: true, expiresAt: true },
    });

    await recordAuditEvent(transaction, {
      workspaceId,
      actorUserId,
      action: "INVITATION_RENEWED",
      resourceType: "INVITATION",
      resourceId: existing.id,
      metadata: {
        invitedEmail: existing.email,
        role: existing.role,
      },
    });

    return renewed;
  }, teamTransactionOptions);

  return { ...invitation, token };
}

export async function getInvitationByToken(token: unknown) {
  if (!isValidInvitationToken(token)) return null;

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      workspace: { select: { name: true } },
    },
  });

  if (!invitation) return null;

  const effectiveStatus =
    invitation.status === "PENDING" && invitation.expiresAt <= new Date()
      ? "EXPIRED"
      : invitation.status;

  return { ...invitation, status: effectiveStatus };
}

export async function acceptInvitation({
  token,
  userId,
  userEmail,
}: {
  token: unknown;
  userId: string;
  userEmail: string | null | undefined;
}) {
  if (!isValidInvitationToken(token)) {
    throw new InvitationUnavailableError("INVALID");
  }

  const normalizedEmail = userEmail?.trim().toLowerCase();
  const tokenHash = hashInvitationToken(token);

  return db.$transaction(async (transaction) => {
    const initialInvitation = await transaction.invitation.findUnique({
      where: { tokenHash },
      select: { workspaceId: true },
    });
    if (!initialInvitation) throw new InvitationUnavailableError("INVALID");

    await lockWorkspaceTeam(transaction, initialInvitation.workspaceId);
    const invitation = await transaction.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        workspaceId: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!invitation) throw new InvitationUnavailableError("INVALID");
    if (invitation.status === "REVOKED") {
      throw new InvitationUnavailableError("CANCELLED");
    }
    if (invitation.status === "ACCEPTED") {
      throw new InvitationUnavailableError("ACCEPTED");
    }
    if (invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) {
      throw new InvitationUnavailableError("EXPIRED");
    }
    if (!normalizedEmail || normalizedEmail !== invitation.email) {
      throw new InvitationUnavailableError("EMAIL_MISMATCH");
    }

    const existing = await transaction.membership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: invitation.workspaceId,
          userId,
        },
      },
      select: { id: true, status: true },
    });

    if (existing?.status === "ACTIVE") {
      throw new InvitationConflictError("MEMBER");
    }

    await assertActiveMemberCapacity(transaction, invitation.workspaceId);

    const membership = existing
      ? await transaction.membership.update({
          where: { id: existing.id },
          data: { role: invitation.role, status: "ACTIVE" },
          select: { id: true, workspaceId: true, role: true, status: true },
        })
      : await transaction.membership.create({
          data: {
            userId,
            workspaceId: invitation.workspaceId,
            role: invitation.role,
            status: "ACTIVE",
          },
          select: { id: true, workspaceId: true, role: true, status: true },
        });

    await transaction.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
      select: { id: true },
    });

    await recordAuditEvent(transaction, {
      workspaceId: invitation.workspaceId,
      actorUserId: userId,
      action: "INVITATION_ACCEPTED",
      resourceType: "INVITATION",
      resourceId: invitation.id,
      metadata: {
        invitedEmail: invitation.email,
        role: invitation.role,
      },
    });

    return membership;
  }, teamTransactionOptions);
}
