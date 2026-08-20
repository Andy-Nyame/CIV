import "server-only";

import { z } from "zod";

import { requireSubscriptionManagerInTransaction } from "@/features/subscriptions/authorization";
import type { PaymentPurpose, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { readPaystackConfig } from "./config";
import { toMinorUnits } from "./currency";
import {
  PaymentAuthorizationError,
  PaymentConfigurationError,
  PaymentNotFoundError,
  PaymentProviderError,
  PaymentValidationError,
  PaymentVerificationError,
} from "./errors";
import { getPaystackPaymentProvider } from "./paystack";
import type { PaymentProviderClient, VerifiedProviderPayment } from "./provider";
import { createInternalPaymentReference } from "./reference";

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const paymentReferenceSchema = z.string().regex(/^CIV-PAY-[A-F0-9]{32}$/);
const transactionOptions = { maxWait: 15_000, timeout: 30_000 } as const;

export type PaymentFoundation = {
  paymentId: string;
  attemptId: string;
  reference: string;
};

export async function lockPayment(
  transaction: Prisma.TransactionClient,
  paymentId: string,
) {
  await transaction.$queryRaw<[{ lock: string }]>`
    SELECT pg_advisory_xact_lock(hashtext(${`civ-payment:${paymentId}`}))::text AS lock
  `;
}

function safeVerificationMetadata(verification: VerifiedProviderPayment) {
  return {
    transactionId: verification.transactionId,
    status: verification.status,
    domain: verification.domain,
    channel: verification.channel,
    gatewayResponse: verification.gatewayResponse,
    paidAt: verification.paidAt,
    planCode: verification.planCode,
    customerCode: verification.customerCode,
  } satisfies Prisma.InputJsonObject;
}

async function markInitializationFailed(paymentId: string, attemptId: string) {
  const failedAt = new Date();
  await db.$transaction([
    db.payment.update({
      where: { id: paymentId },
      data: { status: "FAILED", failedAt },
    }),
    db.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        status: "FAILED",
        failedAt,
        responseMetadata: { failureStage: "INITIALIZATION" },
      },
    }),
  ]);
}

export async function createPaymentFoundationInTransaction(
  transaction: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    workspaceId: string;
    purpose: PaymentPurpose;
    amount: string;
    currency: "GHS";
    reference: string;
    safeMetadata?: Prisma.InputJsonObject;
    documentCreditPurchaseId?: string;
    subscriptionChangeId?: string;
  },
): Promise<PaymentFoundation> {
  const amountMinor = toMinorUnits(input.amount, input.currency);
  const payment = await transaction.payment.create({
    data: {
      workspaceId: input.workspaceId,
      initiatedByUserId: input.actorUserId,
      purpose: input.purpose,
      provider: "PAYSTACK",
      internalReference: input.reference,
      amount: input.amount,
      currency: input.currency,
      status: "PENDING",
      metadata: input.safeMetadata,
      documentCreditPurchaseId: input.documentCreditPurchaseId,
      subscriptionChangeId: input.subscriptionChangeId,
    },
    select: { id: true },
  });
  const attempt = await transaction.paymentAttempt.create({
    data: {
      paymentId: payment.id,
      provider: "PAYSTACK",
      providerReference: input.reference,
      requestMetadata: {
        amountMinor,
        currency: input.currency,
        purpose: input.purpose,
        callbackPath: "/app/settings/billing/payment-return",
      },
    },
    select: { id: true },
  });
  return {
    paymentId: payment.id,
    attemptId: attempt.id,
    reference: input.reference,
  };
}

export async function initializePaymentFoundation(
  foundation: PaymentFoundation,
  input: {
    email: string;
    amount: string;
    currency: "GHS";
    purpose: PaymentPurpose;
    metadata: Record<string, string>;
    channels?: readonly ("card" | "mobile_money")[];
    planCode?: string;
  },
  provider: PaymentProviderClient = getPaystackPaymentProvider(),
) {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new PaymentValidationError();
  const amountMinor = toMinorUnits(input.amount, input.currency);
  const config = readPaystackConfig();
  try {
    const initialized = await provider.initializePayment({
      amountMinor,
      callbackUrl: config.callbackUrl,
      channels: input.channels,
      currency: input.currency,
      email: email.data,
      reference: foundation.reference,
      metadata: input.metadata,
      planCode: input.planCode,
    });
    const updatedAt = new Date();
    await db.$transaction([
      db.payment.update({
        where: { id: foundation.paymentId },
        data: {
          providerReference: initialized.reference,
          status: "PROCESSING",
        },
      }),
      db.paymentAttempt.update({
        where: { id: foundation.attemptId },
        data: {
          providerReference: initialized.reference,
          providerAccessCode: initialized.accessCode,
          authorizationUrl: initialized.authorizationUrl,
          status: "INITIALIZED",
          initializedAt: updatedAt,
          responseMetadata: { initializationStatus: "INITIALIZED" },
        },
      }),
    ]);
    return {
      paymentId: foundation.paymentId,
      reference: foundation.reference,
      authorizationUrl: initialized.authorizationUrl,
    };
  } catch (error) {
    await markInitializationFailed(foundation.paymentId, foundation.attemptId);
    if (
      error instanceof PaymentProviderError ||
      error instanceof PaymentConfigurationError
    ) {
      throw error;
    }
    throw new PaymentProviderError();
  }
}

export async function initializePayment(
  input: {
    actorUserId: string;
    workspaceId: string;
    email: string;
    purpose: PaymentPurpose;
    amount: string;
    currency: "GHS";
    safeMetadata?: Prisma.InputJsonObject;
  },
  provider: PaymentProviderClient = getPaystackPaymentProvider(),
) {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new PaymentValidationError();
  const reference = createInternalPaymentReference();

  const foundation = await db.$transaction(async (transaction) => {
    await requireSubscriptionManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );
    return createPaymentFoundationInTransaction(transaction, {
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      purpose: input.purpose,
      amount: input.amount,
      currency: input.currency,
      reference,
      safeMetadata: input.safeMetadata,
    });
  }, transactionOptions);
  return initializePaymentFoundation(
    foundation,
    {
      email: email.data,
      amount: input.amount,
      currency: input.currency,
      purpose: input.purpose,
      metadata: {
        civReference: reference,
        purpose: input.purpose,
        entitlementGrant: "false",
      },
    },
    provider,
  );
}

export async function initializeBillingTestPayment(
  input: { actorUserId: string; workspaceId: string; email: string },
  provider?: PaymentProviderClient,
) {
  if (
    process.env.APP_ENV !== "development" ||
    process.env.PAYSTACK_MODE !== "test"
  ) {
    throw new PaymentConfigurationError();
  }
  return initializePayment(
    {
      ...input,
      purpose: "BILLING_TEST",
      amount: "1.00",
      currency: "GHS",
      safeMetadata: {
        testMode: true,
        entitlementGrant: false,
        description: "Admin D.1 infrastructure checkout",
      },
    },
    provider,
  );
}

function verificationStatus(status: string) {
  if (status === "success") return "SUCCEEDED" as const;
  if (["failed", "abandoned", "reversed"].includes(status)) {
    return "FAILED" as const;
  }
  return "PROCESSING" as const;
}

export async function verifyPaymentByReference(
  referenceInput: unknown,
  options: {
    provider?: PaymentProviderClient;
    actorUserId?: string;
    workspaceId?: string;
  } = {},
) {
  const reference = paymentReferenceSchema.safeParse(referenceInput);
  if (!reference.success) throw new PaymentValidationError();

  const attempt = await db.paymentAttempt.findUnique({
    where: { providerReference: reference.data },
    select: {
      id: true,
      payment: {
        select: {
          id: true,
          workspaceId: true,
          initiatedByUserId: true,
          amount: true,
          currency: true,
          status: true,
          purpose: true,
          initiatedBy: { select: { email: true } },
          subscriptionChange: {
            select: { providerPlanCodeSnapshot: true },
          },
        },
      },
    },
  });
  if (!attempt) throw new PaymentNotFoundError();
  if (
    (options.workspaceId && attempt.payment.workspaceId !== options.workspaceId) ||
    (options.actorUserId &&
      attempt.payment.initiatedByUserId !== options.actorUserId)
  ) {
    throw new PaymentAuthorizationError();
  }
  if (attempt.payment.status === "SUCCEEDED") {
    const { fulfillPaymentEntitlement } = await import("./credit-purchases");
    const fulfillment = await fulfillPaymentEntitlement(attempt.payment.id);
    return { status: "SUCCEEDED" as const, idempotent: true, fulfillment };
  }

  const provider = options.provider ?? getPaystackPaymentProvider();
  const verified = await provider.verifyPayment(reference.data);
  const expectedMinor = toMinorUnits(
    attempt.payment.amount,
    attempt.payment.currency as "GHS",
  );
  const expectedEmail = attempt.payment.initiatedBy?.email?.trim().toLowerCase();
  const subscriptionInitial = attempt.payment.purpose === "SUBSCRIPTION_INITIAL";
  const matches =
    verified.domain === "test" &&
    verified.reference === reference.data &&
    verified.amountMinor === expectedMinor &&
    verified.currency === attempt.payment.currency &&
    (!expectedEmail || verified.customerEmail === expectedEmail) &&
    (!subscriptionInitial ||
      (verified.channel === "card" &&
        verified.planCode ===
          attempt.payment.subscriptionChange?.providerPlanCodeSnapshot));
  if (!matches) throw new PaymentVerificationError();

  const status = verificationStatus(verified.status);
  const now = new Date();
  const providerPaidAt = verified.paidAt ? new Date(verified.paidAt) : null;
  const completedAt =
    providerPaidAt && !Number.isNaN(providerPaidAt.getTime())
      ? providerPaidAt
      : now;
  await db.$transaction(async (transaction) => {
    await lockPayment(transaction, attempt.payment.id);
    const current = await transaction.payment.findUniqueOrThrow({
      where: { id: attempt.payment.id },
      select: { status: true },
    });
    if (current.status === "SUCCEEDED") return;

    await transaction.payment.update({
      where: { id: attempt.payment.id },
      data: {
        status,
        completedAt: status === "SUCCEEDED" ? completedAt : null,
        failedAt: status === "FAILED" ? now : null,
      },
    });
    await transaction.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        verifiedAt: now,
        completedAt: status === "SUCCEEDED" ? completedAt : null,
        failedAt: status === "FAILED" ? now : null,
        responseMetadata: safeVerificationMetadata(verified),
      },
    });
  }, transactionOptions);

  let fulfillment = null;
  if (status === "SUCCEEDED") {
    const entitlement = await import("./credit-purchases");
    fulfillment = await entitlement.fulfillPaymentEntitlement(attempt.payment.id);
  } else if (status === "FAILED") {
    const entitlement = await import("./credit-purchases");
    await entitlement.markPaymentEntitlementFailed(attempt.payment.id);
  }
  return { status, idempotent: false, fulfillment };
}
