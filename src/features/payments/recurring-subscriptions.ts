import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/features/audit/service";
import { addUtcMonth } from "@/features/commercial/periods";
import {
  commercialTransactionOptions,
  lockWorkspaceCommercialAccount,
} from "@/features/commercial/locking";
import { recordPlatformAuditEvent } from "@/features/platform-team/audit";
import { requireSubscriptionManagerInTransaction } from "@/features/subscriptions/authorization";
import { betaPlanCodeSchema } from "@/features/subscriptions/validation";
import { getWorkspaceMemberCapacityUsage } from "@/features/team/limits";
import { lockWorkspaceTrials } from "@/features/trials/locking";
import { db } from "@/lib/db";

import { minorUnitsToDecimalString, toMinorUnits } from "./currency";
import { SubscriptionPaymentError } from "./errors";
import type { ParsedProviderEvent, PaymentProviderClient } from "./provider";
import { getPaystackPaymentProvider } from "./paystack";
import { createInternalPaymentReference } from "./reference";
import {
  createPaymentFoundationInTransaction,
  initializePaymentFoundation,
  lockPayment,
} from "./service";

const providerPlanCodePattern = /^PLN_[A-Za-z0-9]+$/;
const transactionOptions = commercialTransactionOptions;

type CheckoutPreparation =
  | {
      kind: "INITIALIZE";
      foundation: Awaited<ReturnType<typeof createPaymentFoundationInTransaction>>;
      changeId: string;
      amount: string;
      currency: "GHS";
      planCode: string;
      providerPlanCode: string;
    }
  | {
      kind: "EXISTING_CHECKOUT";
      changeId: string;
      paymentId: string;
      reference: string;
      authorizationUrl: string;
    }
  | {
      kind: "ALREADY_SUCCEEDED";
      changeId: string;
      paymentId: string;
      reference: string;
    };

function safeDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeText(
  data: ParsedProviderEvent["safeData"],
  key: string,
) {
  const value = data[key];
  return typeof value === "string" && value ? value : null;
}

function safeNumber(
  data: ParsedProviderEvent["safeData"],
  key: string,
) {
  const value = data[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

async function updateCurrentAllowance(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  plan: { id: string; documentLimit: number | null },
  now: Date,
) {
  const current = await transaction.workspaceDocumentAllowancePeriod.findFirst({
    where: { workspaceId, periodStart: { lte: now }, periodEnd: { gt: now } },
    orderBy: { periodStart: "desc" },
    select: { id: true },
  });
  if (current) {
    await transaction.workspaceDocumentAllowancePeriod.update({
      where: { id: current.id },
      data: { planId: plan.id, allowance: plan.documentLimit },
    });
  }
}

async function prepareRecurringCheckout(input: {
  actorUserId: string;
  workspaceId: string;
  planCode: unknown;
}): Promise<CheckoutPreparation> {
  const planCode = betaPlanCodeSchema.safeParse(input.planCode);
  if (!planCode.success) throw new SubscriptionPaymentError("PLAN_UNAVAILABLE");

  return db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, input.workspaceId);
    await requireSubscriptionManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );
    const [subscription, targetPlan, memberUsage, allowance] = await Promise.all([
      transaction.subscription.findUnique({
        where: { workspaceId: input.workspaceId },
        include: { plan: true },
      }),
      transaction.plan.findUnique({ where: { code: planCode.data } }),
      getWorkspaceMemberCapacityUsage(transaction, input.workspaceId),
      transaction.workspaceDocumentAllowancePeriod.findFirst({
        where: {
          workspaceId: input.workspaceId,
          periodStart: { lte: new Date() },
          periodEnd: { gt: new Date() },
        },
        orderBy: { periodStart: "desc" },
      }),
    ]);
    if (
      !subscription ||
      !targetPlan?.isActive ||
      !targetPlan.isPublic ||
      !targetPlan.isAvailableForNewWorkspaces
    ) {
      throw new SubscriptionPaymentError("PLAN_UNAVAILABLE");
    }
    if (targetPlan.billingMode !== "RECURRING") {
      throw new SubscriptionPaymentError("PLAN_NOT_RECURRING");
    }
    if (
      targetPlan.currency !== "GHS" ||
      targetPlan.monthlyPrice.lte(0) ||
      !targetPlan.paystackPlanCode ||
      !providerPlanCodePattern.test(targetPlan.paystackPlanCode)
    ) {
      throw new SubscriptionPaymentError("PLAN_MAPPING_MISSING");
    }
    if (
      targetPlan.memberLimit !== null &&
      memberUsage.reservedMemberCapacity > targetPlan.memberLimit
    ) {
      throw new SubscriptionPaymentError("DOWNGRADE_BLOCKED");
    }
    if (
      targetPlan.documentLimit !== null &&
      (allowance?.used ?? 0) > targetPlan.documentLimit
    ) {
      throw new SubscriptionPaymentError("DOWNGRADE_BLOCKED");
    }
    if (
      subscription.status === "ACTIVE" &&
      subscription.providerSubscriptionCode
    ) {
      throw new SubscriptionPaymentError("ACTIVE_SUBSCRIPTION");
    }

    let change = await transaction.subscriptionChange.findFirst({
      where: { subscriptionId: subscription.id, status: "PENDING" },
      include: {
        payments: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          include: {
            attempts: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
            },
          },
        },
      },
    });
    if (change && change.targetPlanId !== targetPlan.id) {
      throw new SubscriptionPaymentError("CHANGE_IN_PROGRESS");
    }
    const existingPayment = change?.payments[0];
    const existingAttempt = existingPayment?.attempts[0];
    if (
      change &&
      existingPayment?.status === "PROCESSING" &&
      existingAttempt?.authorizationUrl
    ) {
      return {
        kind: "EXISTING_CHECKOUT" as const,
        changeId: change.id,
        paymentId: existingPayment.id,
        reference: existingPayment.internalReference,
        authorizationUrl: existingAttempt.authorizationUrl,
      };
    }
    if (change && existingPayment?.status === "SUCCEEDED") {
      return {
        kind: "ALREADY_SUCCEEDED" as const,
        changeId: change.id,
        paymentId: existingPayment.id,
        reference: existingPayment.internalReference,
      };
    }
    if (change && existingPayment?.status === "PENDING") {
      throw new SubscriptionPaymentError("CHANGE_IN_PROGRESS");
    }

    if (!change) {
      change = await transaction.subscriptionChange.create({
        data: {
          workspaceId: input.workspaceId,
          subscriptionId: subscription.id,
          targetPlanId: targetPlan.id,
          actorUserId: input.actorUserId,
          fromPlanCodeSnapshot: subscription.plan.code,
          targetPlanCodeSnapshot: targetPlan.code,
          targetPlanNameSnapshot: targetPlan.name,
          priceSnapshot: targetPlan.monthlyPrice,
          currencySnapshot: targetPlan.currency,
          providerPlanCodeSnapshot: targetPlan.paystackPlanCode,
        },
        include: {
          payments: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            include: {
              attempts: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
              },
            },
          },
        },
      });
    }
    if (!change) throw new SubscriptionPaymentError("CHANGE_IN_PROGRESS");

    const reference = createInternalPaymentReference();
    const foundation = await createPaymentFoundationInTransaction(transaction, {
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      purpose: "SUBSCRIPTION_INITIAL",
      amount: change.priceSnapshot.toFixed(2),
      currency: "GHS",
      reference,
      subscriptionChangeId: change.id,
      safeMetadata: {
        subscriptionChangeId: change.id,
        targetPlanCode: change.targetPlanCodeSnapshot,
        billingInterval: "MONTHLY",
        entitlementGrant: "VERIFIED_PAYMENT_ONLY",
        testMode: true,
      },
    });
    return {
      kind: "INITIALIZE" as const,
      foundation,
      changeId: change.id,
      amount: change.priceSnapshot.toFixed(2),
      currency: "GHS" as const,
      planCode: change.targetPlanCodeSnapshot,
      providerPlanCode: change.providerPlanCodeSnapshot,
    };
  }, transactionOptions);
}

export async function initializeRecurringSubscription(
  input: {
    actorUserId: string;
    workspaceId: string;
    email: string;
    planCode: unknown;
  },
  provider?: PaymentProviderClient,
) {
  const prepared = await prepareRecurringCheckout(input);
  if (prepared.kind === "EXISTING_CHECKOUT") {
    return { ...prepared, reused: true as const };
  }
  if (prepared.kind === "ALREADY_SUCCEEDED") {
    const fulfillment = await fulfillRecurringSubscriptionPayment(
      prepared.paymentId,
    );
    return { ...prepared, fulfillment, reused: true as const };
  }
  try {
    const initialized = await initializePaymentFoundation(
      prepared.foundation,
      {
        email: input.email,
        amount: prepared.amount,
        currency: prepared.currency,
        purpose: "SUBSCRIPTION_INITIAL",
        channels: ["card"],
        planCode: prepared.providerPlanCode,
        metadata: {
          civReference: prepared.foundation.reference,
          purpose: "SUBSCRIPTION_INITIAL",
          subscriptionChangeId: prepared.changeId,
          targetPlanCode: prepared.planCode,
        },
      },
      provider,
    );
    return {
      kind: "INITIALIZED" as const,
      ...initialized,
      changeId: prepared.changeId,
      reused: false as const,
    };
  } catch (error) {
    await markRecurringSubscriptionPaymentFailed(prepared.foundation.paymentId);
    throw error;
  }
}

function jsonText(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value[key];
  return typeof item === "string" && item ? item : null;
}

export async function fulfillRecurringSubscriptionPayment(paymentId: string) {
  return db.$transaction(async (transaction) => {
    await lockPayment(transaction, paymentId);
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      include: {
        subscriptionChange: { include: { targetPlan: true } },
        attempts: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (
      !payment ||
      payment.status !== "SUCCEEDED" ||
      payment.purpose !== "SUBSCRIPTION_INITIAL" ||
      !payment.subscriptionChange
    ) {
      throw new SubscriptionPaymentError("SUBSCRIPTION_UNAVAILABLE");
    }
    const change = payment.subscriptionChange;
    await lockWorkspaceCommercialAccount(transaction, change.workspaceId);
    await lockWorkspaceTrials(transaction, change.workspaceId);
    if (
      payment.workspaceId !== change.workspaceId ||
      !payment.amount.equals(change.priceSnapshot) ||
      payment.currency !== change.currencySnapshot ||
      change.targetPlan.billingMode !== "RECURRING" ||
      change.targetPlan.paystackPlanCode !== change.providerPlanCodeSnapshot
    ) {
      throw new SubscriptionPaymentError("FULFILLMENT_MISMATCH");
    }
    const subscription = await transaction.subscription.findUniqueOrThrow({
      where: { id: change.subscriptionId },
      include: { plan: true },
    });
    if (change.status === "COMPLETED") {
      return {
        kind: "SUBSCRIPTION" as const,
        subscriptionId: subscription.id,
        planCode: change.targetPlanCodeSnapshot,
        idempotent: true,
      };
    }
    if (change.status !== "PENDING") {
      throw new SubscriptionPaymentError("FULFILLMENT_MISMATCH");
    }

    const now = payment.completedAt ?? new Date();
    const periodStart = now;
    const periodEnd = addUtcMonth(periodStart);
    const fallbackPlan = subscription.plan.billingMode === "FREE"
      ? subscription.plan
      : await transaction.plan.findUnique({ where: { code: "FREE" } });
    if (!fallbackPlan) throw new SubscriptionPaymentError("PLAN_UNAVAILABLE");
    const customerCode = jsonText(
      payment.attempts[0]?.responseMetadata ?? null,
      "customerCode",
    ) ?? change.providerCustomerCode;

    const updated = await transaction.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: change.targetPlanId,
        fallbackPlanId: subscription.fallbackPlanId ?? fallbackPlan.id,
        pendingPlanId: null,
        status: "ACTIVE",
        provider: "PAYSTACK",
        providerCustomerCode: customerCode,
        providerSubscriptionCode: change.providerSubscriptionCode,
        currentPeriodStart: periodStart,
        currentPeriodEnd: change.providerNextPaymentAt ?? periodEnd,
        nextPaymentAt: change.providerNextPaymentAt ?? periodEnd,
        lastPaymentAt: now,
        cancelAtPeriodEnd: false,
        endsAt: null,
      },
      select: { id: true },
    });
    await transaction.subscriptionChange.update({
      where: { id: change.id },
      data: { status: "COMPLETED", completedAt: now },
    });
    const billingPeriod = await transaction.subscriptionBillingPeriod.create({
      data: {
        subscriptionId: updated.id,
        planId: change.targetPlanId,
        status: "PAID",
        providerTransactionReference:
          payment.providerReference ?? payment.internalReference,
        periodStart,
        periodEnd: change.providerNextPaymentAt ?? periodEnd,
        amount: change.priceSnapshot,
        currency: change.currencySnapshot,
        paidAt: now,
      },
      select: { id: true },
    });
    await transaction.payment.update({
      where: { id: payment.id },
      data: { subscriptionBillingPeriodId: billingPeriod.id },
    });

    const trial = await transaction.workspaceTrial.findFirst({
      where: { workspaceId: change.workspaceId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    if (trial) {
      await transaction.workspaceTrial.update({
        where: { id: trial.id },
        data: { status: "CONVERTED", convertedAt: now },
      });
      const trialMetadata = {
        trialPlan: trial.trialPlanCodeSnapshot,
        fallbackPlan: trial.fallbackPlanCodeSnapshot,
        endsAt: trial.endsAt.toISOString(),
        grantSource: trial.grantSource,
      } as const;
      await recordAuditEvent(transaction, {
        workspaceId: change.workspaceId,
        actorUserId: null,
        action: "TRIAL_CONVERTED",
        resourceType: "TRIAL",
        resourceId: trial.id,
        metadata: trialMetadata,
      });
      const workspace = await transaction.workspace.findUniqueOrThrow({
        where: { id: change.workspaceId },
        select: { name: true },
      });
      await recordPlatformAuditEvent(transaction, {
        actorUserId: change.actorUserId,
        action: "PLATFORM_TRIAL_CONVERTED",
        resourceType: "WORKSPACE_TRIAL",
        resourceId: trial.id,
        metadata: {
          workspaceName: workspace.name,
          trialPlan: trial.trialPlanCodeSnapshot,
        },
      });
    }

    const paidPeriodEnd = change.providerNextPaymentAt ?? periodEnd;
    const issuedInPaidPeriod = await transaction.document.count({
      where: {
        workspaceId: change.workspaceId,
        status: { in: ["ISSUED", "VOIDED"] },
        issuedAt: { gte: periodStart, lt: paidPeriodEnd },
      },
    });
    await transaction.workspaceDocumentAllowancePeriod.upsert({
      where: {
        workspaceId_periodStart: {
          workspaceId: change.workspaceId,
          periodStart,
        },
      },
      create: {
        workspaceId: change.workspaceId,
        planId: change.targetPlanId,
        periodStart,
        periodEnd: paidPeriodEnd,
        allowance: change.targetPlan.documentLimit,
        used: issuedInPaidPeriod,
      },
      update: {
        planId: change.targetPlanId,
        periodEnd: paidPeriodEnd,
        allowance: change.targetPlan.documentLimit,
      },
    });
    await recordAuditEvent(transaction, {
      workspaceId: change.workspaceId,
      actorUserId: null,
      action: "SUBSCRIPTION_STARTED",
      resourceType: "SUBSCRIPTION",
      resourceId: subscription.id,
      metadata: {
        fromPlan: change.fromPlanCodeSnapshot,
        toPlan: change.targetPlanCodeSnapshot,
        paymentReference: payment.internalReference,
      },
    });
    if (change.fromPlanCodeSnapshot !== change.targetPlanCodeSnapshot) {
      await recordAuditEvent(transaction, {
        workspaceId: change.workspaceId,
        actorUserId: change.actorUserId,
        action: "WORKSPACE_PLAN_CHANGED",
        resourceType: "SUBSCRIPTION",
        resourceId: subscription.id,
        metadata: {
          fromPlan: change.fromPlanCodeSnapshot,
          toPlan: change.targetPlanCodeSnapshot,
        },
      });
    }
    const workspace = await transaction.workspace.findUniqueOrThrow({
      where: { id: change.workspaceId },
      select: { name: true },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: change.actorUserId,
      action: "PLATFORM_SUBSCRIPTION_STARTED",
      resourceType: "SUBSCRIPTION",
      resourceId: subscription.id,
      metadata: {
        workspaceName: workspace.name,
        planCode: change.targetPlanCodeSnapshot,
      },
    });
    return {
      kind: "SUBSCRIPTION" as const,
      subscriptionId: subscription.id,
      planCode: change.targetPlanCodeSnapshot,
      idempotent: false,
    };
  }, transactionOptions);
}

export async function markRecurringSubscriptionPaymentFailed(paymentId: string) {
  return db.$transaction(async (transaction) => {
    await lockPayment(transaction, paymentId);
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      select: {
        purpose: true,
        subscriptionChangeId: true,
        workspaceId: true,
      },
    });
    if (!payment?.subscriptionChangeId || payment.purpose !== "SUBSCRIPTION_INITIAL") {
      return false;
    }
    await lockWorkspaceCommercialAccount(transaction, payment.workspaceId);
    const otherActive = await transaction.payment.count({
      where: {
        subscriptionChangeId: payment.subscriptionChangeId,
        id: { not: paymentId },
        status: { in: ["PENDING", "PROCESSING", "SUCCEEDED"] },
      },
    });
    if (otherActive > 0) return false;
    const updated = await transaction.subscriptionChange.updateMany({
      where: { id: payment.subscriptionChangeId, status: "PENDING" },
      data: { status: "FAILED", failedAt: new Date() },
    });
    return updated.count === 1;
  }, transactionOptions);
}

export async function applySubscriptionFallbackInTransaction(
  transaction: Prisma.TransactionClient,
  subscriptionId: string,
  now = new Date(),
) {
  const subscription = await transaction.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, fallbackPlan: true, workspace: true },
  });
  if (!subscription?.fallbackPlan) return null;
  if (
    subscription.planId === subscription.fallbackPlanId &&
    subscription.status === "CANCELLED"
  ) {
    return subscription;
  }
  const previousPlan = subscription.plan.code;
  const updated = await transaction.subscription.update({
    where: { id: subscription.id },
    data: {
      planId: subscription.fallbackPlan.id,
      pendingPlanId: null,
      status: "CANCELLED",
      cancelAtPeriodEnd: true,
      endsAt: now,
      nextPaymentAt: null,
    },
    include: { plan: true, fallbackPlan: true, workspace: true },
  });
  await updateCurrentAllowance(
    transaction,
    subscription.workspaceId,
    subscription.fallbackPlan,
    now,
  );
  await recordAuditEvent(transaction, {
    workspaceId: subscription.workspaceId,
    actorUserId: null,
    action: "SUBSCRIPTION_CANCELLED",
    resourceType: "SUBSCRIPTION",
    resourceId: subscription.id,
    metadata: {
      fromPlan: previousPlan,
      toPlan: subscription.fallbackPlan.code,
    },
  });
  if (previousPlan !== subscription.fallbackPlan.code) {
    await recordAuditEvent(transaction, {
      workspaceId: subscription.workspaceId,
      actorUserId: null,
      action: "WORKSPACE_PLAN_CHANGED",
      resourceType: "SUBSCRIPTION",
      resourceId: subscription.id,
      metadata: {
        fromPlan: previousPlan,
        toPlan: subscription.fallbackPlan.code,
      },
    });
  }
  await recordPlatformAuditEvent(transaction, {
    actorUserId: null,
    action: "PLATFORM_SUBSCRIPTION_CANCELLED",
    resourceType: "SUBSCRIPTION",
    resourceId: subscription.id,
    metadata: {
      workspaceName: subscription.workspace.name,
      planCode: previousPlan,
    },
  });
  return updated;
}

async function processSubscriptionCreated(event: ParsedProviderEvent) {
  const subscriptionCode = safeText(event.safeData, "subscriptionCode");
  const providerPlanCode = safeText(event.safeData, "planCode");
  const customerCode = safeText(event.safeData, "customerCode");
  if (!subscriptionCode || !providerPlanCode || !customerCode) {
    throw new SubscriptionPaymentError("FULFILLMENT_MISMATCH");
  }
  return db.$transaction(async (transaction) => {
    const existing = await transaction.subscription.findUnique({
      where: { providerSubscriptionCode: subscriptionCode },
      select: { id: true },
    });
    if (existing) return { handled: true, idempotent: true };
    const candidates = await transaction.subscription.findMany({
      where: {
        provider: "PAYSTACK",
        providerCustomerCode: customerCode,
        providerSubscriptionCode: null,
        status: "ACTIVE",
        plan: { paystackPlanCode: providerPlanCode },
      },
      select: { id: true, workspaceId: true, currentPeriodStart: true },
      take: 2,
    });
    const nextPaymentAt = safeDate(event.safeData.nextPaymentDate);
    if (candidates.length === 1) {
      await lockWorkspaceCommercialAccount(transaction, candidates[0].workspaceId);
      await transaction.subscription.update({
        where: { id: candidates[0].id },
        data: {
          providerSubscriptionCode: subscriptionCode,
          nextPaymentAt,
          ...(nextPaymentAt ? { currentPeriodEnd: nextPaymentAt } : {}),
        },
      });
      if (nextPaymentAt && candidates[0].currentPeriodStart) {
        await transaction.subscriptionBillingPeriod.updateMany({
          where: {
            subscriptionId: candidates[0].id,
            periodStart: candidates[0].currentPeriodStart,
            status: "PAID",
          },
          data: { periodEnd: nextPaymentAt },
        });
      }
      return { handled: true, idempotent: false };
    }
    const customerEmail = safeText(event.safeData, "customerEmail");
    if (!customerEmail) return { handled: false, idempotent: false };
    const pending = await transaction.subscriptionChange.findMany({
      where: {
        status: "PENDING",
        providerPlanCodeSnapshot: providerPlanCode,
        actor: { email: { equals: customerEmail, mode: "insensitive" } },
      },
      select: { id: true, workspaceId: true },
      take: 2,
    });
    if (pending.length !== 1) return { handled: false, idempotent: false };
    await lockWorkspaceCommercialAccount(transaction, pending[0].workspaceId);
    await transaction.subscriptionChange.update({
      where: { id: pending[0].id },
      data: {
        providerCustomerCode: customerCode,
        providerSubscriptionCode: subscriptionCode,
        providerNextPaymentAt: nextPaymentAt,
      },
    });
    return { handled: true, idempotent: false };
  }, transactionOptions);
}

async function processInvoiceEvent(event: ParsedProviderEvent) {
  const subscriptionCode = safeText(event.safeData, "subscriptionCode");
  const invoiceCode = safeText(event.safeData, "invoiceCode");
  const amountMinor = safeNumber(event.safeData, "amountMinor");
  const currency = safeText(event.safeData, "currency");
  const periodStart = safeDate(event.safeData.periodStart);
  const periodEnd = safeDate(event.safeData.periodEnd);
  if (
    !subscriptionCode ||
    !invoiceCode ||
    amountMinor === null ||
    currency !== "GHS" ||
    !periodStart ||
    !periodEnd ||
    periodEnd <= periodStart
  ) {
    throw new SubscriptionPaymentError("FULFILLMENT_MISMATCH");
  }
  return db.$transaction(async (transaction) => {
    const candidate = await transaction.subscription.findUnique({
      where: { providerSubscriptionCode: subscriptionCode },
      select: { id: true, workspaceId: true },
    });
    if (!candidate) return { handled: false, idempotent: false };
    await lockWorkspaceCommercialAccount(transaction, candidate.workspaceId);
    const subscription = await transaction.subscription.findUniqueOrThrow({
      where: { id: candidate.id },
      include: { plan: true, workspace: true },
    });
    if (
      subscription.plan.billingMode !== "RECURRING" ||
      toMinorUnits(subscription.plan.monthlyPrice, "GHS") !== amountMinor
    ) {
      throw new SubscriptionPaymentError("FULFILLMENT_MISMATCH");
    }
    const existing = await transaction.subscriptionBillingPeriod.findUnique({
      where: { providerInvoiceCode: invoiceCode },
    });
    const failed = event.eventType === "invoice.payment_failed";
    const paid = event.eventType === "invoice.update" && event.safeData.paid === true;
    if (event.eventType === "invoice.create" || (!failed && !paid)) {
      if (!existing) {
        await transaction.subscriptionBillingPeriod.create({
          data: {
            subscriptionId: subscription.id,
            planId: subscription.planId,
            providerInvoiceCode: invoiceCode,
            periodStart,
            periodEnd,
            amount: subscription.plan.monthlyPrice,
            currency,
          },
        });
      }
      return { handled: true, idempotent: Boolean(existing) };
    }
    if (failed) {
      if (existing?.status === "PAID" || existing?.status === "FAILED") {
        return { handled: true, idempotent: true };
      }
      await transaction.subscriptionBillingPeriod.upsert({
        where: { providerInvoiceCode: invoiceCode },
        create: {
          subscriptionId: subscription.id,
          planId: subscription.planId,
          status: "FAILED",
          providerInvoiceCode: invoiceCode,
          periodStart,
          periodEnd,
          amount: subscription.plan.monthlyPrice,
          currency,
          failedAt: new Date(),
        },
        update: { status: "FAILED", failedAt: new Date() },
      });
      await transaction.subscription.update({
        where: { id: subscription.id },
        data: { status: "PAST_DUE", nextPaymentAt: safeDate(event.safeData.nextPaymentDate) },
      });
      await recordAuditEvent(transaction, {
        workspaceId: subscription.workspaceId,
        actorUserId: null,
        action: "SUBSCRIPTION_PAYMENT_FAILED",
        resourceType: "SUBSCRIPTION",
        resourceId: subscription.id,
        metadata: {
          planCode: subscription.plan.code,
          periodEnd: periodEnd.toISOString(),
          invoiceCode,
        },
      });
      await recordPlatformAuditEvent(transaction, {
        actorUserId: null,
        action: "PLATFORM_SUBSCRIPTION_PAYMENT_FAILED",
        resourceType: "SUBSCRIPTION",
        resourceId: subscription.id,
        metadata: {
          workspaceName: subscription.workspace.name,
          planCode: subscription.plan.code,
        },
      });
      if (
        subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd <= new Date()
      ) {
        await applySubscriptionFallbackInTransaction(
          transaction,
          subscription.id,
        );
      }
      return { handled: true, idempotent: false };
    }

    const transactionReference = safeText(
      event.safeData,
      "transactionReference",
    );
    if (!transactionReference) {
      throw new SubscriptionPaymentError("FULFILLMENT_MISMATCH");
    }
    if (existing?.status === "PAID") {
      return { handled: true, idempotent: true };
    }
    const paidAt = safeDate(event.safeData.paidAt) ?? new Date();
    const period = await transaction.subscriptionBillingPeriod.upsert({
      where: { providerInvoiceCode: invoiceCode },
      create: {
        subscriptionId: subscription.id,
        planId: subscription.planId,
        status: "PAID",
        providerInvoiceCode: invoiceCode,
        providerTransactionReference: transactionReference,
        periodStart,
        periodEnd,
        amount: subscription.plan.monthlyPrice,
        currency,
        paidAt,
      },
      update: {
        status: "PAID",
        providerTransactionReference: transactionReference,
        paidAt,
        failedAt: null,
      },
    });
    const reference = createInternalPaymentReference();
    const payment = await transaction.payment.create({
      data: {
        workspaceId: subscription.workspaceId,
        initiatedByUserId: null,
        purpose: "SUBSCRIPTION_RENEWAL",
        provider: "PAYSTACK",
        internalReference: reference,
        providerReference: transactionReference,
        amount: minorUnitsToDecimalString(amountMinor, "GHS"),
        currency,
        status: "SUCCEEDED",
        completedAt: paidAt,
        subscriptionBillingPeriodId: period.id,
        metadata: {
          providerInvoiceCode: invoiceCode,
          planCode: subscription.plan.code,
          testMode: true,
        },
        attempts: {
          create: {
            provider: "PAYSTACK",
            providerReference: transactionReference,
            status: "SUCCEEDED",
            verifiedAt: paidAt,
            completedAt: paidAt,
            requestMetadata: { purpose: "SUBSCRIPTION_RENEWAL" },
            responseMetadata: {
              invoiceCode,
              outcome: "SIGNED_INVOICE_UPDATE",
            },
          },
        },
      },
    });
    await transaction.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextPaymentAt: safeDate(event.safeData.nextPaymentDate) ?? periodEnd,
        lastPaymentAt: paidAt,
      },
    });
    const used = await transaction.document.count({
      where: {
        workspaceId: subscription.workspaceId,
        status: { in: ["ISSUED", "VOIDED"] },
        issuedAt: { gte: periodStart, lt: periodEnd },
      },
    });
    await transaction.workspaceDocumentAllowancePeriod.upsert({
      where: {
        workspaceId_periodStart: {
          workspaceId: subscription.workspaceId,
          periodStart,
        },
      },
      create: {
        workspaceId: subscription.workspaceId,
        planId: subscription.planId,
        periodStart,
        periodEnd,
        allowance: subscription.plan.documentLimit,
        used,
      },
      update: {
        planId: subscription.planId,
        periodEnd,
        allowance: subscription.plan.documentLimit,
      },
    });
    await recordAuditEvent(transaction, {
      workspaceId: subscription.workspaceId,
      actorUserId: null,
      action: "SUBSCRIPTION_RENEWED",
      resourceType: "SUBSCRIPTION",
      resourceId: subscription.id,
      metadata: {
        planCode: subscription.plan.code,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        paymentReference: payment.internalReference,
      },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: null,
      action: "PLATFORM_SUBSCRIPTION_RENEWED",
      resourceType: "SUBSCRIPTION",
      resourceId: subscription.id,
      metadata: {
        workspaceName: subscription.workspace.name,
        planCode: subscription.plan.code,
      },
    });
    return { handled: true, idempotent: false };
  }, transactionOptions);
}

export async function processRecurringSubscriptionEvent(
  event: ParsedProviderEvent,
) {
  if (event.eventType === "subscription.create") {
    return processSubscriptionCreated(event);
  }
  if (
    event.eventType === "invoice.create" ||
    event.eventType === "invoice.update" ||
    event.eventType === "invoice.payment_failed"
  ) {
    return processInvoiceEvent(event);
  }
  const subscriptionCode = safeText(event.safeData, "subscriptionCode");
  if (
    !subscriptionCode ||
    !["subscription.not_renew", "subscription.disable"].includes(
      event.eventType,
    )
  ) {
    return { handled: false, idempotent: false };
  }
  return db.$transaction(async (transaction) => {
    const candidate = await transaction.subscription.findUnique({
      where: { providerSubscriptionCode: subscriptionCode },
      select: { id: true, workspaceId: true, cancelAtPeriodEnd: true, status: true },
    });
    if (!candidate) return { handled: false, idempotent: false };
    await lockWorkspaceCommercialAccount(transaction, candidate.workspaceId);
    if (event.eventType === "subscription.not_renew") {
      if (candidate.cancelAtPeriodEnd) {
        return { handled: true, idempotent: true };
      }
      await transaction.subscription.update({
        where: { id: candidate.id },
        data: { cancelAtPeriodEnd: true },
      });
      return { handled: true, idempotent: false };
    }
    if (candidate.status === "CANCELLED") {
      return { handled: true, idempotent: true };
    }
    const current = await transaction.subscription.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { currentPeriodEnd: true, cancelAtPeriodEnd: true },
    });
    if (current.currentPeriodEnd && current.currentPeriodEnd > new Date()) {
      if (!current.cancelAtPeriodEnd) {
        await transaction.subscription.update({
          where: { id: candidate.id },
          data: { cancelAtPeriodEnd: true },
        });
      }
      return { handled: true, idempotent: current.cancelAtPeriodEnd };
    }
    await applySubscriptionFallbackInTransaction(
      transaction,
      candidate.id,
    );
    return { handled: true, idempotent: false };
  }, transactionOptions);
}

export async function cancelRecurringSubscription(
  input: { actorUserId: string; workspaceId: string },
  provider: PaymentProviderClient = getPaystackPaymentProvider(),
) {
  const prepared = await db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, input.workspaceId);
    await requireSubscriptionManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );
    const subscription = await transaction.subscription.findUnique({
      where: { workspaceId: input.workspaceId },
      include: { plan: true, fallbackPlan: true },
    });
    if (
      !subscription ||
      subscription.status !== "ACTIVE" ||
      !subscription.providerSubscriptionCode ||
      !subscription.currentPeriodEnd ||
      !subscription.fallbackPlan
    ) {
      throw new SubscriptionPaymentError("CANCELLATION_UNAVAILABLE");
    }
    if (subscription.cancelAtPeriodEnd) {
      return { subscription, idempotent: true as const };
    }
    return { subscription, idempotent: false as const };
  }, transactionOptions);
  if (prepared.idempotent) {
    return {
      idempotent: true,
      effectiveAt: prepared.subscription.currentPeriodEnd!,
    };
  }
  if (!provider.disableSubscription) {
    throw new SubscriptionPaymentError("CANCELLATION_UNAVAILABLE");
  }
  await provider.disableSubscription({
    subscriptionCode: prepared.subscription.providerSubscriptionCode!,
  });
  return db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, input.workspaceId);
    await requireSubscriptionManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );
    const current = await transaction.subscription.findUniqueOrThrow({
      where: { id: prepared.subscription.id },
      include: { plan: true, fallbackPlan: true },
    });
    if (current.cancelAtPeriodEnd) {
      return { idempotent: true, effectiveAt: current.currentPeriodEnd! };
    }
    if (
      current.providerSubscriptionCode !==
      prepared.subscription.providerSubscriptionCode
    ) {
      throw new SubscriptionPaymentError("CANCELLATION_UNAVAILABLE");
    }
    await transaction.subscription.update({
      where: { id: current.id },
      data: {
        cancelAtPeriodEnd: true,
        pendingPlanId: current.fallbackPlanId,
      },
    });
    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "SUBSCRIPTION_CANCELLATION_SCHEDULED",
      resourceType: "SUBSCRIPTION",
      resourceId: current.id,
      metadata: {
        planCode: current.plan.code,
        effectiveAt: current.currentPeriodEnd!.toISOString(),
        nextPlan: current.fallbackPlan!.code,
      },
    });
    return { idempotent: false, effectiveAt: current.currentPeriodEnd! };
  }, transactionOptions);
}
