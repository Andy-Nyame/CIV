import "server-only";

import type { Prisma, WorkspaceTrial } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/features/audit/service";
import { getPurchasedCreditBalance } from "@/features/commercial/ledger";
import { db } from "@/lib/db";

import { TrialConfigurationError } from "./errors";
import { lockWorkspaceTrials, trialTransactionOptions } from "./locking";

type TrialForEntitlements = Pick<
  WorkspaceTrial,
  | "id"
  | "status"
  | "startsAt"
  | "endsAt"
  | "grantSource"
  | "trialPlanId"
  | "trialPlanCodeSnapshot"
  | "trialPlanNameSnapshot"
  | "trialMemberLimitSnapshot"
  | "trialDocumentLimitSnapshot"
  | "trialFeaturesSnapshot"
  | "fallbackPlanCodeSnapshot"
  | "fallbackPlanNameSnapshot"
>;

async function expireTrial(
  transaction: Prisma.TransactionClient,
  trial: TrialForEntitlements,
  workspaceId: string,
  now: Date,
) {
  const expired = await transaction.workspaceTrial.updateMany({
    where: { id: trial.id, status: "ACTIVE", endsAt: { lte: now } },
    data: { status: "EXPIRED", expiredAt: now },
  });
  if (expired.count === 1) {
    await recordAuditEvent(transaction, {
      workspaceId,
      actorUserId: null,
      action: "TRIAL_EXPIRED",
      resourceType: "TRIAL",
      resourceId: trial.id,
      metadata: {
        trialPlan: trial.trialPlanCodeSnapshot,
        fallbackPlan: trial.fallbackPlanCodeSnapshot,
        endsAt: trial.endsAt.toISOString(),
        grantSource: trial.grantSource,
      },
    });
  }
}

export async function resolveWorkspaceEntitlementsInTransaction(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  options: { now?: Date; includePurchasedCredits?: boolean; lock?: boolean } = {},
) {
  const now = options.now ?? new Date();
  if (options.lock !== false) await lockWorkspaceTrials(transaction, workspaceId);

  let subscription = await transaction.subscription.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      fallbackPlanId: true,
      plan: {
        select: {
          id: true,
          code: true,
          name: true,
          memberLimit: true,
          documentLimit: true,
          features: true,
        },
      },
    },
  });
  if (!subscription) throw new TrialConfigurationError();

  if (
    subscription.fallbackPlanId &&
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd <= now &&
    (subscription.cancelAtPeriodEnd || subscription.status === "PAST_DUE")
  ) {
    const recurring = await import("@/features/payments/recurring-subscriptions");
    await recurring.applySubscriptionFallbackInTransaction(
      transaction,
      subscription.id,
      now,
    );
    subscription = await transaction.subscription.findUnique({
      where: { id: subscription.id },
      select: {
        id: true,
        status: true,
        startedAt: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        fallbackPlanId: true,
        plan: {
          select: {
            id: true,
            code: true,
            name: true,
            memberLimit: true,
            documentLimit: true,
            features: true,
          },
        },
      },
    });
    if (!subscription) throw new TrialConfigurationError();
  }

  let activeTrial = await transaction.workspaceTrial.findFirst({
    where: { workspaceId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      grantSource: true,
      trialPlanId: true,
      trialPlanCodeSnapshot: true,
      trialPlanNameSnapshot: true,
      trialMemberLimitSnapshot: true,
      trialDocumentLimitSnapshot: true,
      trialFeaturesSnapshot: true,
      fallbackPlanCodeSnapshot: true,
      fallbackPlanNameSnapshot: true,
    },
  });

  if (activeTrial && activeTrial.endsAt <= now) {
    await expireTrial(transaction, activeTrial, workspaceId, now);
    activeTrial = null;
  }

  const latestTrial = activeTrial ?? await transaction.workspaceTrial.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      grantSource: true,
      trialPlanId: true,
      trialPlanCodeSnapshot: true,
      trialPlanNameSnapshot: true,
      trialMemberLimitSnapshot: true,
      trialDocumentLimitSnapshot: true,
      trialFeaturesSnapshot: true,
      fallbackPlanCodeSnapshot: true,
      fallbackPlanNameSnapshot: true,
    },
  });
  const purchasedCredits = options.includePurchasedCredits === false
    ? 0
    : await getPurchasedCreditBalance(transaction, workspaceId);

  const effectivePlan = activeTrial
    ? {
        source: "TRIAL" as const,
        id: activeTrial.trialPlanId,
        code: activeTrial.trialPlanCodeSnapshot,
        name: activeTrial.trialPlanNameSnapshot,
        memberLimit: activeTrial.trialMemberLimitSnapshot,
        documentLimit: activeTrial.trialDocumentLimitSnapshot,
        features: activeTrial.trialFeaturesSnapshot,
      }
    : { source: "SUBSCRIPTION" as const, ...subscription.plan };

  return {
    normalSubscription: subscription,
    activeTrial,
    latestTrial,
    effectivePlan,
    purchasedCredits,
  };
}

export async function getWorkspaceEntitlements(
  workspaceId: string,
  options: { now?: Date; includePurchasedCredits?: boolean } = {},
) {
  return db.$transaction(
    (transaction) =>
      resolveWorkspaceEntitlementsInTransaction(transaction, workspaceId, options),
    trialTransactionOptions,
  );
}

export async function expireDueWorkspaceTrials(now = new Date(), limit = 250) {
  const due = await db.workspaceTrial.findMany({
    where: { status: "ACTIVE", endsAt: { lte: now } },
    select: { workspaceId: true },
    orderBy: { endsAt: "asc" },
    take: limit,
  });

  for (const trial of due) {
    await getWorkspaceEntitlements(trial.workspaceId, {
      now,
      includePurchasedCredits: false,
    });
  }

  return due.length;
}
