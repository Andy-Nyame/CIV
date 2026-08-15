import "server-only";

import {
  MembershipRole,
  MembershipStatus,
  SubscriptionStatus,
} from "@/generated/prisma/client";
import { recordAuditEvent } from "@/features/audit/service";
import { addUtcMonth } from "@/features/commercial/periods";
import {
  getNewWorkspaceTrialFoundation,
  startNewWorkspaceTrialInTransaction,
} from "@/features/trials/service";
import { trialTransactionOptions } from "@/features/trials/locking";
import { db } from "@/lib/db";

import { workspaceInputSchema } from "./validation";

export class WorkspaceValidationError extends Error {
  constructor(
    readonly fieldErrors: {
      type?: string[];
      name?: string[];
    },
  ) {
    super("Workspace input is invalid.");
    this.name = "WorkspaceValidationError";
  }
}

export class WorkspaceConfigurationError extends Error {
  constructor() {
    super("The default CIV plan is unavailable.");
    this.name = "WorkspaceConfigurationError";
  }
}

type CreateWorkspaceParams = {
  userId: string;
  input: unknown;
};

export async function createWorkspace({
  userId,
  input,
}: CreateWorkspaceParams) {
  const result = workspaceInputSchema.safeParse(input);

  if (!result.success) {
    throw new WorkspaceValidationError(result.error.flatten().fieldErrors);
  }

  return db.$transaction(async (transaction) => {
    const foundation = await getNewWorkspaceTrialFoundation(transaction);
    if (!foundation.normalPlan) {
      throw new WorkspaceConfigurationError();
    }
    const now = new Date();

    const workspace = await transaction.workspace.create({
      data: {
        name: result.data.name,
        type: result.data.type,
      },
      select: {
        id: true,
        name: true,
        type: true,
      },
    });

    await transaction.membership.create({
      data: {
        userId,
        workspaceId: workspace.id,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });

    const subscription = await transaction.subscription.create({
      data: {
        workspaceId: workspace.id,
        planId: foundation.normalPlan.id,
        status: SubscriptionStatus.BETA,
        startedAt: now,
      },
      select: { startedAt: true },
    });

    await recordAuditEvent(transaction, {
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "WORKSPACE_CREATED",
      resourceType: "WORKSPACE",
      resourceId: workspace.id,
      metadata: {
        workspaceType: workspace.type,
        initialPlan: foundation.normalPlan.code,
      },
    });

    const trial = foundation.autoTrialConfiguration
      ? await startNewWorkspaceTrialInTransaction(transaction, {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          creatorUserId: userId,
          configuration: foundation.autoTrialConfiguration,
          now,
        })
      : null;

    await transaction.workspaceDocumentAllowancePeriod.create({
      data: {
        workspaceId: workspace.id,
        planId: trial?.id
          ? foundation.autoTrialConfiguration!.trialPlan.id
          : foundation.normalPlan.id,
        periodStart: subscription.startedAt,
        periodEnd: addUtcMonth(subscription.startedAt),
        allowance: trial?.id
          ? foundation.autoTrialConfiguration!.trialPlan.documentLimit
          : foundation.normalPlan.documentLimit,
      },
    });

    return workspace;
  }, trialTransactionOptions);
}
