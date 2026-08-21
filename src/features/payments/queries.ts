import "server-only";

import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { hasPlatformCapability } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { getPlanSettingsPageData } from "@/features/subscriptions/queries";
import { db } from "@/lib/db";

import { readPaystackConfig } from "./config";
import { PaymentValidationError } from "./errors";
import { minorUnitsToDecimalString, toMinorUnits } from "./currency";

function paymentRefundSummary(payment: {
  amount: { toString(): string };
  currency: string;
  refunds: Array<{
    amount: { toString(): string; toFixed(digits: number): string };
    active: boolean;
    status: string;
  }>;
}) {
  if (payment.currency !== "GHS") {
    return { refundedAmount: "0.00", remainingRefundableAmount: "0.00" };
  }
  const succeededMinor = payment.refunds
    .filter((refund) => refund.status === "SUCCEEDED")
    .reduce((sum, refund) => sum + toMinorUnits(refund.amount, "GHS"), 0);
  const reservedMinor = payment.refunds
    .filter((refund) => refund.active)
    .reduce((sum, refund) => sum + toMinorUnits(refund.amount, "GHS"), 0);
  const paymentMinor = toMinorUnits(payment.amount, "GHS");
  return {
    refundedAmount: minorUnitsToDecimalString(succeededMinor, "GHS"),
    remainingRefundableAmount: minorUnitsToDecimalString(
      Math.max(0, paymentMinor - succeededMinor - reservedMinor),
      "GHS",
    ),
  };
}

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
      refunds: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          internalReference: true,
          status: true,
          active: true,
          amount: true,
          currency: true,
          createdAt: true,
          completedAt: true,
        },
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
    canManageSubscription: planData.canManageSubscription,
    paymentMode: config.mode,
    payments: payments.map(({ amount, refunds, ...payment }) => ({
      ...payment,
      amount: amount.toFixed(2),
      ...paymentRefundSummary({ amount, currency: payment.currency, refunds }),
      refunds: refunds.map(({ amount: refundAmount, ...refund }) => ({
        ...refund,
        amount: refundAmount.toFixed(2),
      })),
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
  const context = await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_PAYMENTS);
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
        reconciliationStatus: true,
        reconciliationNote: true,
        reconciledAt: true,
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
        attempts: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { status: true },
        },
        _count: { select: { attempts: true } },
        refunds: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            internalReference: true,
            providerRefundReference: true,
            status: true,
            active: true,
            amount: true,
            currency: true,
            creditAmount: true,
            reason: true,
            safeFailureCode: true,
            createdAt: true,
            completedAt: true,
          },
        },
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
    canRefund: hasPlatformCapability(
      context.membership,
      PLATFORM_CAPABILITIES.MANAGE_PAYMENT_REFUNDS,
    ),
    canReconcile: hasPlatformCapability(
      context.membership,
      PLATFORM_CAPABILITIES.RECONCILE_PAYMENTS,
    ),
    payments: payments.map(({ amount, refunds, attempts, _count, ...payment }) => ({
      ...payment,
      amount: amount.toFixed(2),
      ...paymentRefundSummary({ amount, currency: payment.currency, refunds }),
      refunds: refunds.map(({ amount: refundAmount, ...refund }) => ({
        ...refund,
        amount: refundAmount.toFixed(2),
      })),
      attempts: _count.attempts,
      latestProviderState: attempts[0]?.status ?? null,
    })),
  };
}
