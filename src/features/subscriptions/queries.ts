import "server-only";

import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { lockWorkspaceCommercialAccount } from "@/features/commercial/locking";
import { ensureCurrentAllowancePeriod } from "@/features/commercial/periods";
import { getWorkspaceMemberCapacityUsage } from "@/features/team/limits";
import { resolveWorkspaceEntitlementsInTransaction } from "@/features/trials/entitlements";
import { trialTransactionOptions } from "@/features/trials/locking";
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
    const [subscription, plans, memberUsage, entitlements] =
      await Promise.all([
        transaction.subscription.findUnique({
          where: { workspaceId: context.workspace.id },
          select: {
            id: true,
            status: true,
            provider: true,
            providerSubscriptionCode: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            nextPaymentAt: true,
            lastPaymentAt: true,
            cancelAtPeriodEnd: true,
            fallbackPlan: { select: { code: true, name: true } },
            pendingPlan: { select: { code: true, name: true } },
            plan: {
              select: {
                code: true,
                name: true,
                betaPrice: true,
                monthlyPrice: true,
                currency: true,
                billingMode: true,
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
            OR: [
              { isAvailableForNewWorkspaces: true },
              { billingMode: "CUSTOM" },
            ],
          },
          select: {
            code: true,
            name: true,
            description: true,
            betaPrice: true,
            monthlyPrice: true,
            currency: true,
            billingMode: true,
            paystackPlanCode: true,
            memberLimit: true,
            documentLimit: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        }),
        getWorkspaceMemberCapacityUsage(transaction, context.workspace.id),
        resolveWorkspaceEntitlementsInTransaction(
          transaction,
          context.workspace.id,
          { includePurchasedCredits: false },
        ),
      ]);

    return {
      subscription,
      plans,
      memberUsage,
      allowancePeriod,
      entitlements,
    };
  }, trialTransactionOptions);

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
        monthlyPrice: plan.monthlyPrice.toString(),
        currency: plan.currency,
        billingMode: plan.billingMode,
        paystackPlanConfigured: Boolean(plan.paystackPlanCode),
        memberLimit: plan.memberLimit,
        documentLimit: plan.documentLimit,
      };
    })
    .filter((plan): plan is PlanOption => plan !== null);

  return {
    resolvedAt: new Date(),
    workspace: context.workspace,
    currentPlan: {
      ...data.subscription.plan,
      betaPrice: data.subscription.plan.betaPrice.toString(),
      monthlyPrice: data.subscription.plan.monthlyPrice.toString(),
    },
    effectivePlan: data.entitlements.effectivePlan,
    activeTrial: data.entitlements.activeTrial,
    latestTrial: data.entitlements.latestTrial,
    subscriptionStatus: data.subscription.status,
    recurringBilling: {
      provider: data.subscription.provider,
      connected: Boolean(data.subscription.providerSubscriptionCode),
      currentPeriodStart: data.subscription.currentPeriodStart,
      currentPeriodEnd: data.subscription.currentPeriodEnd,
      nextPaymentAt: data.subscription.nextPaymentAt,
      lastPaymentAt: data.subscription.lastPaymentAt,
      cancelAtPeriodEnd: data.subscription.cancelAtPeriodEnd,
      fallbackPlan: data.subscription.fallbackPlan,
      pendingPlan: data.subscription.pendingPlan,
    },
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
