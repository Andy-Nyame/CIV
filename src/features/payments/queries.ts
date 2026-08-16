import "server-only";

import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { getPlanSettingsPageData } from "@/features/subscriptions/queries";
import { db } from "@/lib/db";

import { readPaystackConfig } from "./config";
import { PaymentValidationError } from "./errors";

const referencePattern = /^CIV-PAY-[A-F0-9]{32}$/;

export async function getWorkspaceBillingPageData() {
  const planData = await getPlanSettingsPageData();
  const [payments, billingPeriods, subscriptionChanges] = await Promise.all([
    db.payment.findMany({
    where: { workspaceId: planData.workspace.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: {
      id: true,
      internalReference: true,
      purpose: true,
      provider: true,
      amount: true,
      currency: true,
      status: true,
      createdAt: true,
      completedAt: true,
      documentCreditPurchase: {
        select: {
          status: true,
          creditAmountSnapshot: true,
          pack: { select: { code: true, name: true } },
        },
      },
      subscriptionChange: {
        select: {
          status: true,
          targetPlanCodeSnapshot: true,
          targetPlanNameSnapshot: true,
        },
      },
      subscriptionBillingPeriod: {
        select: { status: true, periodStart: true, periodEnd: true },
      },
    },
    }),
    db.subscriptionBillingPeriod.findMany({
      where: { subscription: { workspaceId: planData.workspace.id } },
      orderBy: [{ periodStart: "desc" }, { id: "desc" }],
      take: 12,
      select: {
        id: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        amount: true,
        currency: true,
        paidAt: true,
        failedAt: true,
        plan: { select: { name: true, code: true } },
      },
    }),
    db.subscriptionChange.findMany({
      where: { workspaceId: planData.workspace.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        status: true,
        targetPlanNameSnapshot: true,
        targetPlanCodeSnapshot: true,
        priceSnapshot: true,
        currencySnapshot: true,
        createdAt: true,
      },
    }),
  ]);
  const config = readPaystackConfig();
  return {
    workspace: planData.workspace,
    normalPlan: planData.currentPlan,
    activeTrial: planData.activeTrial,
    effectivePlan: planData.effectivePlan,
    subscriptionStatus: planData.subscriptionStatus,
    recurringBilling: planData.recurringBilling,
    canInitializeTest: planData.canManageSubscription,
    paymentMode: config.mode,
    payments: payments.map(({ amount, ...payment }) => ({
      ...payment,
      amount: amount.toFixed(2),
    })),
    billingPeriods: billingPeriods.map(({ amount, ...period }) => ({
      ...period,
      amount: amount.toFixed(2),
    })),
    subscriptionChanges: subscriptionChanges.map(({ priceSnapshot, ...change }) => ({
      ...change,
      priceSnapshot: priceSnapshot.toFixed(2),
    })),
  };
}

export async function getWorkspacePaymentReturnData(reference: unknown) {
  const context = await requirePageCapability(CAPABILITIES.VIEW_SUBSCRIPTION);
  if (typeof reference !== "string" || !referencePattern.test(reference)) {
    throw new PaymentValidationError();
  }
  const payment = await db.payment.findFirst({
    where: {
      workspaceId: context.workspace.id,
      OR: [{ internalReference: reference }, { providerReference: reference }],
    },
    select: {
      internalReference: true,
      purpose: true,
      amount: true,
      currency: true,
      status: true,
      createdAt: true,
      completedAt: true,
      documentCreditPurchase: {
        select: {
          status: true,
          creditAmountSnapshot: true,
          pack: { select: { name: true } },
        },
      },
      subscriptionChange: {
        select: {
          status: true,
          targetPlanCodeSnapshot: true,
          targetPlanNameSnapshot: true,
        },
      },
      subscriptionBillingPeriod: {
        select: { status: true, periodStart: true, periodEnd: true },
      },
    },
  });
  return payment
    ? { ...payment, amount: payment.amount.toFixed(2) }
    : null;
}

export async function getPlatformPaymentsPageData() {
  await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_PAYMENTS);
  const [payments, statusCounts, subscriptionStatusCounts, trialConversions] = await Promise.all([
    db.payment.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        internalReference: true,
        purpose: true,
        provider: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
        completedAt: true,
        documentCreditPurchase: {
          select: {
            status: true,
            creditAmountSnapshot: true,
            pack: { select: { code: true, name: true } },
          },
        },
        subscriptionChange: {
          select: {
            status: true,
            targetPlanCodeSnapshot: true,
            targetPlanNameSnapshot: true,
          },
        },
        subscriptionBillingPeriod: {
          select: { status: true, periodStart: true, periodEnd: true },
        },
        workspace: { select: { name: true } },
        initiatedBy: { select: { name: true, email: true } },
        _count: { select: { attempts: true } },
      },
    }),
    db.payment.groupBy({ by: ["status"], _count: { _all: true } }),
    db.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    db.workspaceTrial.count({ where: { status: "CONVERTED" } }),
  ]);
  return {
    mode: readPaystackConfig().mode,
    statusCounts: statusCounts.map(({ status, _count }) => ({
      status,
      count: _count._all,
    })),
    subscriptionStatusCounts: subscriptionStatusCounts.map(({ status, _count }) => ({
      status,
      count: _count._all,
    })),
    trialConversions,
    payments: payments.map(({ amount, _count, ...payment }) => ({
      ...payment,
      amount: amount.toFixed(2),
      attempts: _count.attempts,
    })),
  };
}
