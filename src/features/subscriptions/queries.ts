import "server-only";

import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { getWorkspaceMemberCapacityUsage } from "@/features/team/limits";
import { db } from "@/lib/db";

import { PlanConfigurationError } from "./errors";
import { getIssuedDocumentUsage } from "./usage";
import type { PlanOption } from "./types";
import { betaPlanCodeSchema } from "./validation";

const planOrder = ["FREE", "STARTER", "BUSINESS", "PRO", "ENTERPRISE"];

export async function getPlanSettingsPageData() {
  const context = await requirePageCapability(CAPABILITIES.VIEW_SUBSCRIPTION);
  const data = await db.$transaction(async (transaction) => {
    const [subscription, plans, memberUsage, issuedDocuments] =
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
          where: { isActive: true, isPublic: true },
          select: {
            code: true,
            name: true,
            description: true,
            betaPrice: true,
            currency: true,
            memberLimit: true,
            documentLimit: true,
          },
        }),
        getWorkspaceMemberCapacityUsage(transaction, context.workspace.id),
        getIssuedDocumentUsage(transaction, context.workspace.id),
      ]);

    return { subscription, plans, memberUsage, issuedDocuments };
  });

  if (!data.subscription) throw new PlanConfigurationError();

  const plans: PlanOption[] = data.plans
    .map((plan) => {
      const code = betaPlanCodeSchema.safeParse(plan.code);
      if (!code.success) return null;
      return {
        ...plan,
        code: code.data,
        betaPrice: plan.betaPrice.toString(),
      };
    })
    .filter((plan): plan is PlanOption => plan !== null)
    .sort((left, right) => planOrder.indexOf(left.code) - planOrder.indexOf(right.code));

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
      issuedDocuments: data.issuedDocuments,
    },
    canManageSubscription: hasCapability(
      context.membership,
      CAPABILITIES.MANAGE_SUBSCRIPTION,
    ),
  };
}
