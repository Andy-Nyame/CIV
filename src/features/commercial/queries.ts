import "server-only";

import {
  PLATFORM_CAPABILITIES,
  hasPlatformCapability,
} from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { resolveWorkspaceEntitlementsInTransaction } from "@/features/trials/entitlements";
import { db } from "@/lib/db";

import { getPurchasedCreditBalance } from "./ledger";
import {
  commercialTransactionOptions,
  lockWorkspaceCommercialAccount,
} from "./locking";
import { ensureCurrentAllowancePeriod } from "./periods";

export async function getPlatformPlanManagementData() {
  const context = await requirePlatformPageCapability(
    PLATFORM_CAPABILITIES.VIEW_PLANS,
  );
  const plans = await db.plan.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: {
      code: true,
      name: true,
      description: true,
      memberLimit: true,
      documentLimit: true,
      betaPrice: true,
      currency: true,
      isActive: true,
      isPublic: true,
      isAvailableForNewWorkspaces: true,
      sortOrder: true,
      _count: { select: { subscriptions: true } },
    },
  });
  return {
    plans: plans.map(({ betaPrice, _count, ...plan }) => ({
      ...plan,
      betaPrice: betaPrice.toFixed(4),
      workspaces: _count.subscriptions,
    })),
    canManage: hasPlatformCapability(
      context.membership,
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_PLANS,
    ),
  };
}

export async function getPlatformCreditPackManagementData() {
  const context = await requirePlatformPageCapability(
    PLATFORM_CAPABILITIES.VIEW_PLANS,
  );
  const [packs, ledger] = await Promise.all([
    db.documentCreditPack.findMany({
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        creditAmount: true,
        price: true,
        currency: true,
        isActive: true,
        isPublic: true,
        sortOrder: true,
        _count: { select: { purchases: true } },
      },
    }),
    db.documentCreditTransaction.aggregate({
      _sum: { amount: true },
    }),
  ]);
  return {
    packs: packs.map(({ price, _count, ...pack }) => ({
      ...pack,
      price: price.toFixed(4),
      purchases: _count.purchases,
    })),
    outstandingPurchasedCredits: ledger._sum.amount ?? 0,
    canManage: hasPlatformCapability(
      context.membership,
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_PLANS,
    ),
  };
}

export async function getDocumentCreditsPageData() {
  const context = await requirePageCapability(CAPABILITIES.VIEW_SUBSCRIPTION);
  const data = await db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, context.workspace.id);
    const period = await ensureCurrentAllowancePeriod(
      transaction,
      context.workspace.id,
    );
    const [purchasedBalance, subscription, packs, acquisitions, entitlements] =
      await Promise.all([
        getPurchasedCreditBalance(transaction, context.workspace.id),
        transaction.subscription.findUnique({
          where: { workspaceId: context.workspace.id },
          select: { status: true, plan: { select: { code: true, name: true } } },
        }),
        transaction.documentCreditPack.findMany({
          where: { isActive: true, isPublic: true },
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
          select: {
            code: true,
            name: true,
            description: true,
            creditAmount: true,
            price: true,
            currency: true,
          },
        }),
        transaction.documentCreditPurchase.findMany({
          where: { workspaceId: context.workspace.id, betaAcquisition: true },
          select: { pack: { select: { code: true } } },
        }),
        resolveWorkspaceEntitlementsInTransaction(
          transaction,
          context.workspace.id,
          { includePurchasedCredits: false },
        ),
      ]);
    return {
      period,
      purchasedBalance,
      subscription,
      packs,
      acquisitions,
      entitlements,
    };
  }, commercialTransactionOptions);
  if (!data.subscription) throw new Error("Workspace subscription unavailable.");
  const monthlyRemaining =
    data.period.allowance === null
      ? null
      : Math.max(0, data.period.allowance - data.period.used);
  return {
    workspace: context.workspace,
    currentPlan: data.subscription.plan,
    effectivePlan: data.entitlements.effectivePlan,
    activeTrial: data.entitlements.activeTrial,
    subscriptionStatus: data.subscription.status,
    period: data.period,
    monthlyRemaining,
    purchasedBalance: data.purchasedBalance,
    totalCapacity:
      monthlyRemaining === null ? null : monthlyRemaining + data.purchasedBalance,
    packs: data.packs.map((pack) => ({
      ...pack,
      price: pack.price.toFixed(4),
      alreadyAcquired: data.acquisitions.some(
        (purchase) => purchase.pack.code === pack.code,
      ),
    })),
    canAcquire: hasCapability(
      context.membership,
      CAPABILITIES.MANAGE_SUBSCRIPTION,
    ),
  };
}
