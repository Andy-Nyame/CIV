import "server-only";

import { recordAuditEvent } from "@/features/audit/service";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { lockWorkspaceCommercialAccount } from "@/features/commercial/locking";
import { ensureCurrentAllowancePeriod } from "@/features/commercial/periods";
import {
  getWorkspaceMemberCapacityUsage,
  lockWorkspaceTeam,
  teamTransactionOptions,
} from "@/features/team/limits";
import { resolveWorkspaceEntitlementsInTransaction } from "@/features/trials/entitlements";
import { db } from "@/lib/db";

import { requireSubscriptionManagerInTransaction } from "./authorization";
import {
  PlanConfigurationError,
  PlanDowngradeError,
  PlanValidationError,
} from "./errors";
import { betaPlanCodeSchema } from "./validation";

export type ChangeWorkspacePlanInput = {
  actorUserId: string;
  workspaceId: string;
  planCode: unknown;
};

export async function changeWorkspacePlan(input: ChangeWorkspacePlanInput) {
  const planCode = betaPlanCodeSchema.safeParse(input.planCode);
  if (!planCode.success) throw new PlanValidationError();

  return db.$transaction(async (transaction) => {
    await lockWorkspaceTeam(transaction, input.workspaceId);
    await lockWorkspaceCommercialAccount(transaction, input.workspaceId);
    await requireSubscriptionManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );

    const [subscription, targetPlan] = await Promise.all([
      transaction.subscription.findUnique({
        where: { workspaceId: input.workspaceId },
        select: {
          id: true,
          status: true,
          providerSubscriptionCode: true,
          plan: { select: { code: true, name: true } },
        },
      }),
      transaction.plan.findUnique({
        where: { code: planCode.data },
        select: {
          id: true,
          code: true,
          name: true,
          memberLimit: true,
          documentLimit: true,
          isActive: true,
          isPublic: true,
          isAvailableForNewWorkspaces: true,
          billingMode: true,
        },
      }),
    ]);

    if (
      !subscription ||
      !targetPlan?.isActive ||
      !targetPlan.isPublic ||
      !targetPlan.isAvailableForNewWorkspaces
    ) {
      throw new PlanConfigurationError();
    }
    if (
      targetPlan.billingMode !== "FREE" ||
      (subscription.status === "ACTIVE" &&
        subscription.providerSubscriptionCode)
    ) {
      // Recurring plans require verified checkout; a paid subscription must be
      // cancelled with Paystack before its fallback plan can take effect.
      throw new PlanConfigurationError();
    }

    const allowancePeriod = await ensureCurrentAllowancePeriod(
      transaction,
      input.workspaceId,
    );

    const memberUsage = await getWorkspaceMemberCapacityUsage(
      transaction,
      input.workspaceId,
    );

    if (
      targetPlan.memberLimit !== null &&
      memberUsage.reservedMemberCapacity > targetPlan.memberLimit
    ) {
      throw new PlanDowngradeError(
        "MEMBERS",
        memberUsage.reservedMemberCapacity,
        targetPlan.memberLimit,
        targetPlan.name,
      );
    }

    if (
      targetPlan.documentLimit !== null &&
      allowancePeriod.used > targetPlan.documentLimit
    ) {
      throw new PlanDowngradeError(
        "DOCUMENTS",
        allowancePeriod.used,
        targetPlan.documentLimit,
        targetPlan.name,
      );
    }

    const updated = await transaction.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: targetPlan.id,
        status: "BETA",
        endsAt: null,
      },
      select: {
        id: true,
        status: true,
        plan: {
          select: {
            code: true,
            name: true,
            memberLimit: true,
            documentLimit: true,
          },
        },
      },
    });

    const changed = subscription.plan.code !== updated.plan.code;

    if (changed) {
      const entitlements = await resolveWorkspaceEntitlementsInTransaction(
        transaction,
        input.workspaceId,
        { includePurchasedCredits: false },
      );
      await transaction.workspaceDocumentAllowancePeriod.update({
        where: { id: allowancePeriod.id },
        data: {
          planId: entitlements.effectivePlan.id,
          allowance: entitlements.effectivePlan.documentLimit,
        },
      });

      await recordAuditEvent(transaction, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "WORKSPACE_PLAN_CHANGED",
        resourceType: "SUBSCRIPTION",
        resourceId: subscription.id,
        metadata: {
          fromPlan: subscription.plan.code,
          toPlan: updated.plan.code,
        },
      });
    }

    return {
      ...updated,
      previousPlanCode: subscription.plan.code,
      previousPlanName: subscription.plan.name,
      changed,
    };
  }, teamTransactionOptions);
}

export { WorkspaceAuthorizationError };
