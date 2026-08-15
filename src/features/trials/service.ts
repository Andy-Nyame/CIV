import "server-only";

import {
  Prisma,
  type TrialConfiguration,
  type TrialGrantSource,
} from "@/generated/prisma/client";
import { recordAuditEvent } from "@/features/audit/service";
import { recordPlatformAuditEvent } from "@/features/platform-team/audit";
import { db } from "@/lib/db";

import { requireTrialManagerInTransaction } from "./authorization";
import {
  TrialConfigurationError,
  TrialIneligibleError,
  TrialUnavailableError,
  TrialValidationError,
} from "./errors";
import { evaluateTrialEligibility } from "./eligibility";
import {
  lockTrialConfiguration,
  lockWorkspaceTrials,
  trialTransactionOptions,
} from "./locking";
import { resolveWorkspaceEntitlementsInTransaction } from "./entitlements";
import {
  manualTrialGrantSchema,
  trialCancellationSchema,
  trialConfigurationInputSchema,
} from "./validation";

type TrialConfigurationWithPlans = TrialConfiguration & {
  trialPlan: {
    id: string;
    code: string;
    name: string;
    memberLimit: number | null;
    documentLimit: number | null;
    features: Prisma.JsonValue;
  };
  fallbackPlan: { id: string; code: string; name: string };
};

function trialEnd(startsAt: Date, durationDays: number) {
  return new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
}

async function createTrialInTransaction(
  transaction: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    workspaceName: string;
    configuration: TrialConfigurationWithPlans;
    grantSource: TrialGrantSource;
    grantedByUserId: string | null;
    workspaceActorUserId: string | null;
    now: Date;
  },
) {
  const endsAt = trialEnd(input.now, input.configuration.durationDays);
  const trial = await transaction.workspaceTrial.create({
    data: {
      workspaceId: input.workspaceId,
      trialPlanId: input.configuration.trialPlan.id,
      fallbackPlanId: input.configuration.fallbackPlan.id,
      startsAt: input.now,
      endsAt,
      grantedByUserId: input.grantedByUserId,
      grantSource: input.grantSource,
      trialPlanCodeSnapshot: input.configuration.trialPlan.code,
      trialPlanNameSnapshot: input.configuration.trialPlan.name,
      trialMemberLimitSnapshot: input.configuration.trialPlan.memberLimit,
      trialDocumentLimitSnapshot: input.configuration.trialPlan.documentLimit,
      trialFeaturesSnapshot:
        input.configuration.trialPlan.features === null
          ? Prisma.JsonNull
          : input.configuration.trialPlan.features,
      fallbackPlanCodeSnapshot: input.configuration.fallbackPlan.code,
      fallbackPlanNameSnapshot: input.configuration.fallbackPlan.name,
    },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      trialPlanCodeSnapshot: true,
      fallbackPlanCodeSnapshot: true,
    },
  });

  await recordAuditEvent(transaction, {
    workspaceId: input.workspaceId,
    actorUserId: input.workspaceActorUserId,
    action: "TRIAL_STARTED",
    resourceType: "TRIAL",
    resourceId: trial.id,
    metadata: {
      trialPlan: trial.trialPlanCodeSnapshot,
      fallbackPlan: trial.fallbackPlanCodeSnapshot,
      endsAt: trial.endsAt.toISOString(),
      grantSource: input.grantSource,
    },
  });

  if (input.grantedByUserId) {
    await recordPlatformAuditEvent(transaction, {
      actorUserId: input.grantedByUserId,
      action: "PLATFORM_TRIAL_GRANTED",
      resourceType: "WORKSPACE_TRIAL",
      resourceId: trial.id,
      metadata: {
        workspaceName: input.workspaceName,
        trialPlan: trial.trialPlanCodeSnapshot,
        endsAt: trial.endsAt.toISOString(),
      },
    });
  }

  return trial;
}

export async function getNewWorkspaceTrialFoundation(
  transaction: Prisma.TransactionClient,
) {
  const [freePlan, configuration] = await Promise.all([
    transaction.plan.findUnique({
      where: { code: "FREE" },
      select: {
        id: true,
        code: true,
        documentLimit: true,
        isActive: true,
        isAvailableForNewWorkspaces: true,
      },
    }),
    transaction.trialConfiguration.findUnique({
      where: { id: "GLOBAL" },
      include: { trialPlan: true, fallbackPlan: true },
    }),
  ]);
  if (!freePlan?.isActive || !freePlan.isAvailableForNewWorkspaces) {
    throw new TrialConfigurationError();
  }

  const configuredFallbackIsUsable = Boolean(
    configuration?.fallbackPlan.isActive &&
      configuration.fallbackPlan.isAvailableForNewWorkspaces,
  );
  const canAutoStart = Boolean(
    configuration?.enabled &&
      !configuration.paymentMethodRequired &&
      configuration.trialPlan.isActive &&
      configuredFallbackIsUsable,
  );

  return {
    normalPlan: configuredFallbackIsUsable
      ? {
          id: configuration!.fallbackPlan.id,
          code: configuration!.fallbackPlan.code,
          documentLimit: configuration!.fallbackPlan.documentLimit,
        }
      : freePlan,
    autoTrialConfiguration: canAutoStart
      ? (configuration as TrialConfigurationWithPlans)
      : null,
  };
}

export async function startNewWorkspaceTrialInTransaction(
  transaction: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    workspaceName: string;
    creatorUserId: string;
    configuration: TrialConfigurationWithPlans;
    now: Date;
  },
) {
  await lockWorkspaceTrials(transaction, input.workspaceId);
  const eligibility = await evaluateTrialEligibility(transaction, {
    workspaceId: input.workspaceId,
    source: "AUTO_NEW_WORKSPACE",
    now: input.now,
  });
  if (!eligibility.eligible || !eligibility.configuration) return null;
  return createTrialInTransaction(transaction, {
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    configuration: input.configuration,
    grantSource: "AUTO_NEW_WORKSPACE",
    grantedByUserId: null,
    workspaceActorUserId: input.creatorUserId,
    now: input.now,
  });
}

export async function grantConfiguredTrial(input: {
  actorUserId: string;
  workspaceId: unknown;
  now?: Date;
}) {
  const parsed = manualTrialGrantSchema.safeParse({
    workspaceId: input.workspaceId,
  });
  if (!parsed.success) {
    throw new TrialValidationError(parsed.error.flatten().fieldErrors);
  }
  const now = input.now ?? new Date();
  return db.$transaction(async (transaction) => {
    await lockWorkspaceTrials(transaction, parsed.data.workspaceId);
    await requireTrialManagerInTransaction(transaction, input.actorUserId);
    const eligibility = await evaluateTrialEligibility(transaction, {
      workspaceId: parsed.data.workspaceId,
      source: "PLATFORM_MANUAL",
      now,
    });
    if (
      !eligibility.eligible ||
      !eligibility.configuration ||
      !eligibility.workspace
    ) {
      throw new TrialIneligibleError(eligibility.reason ?? "PLAN_UNAVAILABLE");
    }
    const subscription = await transaction.subscription.findUnique({
      where: { workspaceId: eligibility.workspace.id },
      select: { plan: { select: { id: true, code: true, name: true } } },
    });
    if (!subscription) throw new TrialConfigurationError();
    const configuration = {
      ...(eligibility.configuration as TrialConfigurationWithPlans),
      fallbackPlan: subscription.plan,
    };
    return createTrialInTransaction(transaction, {
      workspaceId: eligibility.workspace.id,
      workspaceName: eligibility.workspace.name,
      configuration,
      grantSource: "PLATFORM_MANUAL",
      grantedByUserId: input.actorUserId,
      workspaceActorUserId: null,
      now,
    });
  }, trialTransactionOptions);
}

export async function cancelWorkspaceTrial(input: {
  actorUserId: string;
  trialId: unknown;
  now?: Date;
}) {
  const parsed = trialCancellationSchema.safeParse({ trialId: input.trialId });
  if (!parsed.success) throw new TrialValidationError();
  const now = input.now ?? new Date();
  return db.$transaction(async (transaction) => {
    await requireTrialManagerInTransaction(transaction, input.actorUserId);
    const candidate = await transaction.workspaceTrial.findUnique({
      where: { id: parsed.data.trialId },
      select: { workspaceId: true },
    });
    if (!candidate) throw new TrialUnavailableError();
    await lockWorkspaceTrials(transaction, candidate.workspaceId);
    const entitlements = await resolveWorkspaceEntitlementsInTransaction(
      transaction,
      candidate.workspaceId,
      { now, includePurchasedCredits: false, lock: false },
    );
    if (!entitlements.activeTrial || entitlements.activeTrial.id !== parsed.data.trialId) {
      if (entitlements.latestTrial?.id === parsed.data.trialId) {
        return { id: parsed.data.trialId, status: entitlements.latestTrial.status };
      }
      throw new TrialUnavailableError();
    }
    const workspace = await transaction.workspace.findUniqueOrThrow({
      where: { id: candidate.workspaceId },
      select: { name: true },
    });
    const trial = await transaction.workspaceTrial.update({
      where: { id: parsed.data.trialId },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    const metadata = {
      trialPlan: trial.trialPlanCodeSnapshot,
      fallbackPlan: trial.fallbackPlanCodeSnapshot,
      endsAt: trial.endsAt.toISOString(),
      grantSource: trial.grantSource,
    } as const;
    await recordAuditEvent(transaction, {
      workspaceId: trial.workspaceId,
      actorUserId: null,
      action: "TRIAL_CANCELLED",
      resourceType: "TRIAL",
      resourceId: trial.id,
      metadata,
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: input.actorUserId,
      action: "PLATFORM_TRIAL_CANCELLED",
      resourceType: "WORKSPACE_TRIAL",
      resourceId: trial.id,
      metadata: {
        workspaceName: workspace.name,
        trialPlan: trial.trialPlanCodeSnapshot,
      },
    });
    return { id: trial.id, status: trial.status };
  }, trialTransactionOptions);
}

function changedFields(before: object, after: object) {
  return Object.keys(after).filter(
    (key) => String(Reflect.get(before, key)) !== String(Reflect.get(after, key)),
  );
}

export async function updateTrialConfiguration(input: {
  actorUserId: string;
  configuration: unknown;
}) {
  const parsed = trialConfigurationInputSchema.safeParse(input.configuration);
  if (!parsed.success) {
    throw new TrialValidationError(parsed.error.flatten().fieldErrors);
  }
  return db.$transaction(async (transaction) => {
    await lockTrialConfiguration(transaction);
    await requireTrialManagerInTransaction(transaction, input.actorUserId);
    const [existing, trialPlan, fallbackPlan] = await Promise.all([
      transaction.trialConfiguration.findUnique({ where: { id: "GLOBAL" } }),
      transaction.plan.findUnique({ where: { code: parsed.data.trialPlanCode } }),
      transaction.plan.findUnique({ where: { code: parsed.data.fallbackPlanCode } }),
    ]);
    if (!existing || !trialPlan?.isActive || !fallbackPlan?.isActive) {
      throw new TrialConfigurationError();
    }
    const data = {
      enabled: parsed.data.enabled,
      trialPlanId: trialPlan.id,
      durationDays: parsed.data.durationDays,
      fallbackPlanId: fallbackPlan.id,
      newWorkspacesOnly: parsed.data.newWorkspacesOnly,
      oneTrialPerWorkspace: parsed.data.oneTrialPerWorkspace,
      paymentMethodRequired: parsed.data.paymentMethodRequired,
      allowManualGrant: parsed.data.allowManualGrant,
    };
    const fields = changedFields(existing, data);
    if (!fields.length) return { configuration: existing, changedFields: fields };
    const configuration = await transaction.trialConfiguration.update({
      where: { id: "GLOBAL" },
      data,
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: input.actorUserId,
      action: "PLATFORM_TRIAL_CONFIGURATION_UPDATED",
      resourceType: "TRIAL_CONFIGURATION",
      resourceId: configuration.id,
      metadata: { changedFields: fields },
    });
    return { configuration, changedFields: fields };
  }, trialTransactionOptions);
}
