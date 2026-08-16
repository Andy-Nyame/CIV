import "server-only";

import { recordAuditEvent } from "@/features/audit/service";
import { getPurchasedCreditBalance } from "@/features/commercial/ledger";
import {
  commercialTransactionOptions,
  lockWorkspaceCommercialAccount,
} from "@/features/commercial/locking";
import { creditPackCodeSchema } from "@/features/commercial/validation";
import { requireSubscriptionManagerInTransaction } from "@/features/subscriptions/authorization";
import { db } from "@/lib/db";

import { DocumentCreditPaymentError, PaymentValidationError } from "./errors";
import type { PaymentProviderClient } from "./provider";
import { createInternalPaymentReference } from "./reference";
import {
  createPaymentFoundationInTransaction,
  initializePaymentFoundation,
  lockPayment,
} from "./service";

type CheckoutPreparation =
  | {
      kind: "INITIALIZE";
      foundation: Awaited<ReturnType<typeof createPaymentFoundationInTransaction>>;
      purchaseId: string;
      amount: string;
      currency: "GHS";
      packCode: string;
    }
  | {
      kind: "EXISTING_CHECKOUT";
      purchaseId: string;
      paymentId: string;
      reference: string;
      authorizationUrl: string;
    }
  | {
      kind: "ALREADY_SUCCEEDED";
      purchaseId: string;
      paymentId: string;
      reference: string;
    };

const purchaseIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function preparePaidCheckout(input: {
  actorUserId: string;
  workspaceId: string;
  packCode?: unknown;
  purchaseId?: unknown;
}): Promise<CheckoutPreparation> {
  const parsedPackCode =
    input.packCode === undefined
      ? null
      : creditPackCodeSchema.safeParse(input.packCode);
  const parsedPurchaseId =
    typeof input.purchaseId === "string" && purchaseIdPattern.test(input.purchaseId)
      ? input.purchaseId
      : null;
  if ((!parsedPackCode || !parsedPackCode.success) && !parsedPurchaseId) {
    throw new PaymentValidationError();
  }

  return db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, input.workspaceId);
    await requireSubscriptionManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );

    let purchase = parsedPurchaseId
      ? await transaction.documentCreditPurchase.findFirst({
          where: {
            id: parsedPurchaseId,
            workspaceId: input.workspaceId,
            betaAcquisition: false,
          },
          include: { pack: true },
        })
      : null;
    const pack = purchase?.pack ??
      (parsedPackCode?.success
        ? await transaction.documentCreditPack.findUnique({
            where: { code: parsedPackCode.data },
          })
        : null);
    if (!pack?.isActive || !pack.isPublic) {
      throw new DocumentCreditPaymentError("PACK_UNAVAILABLE");
    }

    if (!purchase && parsedPackCode?.success) {
      purchase = await transaction.documentCreditPurchase.findFirst({
        where: {
          workspaceId: input.workspaceId,
          packId: pack.id,
          betaAcquisition: false,
          status: { in: ["PENDING", "FAILED", "CANCELLED"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { pack: true },
      });
    }

    const amount = purchase?.priceSnapshot ?? pack.price;
    const currency = purchase?.currencySnapshot ?? pack.currency;
    if (amount.equals(0)) {
      throw new DocumentCreditPaymentError("FREE_PACK");
    }
    if (currency !== "GHS") {
      throw new DocumentCreditPaymentError("PURCHASE_UNAVAILABLE");
    }
    if (purchase?.status === "COMPLETED" || purchase?.status === "REFUNDED") {
      throw new DocumentCreditPaymentError("PURCHASE_UNAVAILABLE");
    }

    if (purchase?.status === "PENDING") {
      const latestPayment = await transaction.payment.findFirst({
        where: { documentCreditPurchaseId: purchase.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          attempts: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
      });
      const latestAttempt = latestPayment?.attempts[0];
      if (
        latestPayment?.status === "PROCESSING" &&
        latestAttempt?.authorizationUrl
      ) {
        return {
          kind: "EXISTING_CHECKOUT" as const,
          purchaseId: purchase.id,
          paymentId: latestPayment.id,
          reference: latestPayment.internalReference,
          authorizationUrl: latestAttempt.authorizationUrl,
        };
      }
      if (latestPayment?.status === "SUCCEEDED") {
        return {
          kind: "ALREADY_SUCCEEDED" as const,
          purchaseId: purchase.id,
          paymentId: latestPayment.id,
          reference: latestPayment.internalReference,
        };
      }
      if (latestPayment?.status === "PENDING") {
        throw new DocumentCreditPaymentError("INITIALIZATION_IN_PROGRESS");
      }
    }

    if (!purchase) {
      purchase = await transaction.documentCreditPurchase.create({
        data: {
          workspaceId: input.workspaceId,
          packId: pack.id,
          actorUserId: input.actorUserId,
          status: "PENDING",
          betaAcquisition: false,
          creditAmountSnapshot: pack.creditAmount,
          priceSnapshot: pack.price,
          currencySnapshot: pack.currency,
        },
        include: { pack: true },
      });
    } else if (purchase.status !== "PENDING") {
      purchase = await transaction.documentCreditPurchase.update({
        where: { id: purchase.id },
        data: { status: "PENDING" },
        include: { pack: true },
      });
    }

    const reference = createInternalPaymentReference();
    const foundation = await createPaymentFoundationInTransaction(transaction, {
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      purpose: "DOCUMENT_CREDITS",
      amount: purchase.priceSnapshot.toFixed(2),
      currency: "GHS",
      reference,
      documentCreditPurchaseId: purchase.id,
      safeMetadata: {
        purchaseId: purchase.id,
        packCode: purchase.pack.code,
        entitlementGrant: "VERIFIED_PAYMENT_ONLY",
        testMode: true,
      },
    });
    return {
      kind: "INITIALIZE" as const,
      foundation,
      purchaseId: purchase.id,
      amount: purchase.priceSnapshot.toFixed(2),
      currency: "GHS" as const,
      packCode: purchase.pack.code,
    };
  }, commercialTransactionOptions);
}

export async function initializeDocumentCreditPurchase(
  input: {
    actorUserId: string;
    workspaceId: string;
    email: string;
    packCode?: unknown;
    purchaseId?: unknown;
  },
  provider?: PaymentProviderClient,
) {
  const prepared = await preparePaidCheckout(input);
  if (prepared.kind === "EXISTING_CHECKOUT") {
    return { ...prepared, reused: true as const };
  }
  if (prepared.kind === "ALREADY_SUCCEEDED") {
    const fulfilled = await fulfillDocumentCreditPurchase(prepared.paymentId);
    return { ...prepared, fulfilled, reused: true as const };
  }

  try {
    const initialized = await initializePaymentFoundation(
      prepared.foundation,
      {
        email: input.email,
        amount: prepared.amount,
        currency: prepared.currency,
        purpose: "DOCUMENT_CREDITS",
        channels: ["card", "mobile_money"],
        metadata: {
          civReference: prepared.foundation.reference,
          purpose: "DOCUMENT_CREDITS",
          purchaseId: prepared.purchaseId,
          packCode: prepared.packCode,
        },
      },
      provider,
    );
    return {
      kind: "INITIALIZED" as const,
      ...initialized,
      purchaseId: prepared.purchaseId,
      reused: false as const,
    };
  } catch (error) {
    await db.$transaction(async (transaction) => {
      await lockWorkspaceCommercialAccount(transaction, input.workspaceId);
      const activePayments = await transaction.payment.count({
        where: {
          documentCreditPurchaseId: prepared.purchaseId,
          status: { in: ["PENDING", "PROCESSING", "SUCCEEDED"] },
        },
      });
      if (activePayments === 0) {
        await transaction.documentCreditPurchase.updateMany({
          where: { id: prepared.purchaseId, status: "PENDING" },
          data: { status: "FAILED" },
        });
      }
    }, commercialTransactionOptions);
    throw error;
  }
}

export async function fulfillDocumentCreditPurchase(paymentId: string) {
  return db.$transaction(async (transaction) => {
    await lockPayment(transaction, paymentId);
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      include: {
        documentCreditPurchase: { include: { pack: true } },
      },
    });
    if (
      !payment ||
      payment.status !== "SUCCEEDED" ||
      payment.purpose !== "DOCUMENT_CREDITS" ||
      !payment.documentCreditPurchase
    ) {
      throw new DocumentCreditPaymentError("PURCHASE_UNAVAILABLE");
    }

    const purchase = payment.documentCreditPurchase;
    await lockWorkspaceCommercialAccount(transaction, purchase.workspaceId);
    if (
      payment.workspaceId !== purchase.workspaceId ||
      !payment.amount.equals(purchase.priceSnapshot) ||
      payment.currency !== purchase.currencySnapshot
    ) {
      throw new DocumentCreditPaymentError("FULFILLMENT_MISMATCH");
    }

    const existingLedgerEntry = await transaction.documentCreditTransaction.findUnique({
      where: { purchaseId: purchase.id },
      select: { id: true },
    });
    if (purchase.status === "COMPLETED" && existingLedgerEntry) {
      return {
        purchaseId: purchase.id,
        ledgerEntryId: existingLedgerEntry.id,
        credits: purchase.creditAmountSnapshot,
        balance: await getPurchasedCreditBalance(transaction, purchase.workspaceId),
        idempotent: true,
      };
    }
    if (existingLedgerEntry || purchase.status === "REFUNDED") {
      throw new DocumentCreditPaymentError("FULFILLMENT_MISMATCH");
    }

    const now = new Date();
    await transaction.documentCreditPurchase.update({
      where: { id: purchase.id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        externalPaymentReference: payment.internalReference,
      },
    });
    const ledgerEntry = await transaction.documentCreditTransaction.create({
      data: {
        workspaceId: purchase.workspaceId,
        type: "PURCHASE",
        amount: purchase.creditAmountSnapshot,
        source: "PAYSTACK_CREDIT_PACK",
        sourceReference: `paystack-purchase:${purchase.id}`,
        packId: purchase.packId,
        purchaseId: purchase.id,
        actorUserId: purchase.actorUserId,
        metadata: {
          packCode: purchase.pack.code,
          paymentReference: payment.internalReference,
          paymentProvider: payment.provider,
          paymentMode: "TEST",
        },
      },
      select: { id: true },
    });

    const activeActor = purchase.actorUserId
      ? await transaction.membership.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: purchase.workspaceId,
              userId: purchase.actorUserId,
            },
          },
          select: { status: true },
        })
      : null;
    await recordAuditEvent(transaction, {
      workspaceId: purchase.workspaceId,
      actorUserId: activeActor?.status === "ACTIVE" ? purchase.actorUserId : null,
      action: "DOCUMENT_CREDITS_ACQUIRED",
      resourceType: "CREDIT_ACCOUNT",
      resourceId: purchase.id,
      metadata: {
        packCode: purchase.pack.code,
        credits: purchase.creditAmountSnapshot,
        amount: purchase.priceSnapshot.toFixed(4),
        currency: purchase.currencySnapshot,
        acquisitionMethod: "PAYSTACK_TEST",
        paymentReference: payment.internalReference,
      },
    });
    return {
      purchaseId: purchase.id,
      ledgerEntryId: ledgerEntry.id,
      credits: purchase.creditAmountSnapshot,
      balance: await getPurchasedCreditBalance(transaction, purchase.workspaceId),
      idempotent: false,
    };
  }, commercialTransactionOptions);
}

export async function fulfillPaymentEntitlement(
  paymentId: string,
): Promise<
  | null
  | {
      kind?: "DOCUMENT_CREDITS" | "SUBSCRIPTION";
      purchaseId?: string;
      ledgerEntryId?: string;
      credits?: number;
      balance?: number;
      subscriptionId?: string;
      planCode?: string;
      idempotent: boolean;
    }
> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { purpose: true },
  });
  if (!payment) return null;
  if (payment.purpose === "DOCUMENT_CREDITS") {
    return {
      kind: "DOCUMENT_CREDITS",
      ...(await fulfillDocumentCreditPurchase(paymentId)),
    };
  }
  if (payment.purpose === "SUBSCRIPTION_INITIAL") {
    const recurring = await import("./recurring-subscriptions");
    return recurring.fulfillRecurringSubscriptionPayment(paymentId);
  }
  return null;
}

export async function markPaymentEntitlementFailed(paymentId: string) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { purpose: true },
  });
  if (!payment) return false;
  if (payment.purpose === "DOCUMENT_CREDITS") {
    return markDocumentCreditPurchasePaymentFailed(paymentId);
  }
  if (payment.purpose === "SUBSCRIPTION_INITIAL") {
    const recurring = await import("./recurring-subscriptions");
    return recurring.markRecurringSubscriptionPaymentFailed(paymentId);
  }
  return false;
}

export async function markDocumentCreditPurchasePaymentFailed(paymentId: string) {
  return db.$transaction(async (transaction) => {
    await lockPayment(transaction, paymentId);
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      select: { documentCreditPurchaseId: true, workspaceId: true, purpose: true },
    });
    if (!payment?.documentCreditPurchaseId || payment.purpose !== "DOCUMENT_CREDITS") {
      return false;
    }
    await lockWorkspaceCommercialAccount(transaction, payment.workspaceId);
    const otherActivePayments = await transaction.payment.count({
      where: {
        documentCreditPurchaseId: payment.documentCreditPurchaseId,
        id: { not: paymentId },
        status: { in: ["PENDING", "PROCESSING", "SUCCEEDED"] },
      },
    });
    if (otherActivePayments > 0) return false;
    const updated = await transaction.documentCreditPurchase.updateMany({
      where: { id: payment.documentCreditPurchaseId, status: "PENDING" },
      data: { status: "FAILED" },
    });
    return updated.count === 1;
  }, commercialTransactionOptions);
}
