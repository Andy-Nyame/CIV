import "server-only";

import { z } from "zod";

import { recordAuditEvent } from "@/features/audit/service";
import {
  getPurchasedCreditLedgerBalance,
} from "@/features/commercial/ledger";
import {
  commercialTransactionOptions,
  lockWorkspaceCommercialAccount,
} from "@/features/commercial/locking";
import {
  PLATFORM_CAPABILITIES,
  hasPlatformCapability,
  type PlatformCapability,
} from "@/features/platform-admin/capabilities";
import { recordPlatformAuditEvent } from "@/features/platform-team/audit";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { minorUnitsToDecimalString, toMinorUnits } from "./currency";
import {
  PaymentAuthorizationError,
  PaymentProviderError,
  PaymentRefundError,
  PaymentVerificationError,
} from "./errors";
import { getPaystackPaymentProvider } from "./paystack";
import type {
  ParsedProviderEvent,
  PaymentProviderClient,
  ProviderRefund,
  ProviderRefundStatus,
} from "./provider";
import { createInternalRefundReference } from "./reference";
import { lockPayment, verifyPaymentByReference } from "./service";

const requestSchema = z.object({
  actorUserId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/).optional(),
  reason: z.string().trim().min(10).max(500),
});

const reconcileSchema = z.object({
  actorUserId: z.string().uuid(),
  paymentId: z.string().uuid(),
  refundId: z.string().uuid().optional(),
});

const supportedPurposes = [
  "DOCUMENT_CREDITS",
  "SUBSCRIPTION_INITIAL",
  "SUBSCRIPTION_RENEWAL",
  "MANUAL_PLAN_RENEWAL",
] as const;

type RefundablePaymentPurpose = (typeof supportedPurposes)[number];

function isRefundablePaymentPurpose(
  value: string,
): value is RefundablePaymentPurpose {
  return supportedPurposes.some((purpose) => purpose === value);
}

type VerifiedRefundState = {
  providerRefundId?: string | null;
  providerRefundReference?: string | null;
  transactionReference?: string | null;
  transactionIdentifier: string;
  domain?: string | null;
  status: ProviderRefundStatus;
  amountMinor: number;
  currency: string;
  expectedAt?: string | null;
  refundedAt?: string | null;
};

async function requirePlatformPaymentCapability(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  capability: PlatformCapability,
) {
  const membership = await transaction.platformMembership.findUnique({
    where: { userId: actorUserId },
    select: { role: true, status: true },
  });
  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    !hasPlatformCapability(membership, capability)
  ) {
    throw new PaymentAuthorizationError();
  }
}

function safeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function providerState(refund: ProviderRefund): VerifiedRefundState {
  return refund;
}

async function markRefundRequestUnconfirmed(refundId: string) {
  await db.$transaction(async (transaction) => {
    const refund = await transaction.paymentRefund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        active: true,
        internalReference: true,
        payment: { select: { id: true, internalReference: true } },
      },
    });
    if (!refund?.active) return;
    await lockPayment(transaction, refund.payment.id);
    await transaction.paymentRefund.update({
      where: { id: refund.id },
      data: {
        status: "NEEDS_ATTENTION",
        safeFailureCode: "PROVIDER_REQUEST_UNCONFIRMED",
      },
    });
    await transaction.payment.update({
      where: { id: refund.payment.id },
      data: {
        reconciliationStatus: "REQUIRED",
        reconciliationNote: "REFUND_PROVIDER_REQUEST_UNCONFIRMED",
      },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: null,
      action: "PLATFORM_PAYMENT_RECONCILIATION_REQUIRED",
      resourceType: "PAYMENT",
      resourceId: refund.payment.id,
      metadata: {
        paymentReference: refund.payment.internalReference,
        reasonCode: "REFUND_PROVIDER_REQUEST_UNCONFIRMED",
      },
    });
  }, commercialTransactionOptions);
}

export async function requestPaymentRefund(
  input: unknown,
  provider: PaymentProviderClient = getPaystackPaymentProvider(),
) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new PaymentRefundError("AMOUNT_INVALID");

  const prepared = await db.$transaction(async (transaction) => {
    await requirePlatformPaymentCapability(
      transaction,
      parsed.data.actorUserId,
      PLATFORM_CAPABILITIES.MANAGE_PAYMENT_REFUNDS,
    );
    await lockPayment(transaction, parsed.data.paymentId);
    const payment = await transaction.payment.findUnique({
      where: { id: parsed.data.paymentId },
      include: {
        refunds: { where: { active: true }, take: 1 },
        documentCreditPurchase: {
          include: { ledgerEntry: { select: { createdAt: true } } },
        },
      },
    });
    if (!payment) throw new PaymentRefundError("PAYMENT_UNAVAILABLE");
    if (payment.refunds[0]) {
      return {
        existing: true as const,
        refundId: payment.refunds[0].id,
        internalReference: payment.refunds[0].internalReference,
      };
    }
    if (!["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
      throw new PaymentRefundError("PAYMENT_NOT_SUCCEEDED");
    }
    if (!isRefundablePaymentPurpose(payment.purpose)) {
      throw new PaymentRefundError("PURPOSE_UNSUPPORTED");
    }
    if (payment.currency !== "GHS" || !payment.providerReference) {
      throw new PaymentRefundError("PAYMENT_UNAVAILABLE");
    }

    const succeeded = await transaction.paymentRefund.aggregate({
      where: { paymentId: payment.id, status: "SUCCEEDED" },
      _sum: { amount: true },
    });
    const paymentMinor = toMinorUnits(payment.amount, "GHS");
    const refundedMinor = succeeded._sum.amount
      ? toMinorUnits(succeeded._sum.amount, "GHS")
      : 0;
    const remainingMinor = paymentMinor - refundedMinor;
    if (remainingMinor <= 0) {
      throw new PaymentRefundError("AMOUNT_EXCEEDS_REMAINING");
    }
    const amountMinor = parsed.data.amount
      ? toMinorUnits(parsed.data.amount, "GHS")
      : remainingMinor;
    if (amountMinor <= 0) throw new PaymentRefundError("AMOUNT_INVALID");
    if (amountMinor > remainingMinor) {
      throw new PaymentRefundError("AMOUNT_EXCEEDS_REMAINING");
    }

    let creditAmount: number | null = null;
    if (payment.purpose === "DOCUMENT_CREDITS") {
      if (amountMinor !== remainingMinor || remainingMinor !== paymentMinor) {
        throw new PaymentRefundError("CREDIT_PARTIAL_UNSUPPORTED");
      }
      const purchase = payment.documentCreditPurchase;
      if (
        !purchase ||
        purchase.betaAcquisition ||
        purchase.status !== "COMPLETED" ||
        !purchase.ledgerEntry
      ) {
        throw new PaymentRefundError("REFUND_UNAVAILABLE");
      }
      await lockWorkspaceCommercialAccount(transaction, payment.workspaceId);
      const usageAfterPurchase = await transaction.documentCreditTransaction.count({
        where: {
          workspaceId: payment.workspaceId,
          type: "USAGE",
          createdAt: { gte: purchase.ledgerEntry.createdAt },
        },
      });
      const ledgerBalance = await getPurchasedCreditLedgerBalance(
        transaction,
        payment.workspaceId,
      );
      if (
        usageAfterPurchase > 0 ||
        ledgerBalance < purchase.creditAmountSnapshot
      ) {
        throw new PaymentRefundError("CREDITS_ALREADY_USED");
      }
      creditAmount = purchase.creditAmountSnapshot;
    }

    const amount = minorUnitsToDecimalString(amountMinor, "GHS");
    const internalReference = createInternalRefundReference();
    const refund = await transaction.paymentRefund.create({
      data: {
        paymentId: payment.id,
        workspaceId: payment.workspaceId,
        initiatedByUserId: parsed.data.actorUserId,
        provider: payment.provider,
        internalReference,
        amount,
        currency: payment.currency,
        creditAmount,
        reason: parsed.data.reason,
      },
      select: { id: true },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: parsed.data.actorUserId,
      action: "PLATFORM_PAYMENT_REFUND_INITIATED",
      resourceType: "PAYMENT_REFUND",
      resourceId: refund.id,
      metadata: {
        paymentReference: payment.internalReference,
        refundReference: internalReference,
        amount,
        currency: payment.currency,
        purpose: payment.purpose,
      },
    });
    return {
      existing: false as const,
      refundId: refund.id,
      internalReference,
      transactionReference: payment.providerReference,
      amountMinor,
      currency: payment.currency as "GHS",
      reason: parsed.data.reason,
    };
  }, commercialTransactionOptions);

  if (prepared.existing) return prepared;
  if (!provider.createRefund) {
    await markRefundRequestUnconfirmed(prepared.refundId);
    throw new PaymentProviderError();
  }
  let created: ProviderRefund;
  try {
    created = await provider.createRefund({
      transactionReference: prepared.transactionReference,
      amountMinor: prepared.amountMinor,
      currency: prepared.currency,
      customerNote: "Refund processed by CIV support.",
      merchantNote: prepared.internalReference,
    });
  } catch (error) {
    await markRefundRequestUnconfirmed(prepared.refundId);
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError();
  }

  const result = await applyVerifiedRefundState(
    prepared.refundId,
    providerState(created),
  );
  return {
    existing: false as const,
    refundId: prepared.refundId,
    internalReference: prepared.internalReference,
    status: result.status,
  };
}

export async function applyVerifiedRefundState(
  refundId: string,
  verified: VerifiedRefundState,
) {
  return db.$transaction(async (transaction) => {
    const initial = await transaction.paymentRefund.findUnique({
      where: { id: refundId },
      select: { paymentId: true },
    });
    if (!initial) throw new PaymentRefundError("REFUND_UNAVAILABLE");
    await lockPayment(transaction, initial.paymentId);
    const refund = await transaction.paymentRefund.findUniqueOrThrow({
      where: { id: refundId },
      include: {
        payment: {
          include: {
            documentCreditPurchase: true,
            attempts: {
              orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
              take: 1,
              select: { responseMetadata: true },
            },
          },
        },
        creditLedgerEntry: { select: { id: true } },
      },
    });
    if (!isRefundablePaymentPurpose(refund.payment.purpose)) {
      throw new PaymentRefundError("PURPOSE_UNSUPPORTED");
    }
    const amountMinor = toMinorUnits(refund.amount, "GHS");
    const paymentReference = refund.payment.providerReference ?? refund.payment.internalReference;
    const attemptMetadata = refund.payment.attempts[0]?.responseMetadata;
    const providerTransactionId =
      attemptMetadata && typeof attemptMetadata === "object" && !Array.isArray(attemptMetadata)
        ? attemptMetadata.transactionId
        : null;
    const transactionMatches = verified.transactionReference
      ? verified.transactionReference === paymentReference
      : typeof providerTransactionId === "string" &&
        providerTransactionId === verified.transactionIdentifier;
    if (
      !transactionMatches ||
      (verified.domain !== undefined && verified.domain !== null && verified.domain !== "test") ||
      verified.amountMinor !== amountMinor ||
      verified.currency !== refund.currency ||
      (refund.providerRefundId && verified.providerRefundId && refund.providerRefundId !== verified.providerRefundId) ||
      (refund.providerRefundReference && verified.providerRefundReference && refund.providerRefundReference !== verified.providerRefundReference)
    ) {
      throw new PaymentVerificationError();
    }
    if (refund.status === "SUCCEEDED") {
      if (verified.status === "processed") {
        return { status: refund.status, idempotent: true };
      }
      throw new PaymentVerificationError();
    }
    if (refund.status === "FAILED") {
      if (verified.status === "failed") {
        return { status: refund.status, idempotent: true };
      }
      throw new PaymentVerificationError();
    }
    if (refund.payment.purpose === "DOCUMENT_CREDITS") {
      await lockWorkspaceCommercialAccount(transaction, refund.workspaceId);
    }

    const identity = {
      ...(verified.providerRefundId
        ? { providerRefundId: verified.providerRefundId }
        : {}),
      ...(verified.providerRefundReference
        ? { providerRefundReference: verified.providerRefundReference }
        : {}),
      expectedAt: safeDate(verified.expectedAt),
      refundedAt: safeDate(verified.refundedAt),
    };

    if (["pending", "processing"].includes(verified.status)) {
      await transaction.paymentRefund.update({
        where: { id: refund.id },
        data: { ...identity, status: "PROCESSING", safeFailureCode: null },
      });
      return { status: "PROCESSING" as const, idempotent: false };
    }
    if (verified.status === "needs-attention") {
      await transaction.paymentRefund.update({
        where: { id: refund.id },
        data: {
          ...identity,
          status: "NEEDS_ATTENTION",
          safeFailureCode: "PROVIDER_NEEDS_ATTENTION",
        },
      });
      await transaction.payment.update({
        where: { id: refund.paymentId },
        data: {
          reconciliationStatus: "REQUIRED",
          reconciliationNote: "REFUND_PROVIDER_NEEDS_ATTENTION",
        },
      });
      return { status: "NEEDS_ATTENTION" as const, idempotent: false };
    }
    if (verified.status === "failed") {
      const failedAt = new Date();
      await transaction.paymentRefund.update({
        where: { id: refund.id },
        data: {
          ...identity,
          status: "FAILED",
          active: false,
          failedAt,
          safeFailureCode: "PROVIDER_REFUND_FAILED",
        },
      });
      await transaction.payment.update({
        where: { id: refund.paymentId },
        data: {
          reconciliationStatus: "RESOLVED",
          reconciliationNote: null,
          reconciledAt: failedAt,
        },
      });
      await recordPlatformAuditEvent(transaction, {
        actorUserId: null,
        action: "PLATFORM_PAYMENT_REFUND_FAILED",
        resourceType: "PAYMENT_REFUND",
        resourceId: refund.id,
        metadata: {
          paymentReference: refund.payment.internalReference,
          refundReference: refund.internalReference,
          failureCode: "PROVIDER_REFUND_FAILED",
        },
      });
      return { status: "FAILED" as const, idempotent: false };
    }

    const completedAt = safeDate(verified.refundedAt) ?? new Date();
    if (refund.payment.purpose === "DOCUMENT_CREDITS") {
      const purchase = refund.payment.documentCreditPurchase;
      if (!purchase || !refund.creditAmount) {
        throw new PaymentRefundError("REFUND_UNAVAILABLE");
      }
      const ledgerBalance = await getPurchasedCreditLedgerBalance(
        transaction,
        refund.workspaceId,
      );
      if (ledgerBalance < refund.creditAmount) {
        throw new PaymentRefundError("CREDITS_ALREADY_USED");
      }
      if (!refund.creditLedgerEntry) {
        await transaction.documentCreditTransaction.create({
          data: {
            workspaceId: refund.workspaceId,
            type: "REFUND",
            amount: -refund.creditAmount,
            source: "PAYSTACK_REFUND",
            sourceReference: `payment-refund:${refund.id}`,
            packId: purchase.packId,
            refundId: refund.id,
            actorUserId: refund.initiatedByUserId,
            metadata: {
              refundReference: refund.internalReference,
              paymentReference: refund.payment.internalReference,
            },
          },
        });
      }
      await transaction.documentCreditPurchase.update({
        where: { id: purchase.id },
        data: { status: "REFUNDED" },
      });
    }

    await transaction.paymentRefund.update({
      where: { id: refund.id },
      data: {
        ...identity,
        status: "SUCCEEDED",
        active: false,
        completedAt,
        refundedAt: safeDate(verified.refundedAt) ?? completedAt,
        safeFailureCode: null,
      },
    });
    const succeeded = await transaction.paymentRefund.aggregate({
      where: { paymentId: refund.paymentId, status: "SUCCEEDED" },
      _sum: { amount: true },
    });
    const totalRefundedMinor = toMinorUnits(
      (succeeded._sum.amount ?? refund.amount).toString(),
      "GHS",
    );
    const paymentMinor = toMinorUnits(refund.payment.amount, "GHS");
    const partial = totalRefundedMinor < paymentMinor;
    const subscriptionRefund = refund.payment.purpose !== "DOCUMENT_CREDITS";
    await transaction.payment.update({
      where: { id: refund.paymentId },
      data: {
        status: partial ? "PARTIALLY_REFUNDED" : "REFUNDED",
        ...(subscriptionRefund && !partial
          ? {
              reconciliationStatus: "REQUIRED",
              reconciliationNote: "SUBSCRIPTION_REFUND_ENTITLEMENT_REVIEW",
            }
          : {
              reconciliationStatus: "RESOLVED",
              reconciliationNote: null,
              reconciledAt: completedAt,
            }),
      },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: null,
      action: "PLATFORM_PAYMENT_REFUND_SUCCEEDED",
      resourceType: "PAYMENT_REFUND",
      resourceId: refund.id,
      metadata: {
        paymentReference: refund.payment.internalReference,
        refundReference: refund.internalReference,
        amount: refund.amount.toFixed(2),
        currency: refund.currency,
        partial,
      },
    });
    if (subscriptionRefund && !partial) {
      await recordPlatformAuditEvent(transaction, {
        actorUserId: null,
        action: "PLATFORM_PAYMENT_RECONCILIATION_REQUIRED",
        resourceType: "PAYMENT",
        resourceId: refund.paymentId,
        metadata: {
          paymentReference: refund.payment.internalReference,
          reasonCode: "SUBSCRIPTION_REFUND_ENTITLEMENT_REVIEW",
        },
      });
    }
    await recordAuditEvent(transaction, {
      workspaceId: refund.workspaceId,
      actorUserId: null,
      action: "PAYMENT_REFUND_SUCCEEDED",
      resourceType: "PAYMENT",
      resourceId: refund.paymentId,
      metadata: {
        paymentReference: refund.payment.internalReference,
        refundReference: refund.internalReference,
        purpose: refund.payment.purpose,
        amount: refund.amount.toFixed(2),
        currency: refund.currency,
        partial,
      },
    });
    return { status: "SUCCEEDED" as const, idempotent: false };
  }, commercialTransactionOptions);
}

const refundEventSchema = z.object({
  providerRefundId: z.string().max(100).nullable(),
  refundStatus: z.enum(["pending", "processing", "needs-attention", "failed", "processed"]),
  transactionReference: z.string().max(100),
  domain: z.string().max(20).nullable().optional(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
});

export async function processRefundProviderEvent(event: ParsedProviderEvent) {
  if (!event.providerReference) return { handled: false, idempotent: false };
  const safe = refundEventSchema.safeParse(event.safeData);
  if (!safe.success) throw new PaymentVerificationError();
  const payment = await db.paymentAttempt.findUnique({
    where: { providerReference: event.providerReference },
    select: { paymentId: true },
  });
  if (!payment) return { handled: false, idempotent: false };
  const amount = minorUnitsToDecimalString(safe.data.amountMinor, "GHS");
  const refund = await db.paymentRefund.findFirst({
    where: {
      paymentId: payment.paymentId,
      amount,
      currency: safe.data.currency,
      OR: [
        ...(safe.data.providerRefundId
          ? [
              { providerRefundId: safe.data.providerRefundId },
              { providerRefundReference: safe.data.providerRefundId },
            ]
          : []),
        { active: true },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!refund) return { handled: false, idempotent: false };
  const result = await applyVerifiedRefundState(refund.id, {
    providerRefundReference: safe.data.providerRefundId,
    transactionReference: safe.data.transactionReference,
    transactionIdentifier: safe.data.transactionReference,
    domain: safe.data.domain,
    status: safe.data.refundStatus,
    amountMinor: safe.data.amountMinor,
    currency: safe.data.currency,
  });
  return { handled: true, idempotent: result.idempotent };
}

async function markReconciliationRequired(
  actorUserId: string,
  paymentId: string,
  reasonCode: string,
) {
  return db.$transaction(async (transaction) => {
    await requirePlatformPaymentCapability(
      transaction,
      actorUserId,
      PLATFORM_CAPABILITIES.RECONCILE_PAYMENTS,
    );
    await lockPayment(transaction, paymentId);
    const payment = await transaction.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { internalReference: true },
    });
    await transaction.payment.update({
      where: { id: paymentId },
      data: {
        reconciliationStatus: "REQUIRED",
        reconciliationNote: reasonCode,
      },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId,
      action: "PLATFORM_PAYMENT_RECONCILIATION_REQUIRED",
      resourceType: "PAYMENT",
      resourceId: paymentId,
      metadata: { paymentReference: payment.internalReference, reasonCode },
    });
  }, commercialTransactionOptions);
}

export async function reconcilePaymentOperation(
  input: unknown,
  provider: PaymentProviderClient = getPaystackPaymentProvider(),
) {
  const parsed = reconcileSchema.safeParse(input);
  if (!parsed.success) throw new PaymentRefundError("PAYMENT_UNAVAILABLE");
  const context = await db.$transaction(async (transaction) => {
    await requirePlatformPaymentCapability(
      transaction,
      parsed.data.actorUserId,
      PLATFORM_CAPABILITIES.RECONCILE_PAYMENTS,
    );
    const payment = await transaction.payment.findUnique({
      where: { id: parsed.data.paymentId },
      select: {
        id: true,
        internalReference: true,
        providerReference: true,
        status: true,
      },
    });
    if (!payment) throw new PaymentRefundError("PAYMENT_UNAVAILABLE");
    const refund = parsed.data.refundId
      ? await transaction.paymentRefund.findFirst({
          where: { id: parsed.data.refundId, paymentId: payment.id },
          select: { id: true, providerRefundId: true },
        })
      : await transaction.paymentRefund.findFirst({
          where: { paymentId: payment.id, active: true },
          orderBy: { createdAt: "desc" },
          select: { id: true, providerRefundId: true },
        });
    return { payment, refund };
  }, commercialTransactionOptions);

  let outcome: "NO_CHANGE" | "PAYMENT_UPDATED" | "REFUND_UPDATED" = "NO_CHANGE";
  try {
    if (context.refund) {
      if (!context.refund.providerRefundId || !provider.fetchRefund) {
        await markReconciliationRequired(
          parsed.data.actorUserId,
          context.payment.id,
          "REFUND_PROVIDER_ID_UNAVAILABLE",
        );
        throw new PaymentRefundError("RECONCILIATION_REVIEW_REQUIRED");
      }
      const verified = await provider.fetchRefund(context.refund.providerRefundId);
      const applied = await applyVerifiedRefundState(
        context.refund.id,
        providerState(verified),
      );
      outcome = applied.idempotent ? "NO_CHANGE" : "REFUND_UPDATED";
    } else if (["PENDING", "PROCESSING", "FAILED"].includes(context.payment.status)) {
      if (!context.payment.providerReference) {
        throw new PaymentRefundError("RECONCILIATION_REVIEW_REQUIRED");
      }
      const result = await verifyPaymentByReference(context.payment.providerReference, {
        provider,
      });
      outcome = result.idempotent ? "NO_CHANGE" : "PAYMENT_UPDATED";
    }
  } catch (error) {
    if (
      error instanceof PaymentVerificationError ||
      error instanceof PaymentRefundError
    ) {
      if (!(error instanceof PaymentRefundError && error.reason === "RECONCILIATION_REVIEW_REQUIRED")) {
        await markReconciliationRequired(
          parsed.data.actorUserId,
          context.payment.id,
          "PROVIDER_STATE_AMBIGUOUS",
        );
      }
    }
    throw error;
  }

  await db.$transaction(async (transaction) => {
    await requirePlatformPaymentCapability(
      transaction,
      parsed.data.actorUserId,
      PLATFORM_CAPABILITIES.RECONCILE_PAYMENTS,
    );
    await lockPayment(transaction, context.payment.id);
    const current = await transaction.payment.findUniqueOrThrow({
      where: { id: context.payment.id },
      select: { reconciliationNote: true },
    });
    const entitlementReviewRequired =
      current.reconciliationNote === "SUBSCRIPTION_REFUND_ENTITLEMENT_REVIEW";
    await transaction.payment.update({
      where: { id: context.payment.id },
      data: entitlementReviewRequired
        ? { reconciledAt: new Date() }
        : {
            reconciliationStatus: "RESOLVED",
            reconciliationNote: null,
            reconciledAt: new Date(),
          },
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: parsed.data.actorUserId,
      action: "PLATFORM_PAYMENT_RECONCILED",
      resourceType: "PAYMENT",
      resourceId: context.payment.id,
      metadata: {
        paymentReference: context.payment.internalReference,
        outcome,
      },
    });
  }, commercialTransactionOptions);
  return { outcome };
}
