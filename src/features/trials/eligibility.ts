import "server-only";

import type { Prisma, TrialGrantSource } from "@/generated/prisma/client";

import type { TrialEligibilityReason } from "./errors";

export async function evaluateTrialEligibility(
  transaction: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    source: TrialGrantSource;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [configuration, workspace] = await Promise.all([
    transaction.trialConfiguration.findUnique({
      where: { id: "GLOBAL" },
      include: { trialPlan: true, fallbackPlan: true },
    }),
    transaction.workspace.findUnique({
      where: { id: input.workspaceId },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        createdAt: true,
        trials: {
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, endsAt: true },
        },
      },
    }),
  ]);

  let reason: TrialEligibilityReason | null = null;
  if (!configuration?.enabled) reason = "DISABLED";
  else if (!workspace || workspace.archivedAt) reason = "WORKSPACE_ARCHIVED";
  else if (
    workspace.trials.some(
      (trial) => trial.status === "ACTIVE" && trial.endsAt > now,
    )
  ) {
    reason = "ALREADY_ACTIVE";
  } else if (
    configuration.oneTrialPerWorkspace &&
    workspace.trials.length > 0
  ) {
    reason = "ALREADY_USED";
  } else if (
    input.source === "AUTO_NEW_WORKSPACE" &&
    configuration.newWorkspacesOnly &&
    now.getTime() - workspace.createdAt.getTime() > 5 * 60 * 1000
  ) {
    reason = "NOT_NEW_WORKSPACE";
  } else if (configuration.paymentMethodRequired) {
    reason = "PAYMENT_METHOD_REQUIRED";
  } else if (
    input.source === "PLATFORM_MANUAL" &&
    !configuration.allowManualGrant
  ) {
    reason = "MANUAL_GRANTS_DISABLED";
  } else if (
    !configuration.trialPlan.isActive ||
    !configuration.fallbackPlan.isActive
  ) {
    reason = "PLAN_UNAVAILABLE";
  }

  return {
    eligible: reason === null,
    reason,
    configuration,
    workspace,
  };
}
