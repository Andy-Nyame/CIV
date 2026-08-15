import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { recordPlatformAuditEvent } from "./audit";
import { requirePlatformTeamManagerInTransaction } from "./authorization";
import {
  PlatformInvitationConflictError,
  PlatformInvitationUnavailableError,
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
import {
  createPlatformInvitationToken,
  hashPlatformInvitationToken,
  isValidPlatformInvitationToken,
} from "./token";
import {
  platformInvitationIdSchema,
  platformInvitationInputSchema,
} from "./validation";

export const platformInvitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

async function expireStalePlatformInvitations(
  transaction: Prisma.TransactionClient,
  now: Date,
) {
  await transaction.platformInvitation.updateMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
}

async function assertSingleActivePlatformOwner(
  transaction: Prisma.TransactionClient,
) {
  const activeOwnerCount = await transaction.platformMembership.count({
    where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
  });
  assertPlatformOwnerInvariant({
    targetRole: "PLATFORM_OWNER",
    targetStatus: "ACTIVE",
    activeOwnerCount,
  });
}

export async function createPlatformInvitation(input: {
  actorUserId: string;
  invitation: unknown;
}) {
  const parsed = platformInvitationInputSchema.safeParse(input.invitation);
  if (!parsed.success) {
    throw new PlatformTeamValidationError(parsed.error.flatten().fieldErrors);
  }

  const { token, tokenHash } = createPlatformInvitationToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + platformInvitationLifetimeMs);

  try {
    const invitation = await db.$transaction(async (transaction) => {
      await lockPlatformTeam(transaction);
      const actor = await requirePlatformTeamManagerInTransaction(
        transaction,
        input.actorUserId,
      );
      assertCanManagePlatformRole(actor.role, parsed.data.role);
      await assertSingleActivePlatformOwner(transaction);
      await expireStalePlatformInvitations(transaction, now);

      const existingUser = await transaction.user.findUnique({
        where: { email: parsed.data.email },
        select: {
          platformMembership: { select: { status: true, role: true } },
        },
      });
      if (existingUser?.platformMembership?.status === "ACTIVE") {
        throw new PlatformInvitationConflictError("MEMBER");
      }
      if (existingUser?.platformMembership) {
        throw new PlatformInvitationConflictError("INACTIVE_MEMBER");
      }

      const duplicate = await transaction.platformInvitation.findFirst({
        where: { email: parsed.data.email, status: "PENDING" },
        select: { id: true },
      });
      if (duplicate) throw new PlatformInvitationConflictError("PENDING");

      const created = await transaction.platformInvitation.create({
        data: {
          email: parsed.data.email,
          role: parsed.data.role,
          tokenHash,
          invitedByUserId: input.actorUserId,
          expiresAt,
        },
        select: { id: true, email: true, role: true, expiresAt: true },
      });

      await recordPlatformAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "PLATFORM_MEMBER_INVITED",
        resourceType: "PLATFORM_INVITATION",
        resourceId: created.id,
        metadata: { invitedEmail: created.email, role: parsed.data.role },
      });
      return created;
    }, platformTeamTransactionOptions);

    return { ...invitation, token };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new PlatformInvitationConflictError("PENDING");
    }
    throw error;
  }
}

export async function cancelPlatformInvitation(input: {
  actorUserId: string;
  invitationId: unknown;
}) {
  const invitationId = platformInvitationIdSchema.safeParse(input.invitationId);
  if (!invitationId.success) {
    throw new PlatformInvitationUnavailableError("INVALID");
  }

  return db.$transaction(async (transaction) => {
    await lockPlatformTeam(transaction);
    const actor = await requirePlatformTeamManagerInTransaction(
      transaction,
      input.actorUserId,
    );
    await assertSingleActivePlatformOwner(transaction);
    const invitation = await transaction.platformInvitation.findFirst({
      where: { id: invitationId.data, status: "PENDING" },
      select: { id: true, email: true, role: true },
    });
    if (!invitation) throw new PlatformInvitationUnavailableError("INVALID");
    assertCanManagePlatformRole(actor.role, invitation.role);

    await transaction.platformInvitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: input.actorUserId,
      action: "PLATFORM_INVITATION_CANCELLED",
      resourceType: "PLATFORM_INVITATION",
      resourceId: invitation.id,
      metadata: { invitedEmail: invitation.email, role: invitation.role },
    });
    return { id: invitation.id };
  }, platformTeamTransactionOptions);
}

export async function renewPlatformInvitation(input: {
  actorUserId: string;
  invitationId: unknown;
}) {
  const invitationId = platformInvitationIdSchema.safeParse(input.invitationId);
  if (!invitationId.success) {
    throw new PlatformInvitationUnavailableError("INVALID");
  }
  const { token, tokenHash } = createPlatformInvitationToken();
  const expiresAt = new Date(Date.now() + platformInvitationLifetimeMs);

  const invitation = await db.$transaction(async (transaction) => {
    await lockPlatformTeam(transaction);
    const actor = await requirePlatformTeamManagerInTransaction(
      transaction,
      input.actorUserId,
    );
    await assertSingleActivePlatformOwner(transaction);
    const existing = await transaction.platformInvitation.findFirst({
      where: { id: invitationId.data, status: "PENDING" },
      select: { id: true, email: true, role: true },
    });
    if (!existing) throw new PlatformInvitationUnavailableError("INVALID");
    assertCanManagePlatformRole(actor.role, existing.role);

    const renewed = await transaction.platformInvitation.update({
      where: { id: existing.id },
      data: { tokenHash, expiresAt, revokedAt: null },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: input.actorUserId,
      action: "PLATFORM_INVITATION_RENEWED",
      resourceType: "PLATFORM_INVITATION",
      resourceId: existing.id,
      metadata: { invitedEmail: existing.email, role: existing.role },
    });
    return renewed;
  }, platformTeamTransactionOptions);

  return { ...invitation, token };
}

export async function getPlatformInvitationByToken(token: unknown) {
  if (!isValidPlatformInvitationToken(token)) return null;
  const invitation = await db.platformInvitation.findUnique({
    where: { tokenHash: hashPlatformInvitationToken(token) },
    select: { email: true, role: true, status: true, expiresAt: true },
  });
  if (!invitation) return null;
  return {
    ...invitation,
    status:
      invitation.status === "PENDING" && invitation.expiresAt <= new Date()
        ? ("EXPIRED" as const)
        : invitation.status,
  };
}

export async function acceptPlatformInvitation(input: {
  token: unknown;
  userId: string;
  userEmail: string | null | undefined;
}) {
  if (!isValidPlatformInvitationToken(input.token)) {
    throw new PlatformInvitationUnavailableError("INVALID");
  }
  const tokenHash = hashPlatformInvitationToken(input.token);
  const normalizedEmail = input.userEmail?.trim().toLowerCase();

  return db.$transaction(async (transaction) => {
    await lockPlatformTeam(transaction);
    await assertSingleActivePlatformOwner(transaction);
    const invitation = await transaction.platformInvitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!invitation) throw new PlatformInvitationUnavailableError("INVALID");
    if (invitation.status === "REVOKED") {
      throw new PlatformInvitationUnavailableError("CANCELLED");
    }
    if (invitation.status === "ACCEPTED") {
      throw new PlatformInvitationUnavailableError("ACCEPTED");
    }
    if (invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) {
      throw new PlatformInvitationUnavailableError("EXPIRED");
    }
    if (!normalizedEmail || normalizedEmail !== invitation.email) {
      throw new PlatformInvitationUnavailableError("EMAIL_MISMATCH");
    }
    assertCanManagePlatformRole("PLATFORM_OWNER", invitation.role);

    const existing = await transaction.platformMembership.findUnique({
      where: { userId: input.userId },
      select: { id: true, role: true, status: true },
    });
    if (existing?.status === "ACTIVE") {
      throw new PlatformInvitationConflictError("MEMBER");
    }
    if (existing?.role === "PLATFORM_OWNER") {
      throw new PlatformInvitationUnavailableError("INVALID");
    }

    const membership = existing
      ? await transaction.platformMembership.update({
          where: { id: existing.id },
          data: { role: invitation.role, status: "ACTIVE" },
          select: { id: true, role: true, status: true },
        })
      : await transaction.platformMembership.create({
          data: {
            userId: input.userId,
            role: invitation.role,
            status: "ACTIVE",
          },
          select: { id: true, role: true, status: true },
        });

    await transaction.platformInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: input.userId,
      action: "PLATFORM_INVITATION_ACCEPTED",
      resourceType: "PLATFORM_INVITATION",
      resourceId: invitation.id,
      metadata: { invitedEmail: invitation.email, role: invitation.role },
    });
    return membership;
  }, platformTeamTransactionOptions);
}
