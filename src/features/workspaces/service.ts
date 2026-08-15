import "server-only";

import {
  MembershipRole,
  MembershipStatus,
  SubscriptionStatus,
} from "@/generated/prisma/client";
import { recordAuditEvent } from "@/features/audit/service";
import { addUtcMonth } from "@/features/commercial/periods";
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
    const freePlan = await transaction.plan.findUnique({
      where: { code: "FREE" },
      select: {
        id: true,
        documentLimit: true,
        isActive: true,
        isAvailableForNewWorkspaces: true,
      },
    });

    if (!freePlan?.isActive || !freePlan.isAvailableForNewWorkspaces) {
      throw new WorkspaceConfigurationError();
    }

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
        planId: freePlan.id,
        status: SubscriptionStatus.BETA,
      },
      select: { startedAt: true },
    });

    await transaction.workspaceDocumentAllowancePeriod.create({
      data: {
        workspaceId: workspace.id,
        planId: freePlan.id,
        periodStart: subscription.startedAt,
        periodEnd: addUtcMonth(subscription.startedAt),
        allowance: freePlan.documentLimit,
      },
    });

    await recordAuditEvent(transaction, {
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "WORKSPACE_CREATED",
      resourceType: "WORKSPACE",
      resourceId: workspace.id,
      metadata: {
        workspaceType: workspace.type,
        initialPlan: "FREE",
      },
    });

    return workspace;
  });
}
