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
  const payments = await db.payment.findMany({
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
    },
  });
  const config = readPaystackConfig();
  return {
    workspace: planData.workspace,
    normalPlan: planData.currentPlan,
    activeTrial: planData.activeTrial,
    canInitializeTest: planData.canManageSubscription,
    paymentMode: config.mode,
    payments: payments.map(({ amount, ...payment }) => ({
      ...payment,
      amount: amount.toFixed(2),
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
    },
  });
  return payment
    ? { ...payment, amount: payment.amount.toFixed(2) }
    : null;
}

export async function getPlatformPaymentsPageData() {
  await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_PAYMENTS);
  const [payments, statusCounts] = await Promise.all([
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
        workspace: { select: { name: true } },
        initiatedBy: { select: { name: true, email: true } },
        _count: { select: { attempts: true } },
      },
    }),
    db.payment.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    mode: readPaystackConfig().mode,
    statusCounts: statusCounts.map(({ status, _count }) => ({
      status,
      count: _count._all,
    })),
    payments: payments.map(({ amount, _count, ...payment }) => ({
      ...payment,
      amount: amount.toFixed(2),
      attempts: _count.attempts,
    })),
  };
}
