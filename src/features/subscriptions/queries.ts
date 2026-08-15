import "server-only";

import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { lockWorkspaceCommercialAccount } from "@/features/commercial/locking";
import { ensureCurrentAllowancePeriod } from "@/features/commercial/periods";
import { getWorkspaceMemberCapacityUsage } from "@/features/team/limits";
import { db } from "@/lib/db";

import { PlanConfigurationError } from "./errors";
import type { PlanOption } from "./types";
import { betaPlanCodeSchema } from "./validation";

export async function getPlanSettingsPageData() {
  const context = await requirePageCapability(CAPABILITIES.VIEW_SUBSCRIPTION);
  const data = await db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, context.workspace.id);
    const allowancePeriod = await ensureCurrentAllowancePeriod(
      transaction,
      context.workspace.id,
    );
    const [subscription, plans, memberUsage] =
      await Promise.all([
        transaction.subscription.findUnique({
          where: { workspaceId: context.workspace.id },
          select: {
            id: true,
            status: true,
            plan: {
              select: {
                code: true,
                name: true,
                betaPrice: true,
                currency: true,
                memberLimit: true,
                documentLimit: true,
              },
            },
          },
        }),
        transaction.plan.findMany({
          where: {
            isActive: true,
            isPublic: true,
            isAvailableForNewWorkspaces: true,
          },
          select: {
            code: true,
            name: true,
            description: true,
            betaPrice: true,
            currency: true,
            memberLimit: true,
            documentLimit: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        }),
        getWorkspaceMemberCapacityUsage(transaction, context.workspace.id),
      ]);

    return { subscription, plans, memberUsage, allowancePeriod };
  });

  if (!data.subscription) throw new PlanConfigurationError();

  const plans: PlanOption[] = data.plans
    .map((plan) => {
      const code = betaPlanCodeSchema.safeParse(plan.code);
      if (!code.success) return null;
      return {
        code: code.data,
        name: plan.name,
        description: plan.description,
        betaPrice: plan.betaPrice.toString(),
        currency: plan.currency,
        memberLimit: plan.memberLimit,
        documentLimit: plan.documentLimit,
      };
    })
    .filter((plan): plan is PlanOption => plan !== null);

  return {
    workspace: context.workspace,
    currentPlan: {
      ...data.subscription.plan,
      betaPrice: data.subscription.plan.betaPrice.toString(),
    },
    subscriptionStatus: data.subscription.status,
    plans,
    usage: {
      ...data.memberUsage,
      issuedDocuments: data.allowancePeriod.used,
    },
    canManageSubscription: hasCapability(
      context.membership,
      CAPABILITIES.MANAGE_SUBSCRIPTION,
    ),
  };
}
