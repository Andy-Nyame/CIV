import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { consumeDocumentCapacity } from "@/features/commercial/capacity";
import { getPurchasedCreditBalance } from "@/features/commercial/ledger";
import { db } from "@/lib/db";

import {
  PaymentAuthorizationError,
  PaymentProviderError,
  PaymentRefundError,
  PaymentVerificationError,
} from "./errors";
import type {
  CreateProviderRefundInput,
  InitializeProviderPaymentInput,
  ParsedProviderEvent,
  PaymentProviderClient,
  ProviderRefund,
  VerifiedProviderPayment,
} from "./provider";
import { createInternalPaymentReference } from "./reference";
import {
  applyVerifiedRefundState,
  reconcilePaymentOperation,
  requestPaymentRefund,
} from "./refunds";
import { processPaystackWebhook } from "./webhook";

test.after(async () => {
  await db.$disconnect();
});

class RefundProvider implements PaymentProviderClient {
  readonly provider = "PAYSTACK" as const;
  createCalls: CreateProviderRefundInput[] = [];
  event: ParsedProviderEvent | null = null;
  nextStatus: ProviderRefund["status"] = "pending";
  failCreate = false;
  refunds = new Map<string, ProviderRefund>();

  async initializePayment(input: InitializeProviderPaymentInput) {
    return {
      authorizationUrl: `https://checkout.paystack.com/${input.reference}`,
      accessCode: `access-${input.reference}`,
      reference: input.reference,
    };
  }

  async verifyPayment(): Promise<VerifiedProviderPayment> {
    throw new PaymentProviderError();
  }

  async createRefund(input: CreateProviderRefundInput) {
    this.createCalls.push(input);
    if (this.failCreate) throw new PaymentProviderError();
    const id = `refund-${this.createCalls.length}-${randomUUID()}`;
    const refund: ProviderRefund = {
      providerRefundId: id,
      providerRefundReference: `RFD_${randomUUID().replaceAll("-", "")}`,
      transactionReference: input.transactionReference,
      transactionIdentifier: input.transactionReference,
      domain: "test",
      status: this.nextStatus,
      amountMinor: input.amountMinor,
      currency: input.currency,
      expectedAt: new Date(Date.now() + 60_000).toISOString(),
      refundedAt: this.nextStatus === "processed" ? new Date().toISOString() : null,
    };
    this.refunds.set(id, refund);
    return refund;
  }

  async fetchRefund(providerRefundId: string) {
    const refund = this.refunds.get(providerRefundId);
    if (!refund) throw new PaymentProviderError();
    return refund;
  }

  validateWebhook(_rawBody: Uint8Array, signature: string | null) {
    return signature === "valid-refund-signature";
  }

  parseWebhookEvent() {
    if (!this.event) throw new PaymentProviderError();
    return this.event;
  }
}

test("D.4 refunds preserve financial, credit, authorization, reconciliation, and concurrency invariants", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const paymentIds: string[] = [];
  const purchaseIds: string[] = [];
  const packIds: string[] = [];

  async function createUser(kind: string) {
    const user = await db.user.create({
      data: {
        name: `D4 ${kind}`,
        email: `civ-d4-${kind}-${suffix}@example.invalid`,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user;
  }

  async function createSucceededPayment(input: {
    workspaceId: string;
    actorUserId: string;
    purpose: "DOCUMENT_CREDITS" | "SUBSCRIPTION_INITIAL";
    amount: string;
    purchaseId?: string;
  }) {
    const reference = createInternalPaymentReference();
    const payment = await db.payment.create({
      data: {
        workspaceId: input.workspaceId,
        initiatedByUserId: input.actorUserId,
        purpose: input.purpose,
        provider: "PAYSTACK",
        internalReference: reference,
        providerReference: reference,
        amount: input.amount,
        currency: "GHS",
        status: "SUCCEEDED",
        completedAt: new Date(),
        documentCreditPurchaseId: input.purchaseId,
        attempts: {
          create: {
            provider: "PAYSTACK",
            providerReference: reference,
            status: "SUCCEEDED",
            completedAt: new Date(),
          },
        },
      },
    });
    paymentIds.push(payment.id);
    return payment;
  }

  try {
    const operator = await createUser("operator");
    const finance = await createUser("finance");
    const analyst = await createUser("analyst");
    const workspaceOwner = await createUser("workspace-owner");
    await db.platformMembership.createMany({
      data: [
        { userId: operator.id, role: "PLATFORM_ADMIN", status: "ACTIVE" },
        { userId: finance.id, role: "FINANCE", status: "ACTIVE" },
        { userId: analyst.id, role: "ANALYST", status: "ACTIVE" },
      ],
    });
    const [free, starter] = await Promise.all([
      db.plan.findUniqueOrThrow({ where: { code: "FREE" }, select: { id: true } }),
      db.plan.findUniqueOrThrow({ where: { code: "STARTER" }, select: { id: true } }),
    ]);
    const workspace = await db.workspace.create({
      data: {
        name: `D4 refund workspace ${suffix}`,
        type: "BUSINESS",
        memberships: { create: { userId: workspaceOwner.id, role: "OWNER", status: "ACTIVE" } },
        subscription: { create: { planId: free.id, status: "BETA" } },
      },
      select: { id: true },
    });
    workspaceIds.push(workspace.id);
    const subscriptionWorkspace = await db.workspace.create({
      data: {
        name: `D4 subscription workspace ${suffix}`,
        type: "BUSINESS",
        memberships: { create: { userId: workspaceOwner.id, role: "OWNER", status: "ACTIVE" } },
        subscription: {
          create: {
            planId: starter.id,
            fallbackPlanId: free.id,
            status: "ACTIVE",
            provider: "PAYSTACK",
            providerSubscriptionCode: `SUB_D4${suffix.replaceAll("-", "")}`,
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
          },
        },
      },
      select: { id: true },
    });
    workspaceIds.push(subscriptionWorkspace.id);
    const pack = await db.documentCreditPack.create({
      data: {
        code: `D4_${suffix.replaceAll("-", "").slice(0, 20).toUpperCase()}`,
        name: "D4 refundable test pack",
        creditAmount: 100,
        price: "1.0000",
        currency: "GHS",
        isActive: true,
        isPublic: false,
      },
    });
    packIds.push(pack.id);

    async function creditedPurchase(label: string) {
      const purchase = await db.documentCreditPurchase.create({
        data: {
          workspaceId: workspace.id,
          packId: pack.id,
          actorUserId: workspaceOwner.id,
          status: "COMPLETED",
          betaAcquisition: false,
          creditAmountSnapshot: 100,
          priceSnapshot: "1.0000",
          currencySnapshot: "GHS",
          completedAt: new Date(),
        },
      });
      purchaseIds.push(purchase.id);
      await db.documentCreditTransaction.create({
        data: {
          workspaceId: workspace.id,
          type: "PURCHASE",
          amount: 100,
          source: "PAYSTACK_TEST",
          sourceReference: `d4-purchase-${label}-${suffix}`,
          packId: pack.id,
          purchaseId: purchase.id,
          actorUserId: workspaceOwner.id,
        },
      });
      const payment = await createSucceededPayment({
        workspaceId: workspace.id,
        actorUserId: workspaceOwner.id,
        purpose: "DOCUMENT_CREDITS",
        amount: "1.0000",
        purchaseId: purchase.id,
      });
      return { purchase, payment };
    }

    const refundable = await creditedPurchase("refundable");
    const provider = new RefundProvider();
    const [firstRequest, concurrentRequest] = await Promise.all([
      requestPaymentRefund({
        actorUserId: operator.id,
        paymentId: refundable.payment.id,
        reason: "Duplicate purchase approved for full refund.",
      }, provider),
      requestPaymentRefund({
        actorUserId: operator.id,
        paymentId: refundable.payment.id,
        reason: "Duplicate purchase approved for full refund.",
      }, provider),
    ]);
    assert.equal(provider.createCalls.length, 1);
    assert.equal(firstRequest.refundId, concurrentRequest.refundId);
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 0);
    await assert.rejects(
      consumeDocumentCapacity({
        workspaceId: workspace.id,
        actorUserId: workspaceOwner.id,
        amount: 51,
        sourceReference: `d4-reservation-consumption-${suffix}`,
      }),
    );

    const pendingRefund = await db.paymentRefund.findUniqueOrThrow({
      where: { id: firstRequest.refundId },
    });
    const storedProvider = provider.refunds.get(pendingRefund.providerRefundId!);
    assert.ok(storedProvider);
    const processed = { ...storedProvider, status: "processed" as const, refundedAt: new Date().toISOString() };
    provider.refunds.set(processed.providerRefundId, processed);
    provider.event = {
      eventType: "refund.processed",
      eventIdentifier: `refund.processed:${processed.providerRefundReference}`,
      providerReference: refundable.payment.providerReference,
      safeData: {
        providerRefundId: processed.providerRefundReference,
        refundStatus: "processed",
        transactionReference: processed.transactionReference,
        amountMinor: processed.amountMinor,
        currency: processed.currency,
      },
    };
    const raw = Buffer.from(`d4-refund-event-${suffix}`);
    await Promise.all([
      processPaystackWebhook(raw, "valid-refund-signature", provider),
      processPaystackWebhook(raw, "valid-refund-signature", provider),
      applyVerifiedRefundState(firstRequest.refundId, processed),
    ]);
    assert.equal(await db.documentCreditTransaction.count({ where: { refundId: firstRequest.refundId } }), 1);
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 0);
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: refundable.payment.id } })).status, "REFUNDED");
    assert.equal((await db.documentCreditPurchase.findUniqueOrThrow({ where: { id: refundable.purchase.id } })).status, "REFUNDED");
    assert.equal(await db.auditEvent.count({ where: { workspaceId: workspace.id, action: "PAYMENT_REFUND_SUCCEEDED", resourceId: refundable.payment.id } }), 1);

    const consumed = await creditedPurchase("consumed");
    await db.documentCreditTransaction.create({
      data: {
        workspaceId: workspace.id,
        type: "USAGE",
        amount: -1,
        source: "DOCUMENT_CAPACITY",
        sourceReference: `d4-consumed-${suffix}`,
        actorUserId: workspaceOwner.id,
      },
    });
    await assert.rejects(
      requestPaymentRefund({ actorUserId: operator.id, paymentId: consumed.payment.id, reason: "Attempt to refund credits after document use." }, provider),
      (error: unknown) => error instanceof PaymentRefundError && error.reason === "CREDITS_ALREADY_USED",
    );
    await assert.rejects(
      requestPaymentRefund({ actorUserId: operator.id, paymentId: consumed.payment.id, amount: "0.50", reason: "Attempt an unsupported partial credit refund." }, provider),
      (error: unknown) => error instanceof PaymentRefundError && error.reason === "CREDIT_PARTIAL_UNSUPPORTED",
    );

    const racePurchase = await creditedPurchase("consume-refund-race");
    provider.nextStatus = "pending";
    const [raceRefund, raceConsumption] = await Promise.allSettled([
      requestPaymentRefund({ actorUserId: operator.id, paymentId: racePurchase.payment.id, reason: "Concurrent credit refund and consumption safety test." }, provider),
      consumeDocumentCapacity({
        workspaceId: workspace.id,
        actorUserId: workspaceOwner.id,
        amount: 150,
        sourceReference: `d4-consume-refund-race-${suffix}`,
      }),
    ]);
    assert.notEqual(
      raceRefund.status === "fulfilled" && raceConsumption.status === "fulfilled",
      true,
    );

    const subscriptionPayment = await createSucceededPayment({
      workspaceId: subscriptionWorkspace.id,
      actorUserId: workspaceOwner.id,
      purpose: "SUBSCRIPTION_INITIAL",
      amount: "10.0000",
    });
    provider.nextStatus = "processed";
    await requestPaymentRefund({ actorUserId: operator.id, paymentId: subscriptionPayment.id, amount: "4.00", reason: "Approved partial subscription payment correction." }, provider);
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: subscriptionPayment.id } })).status, "PARTIALLY_REFUNDED");
    await requestPaymentRefund({ actorUserId: operator.id, paymentId: subscriptionPayment.id, amount: "6.00", reason: "Approved remaining subscription payment refund." }, provider);
    const fullyRefundedSubscriptionPayment = await db.payment.findUniqueOrThrow({ where: { id: subscriptionPayment.id } });
    assert.equal(fullyRefundedSubscriptionPayment.status, "REFUNDED");
    assert.equal(fullyRefundedSubscriptionPayment.reconciliationStatus, "REQUIRED");
    const subscription = await db.subscription.findUniqueOrThrow({ where: { workspaceId: subscriptionWorkspace.id } });
    assert.equal(subscription.status, "ACTIVE");
    assert.equal(subscription.cancelAtPeriodEnd, false);

    const reconPayment = await createSucceededPayment({
      workspaceId: subscriptionWorkspace.id,
      actorUserId: workspaceOwner.id,
      purpose: "SUBSCRIPTION_INITIAL",
      amount: "2.0000",
    });
    provider.nextStatus = "pending";
    const reconRefund = await requestPaymentRefund({ actorUserId: operator.id, paymentId: reconPayment.id, reason: "Approved test refund pending reconciliation." }, provider);
    const reconRecord = await db.paymentRefund.findUniqueOrThrow({ where: { id: reconRefund.refundId } });
    const reconProviderState = provider.refunds.get(reconRecord.providerRefundId!)!;
    provider.refunds.set(reconRecord.providerRefundId!, { ...reconProviderState, status: "processed", refundedAt: new Date().toISOString() });
    assert.deepEqual(await reconcilePaymentOperation({ actorUserId: finance.id, paymentId: reconPayment.id, refundId: reconRefund.refundId }, provider), { outcome: "REFUND_UPDATED" });
    assert.equal((await db.paymentRefund.findUniqueOrThrow({ where: { id: reconRefund.refundId } })).status, "SUCCEEDED");
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: reconPayment.id } })).reconciliationStatus, "REQUIRED");

    const failedProviderPayment = await createSucceededPayment({
      workspaceId: subscriptionWorkspace.id,
      actorUserId: workspaceOwner.id,
      purpose: "SUBSCRIPTION_INITIAL",
      amount: "2.0000",
    });
    provider.nextStatus = "failed";
    const failedRefund = await requestPaymentRefund({ actorUserId: operator.id, paymentId: failedProviderPayment.id, reason: "Provider-confirmed refund failure test." }, provider);
    assert.equal(failedRefund.existing, false);
    if (failedRefund.existing) assert.fail("A new provider failure fixture must create a refund.");
    assert.equal(failedRefund.status, "FAILED");
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: failedProviderPayment.id } })).status, "SUCCEEDED");

    provider.nextStatus = "pending";
    const mismatchPayment = await createSucceededPayment({
      workspaceId: subscriptionWorkspace.id,
      actorUserId: workspaceOwner.id,
      purpose: "SUBSCRIPTION_INITIAL",
      amount: "2.0000",
    });
    const mismatchRefund = await requestPaymentRefund({ actorUserId: operator.id, paymentId: mismatchPayment.id, reason: "Provider verification mismatch test." }, provider);
    const mismatchRecord = await db.paymentRefund.findUniqueOrThrow({ where: { id: mismatchRefund.refundId } });
    const mismatchState = provider.refunds.get(mismatchRecord.providerRefundId!)!;
    await assert.rejects(
      applyVerifiedRefundState(mismatchRefund.refundId, { ...mismatchState, amountMinor: mismatchState.amountMinor + 1 }),
      PaymentVerificationError,
    );
    await assert.rejects(
      applyVerifiedRefundState(mismatchRefund.refundId, { ...mismatchState, currency: "USD" }),
      PaymentVerificationError,
    );
    assert.equal((await db.paymentRefund.findUniqueOrThrow({ where: { id: mismatchRefund.refundId } })).status, "PROCESSING");

    await assert.rejects(
      requestPaymentRefund({ actorUserId: finance.id, paymentId: consumed.payment.id, reason: "Finance cannot initiate a customer refund." }, provider),
      PaymentAuthorizationError,
    );
    await assert.rejects(
      reconcilePaymentOperation({ actorUserId: analyst.id, paymentId: consumed.payment.id }, provider),
      PaymentAuthorizationError,
    );
    await assert.rejects(
      requestPaymentRefund({ actorUserId: workspaceOwner.id, paymentId: consumed.payment.id, reason: "Workspace role does not grant platform refund access." }, provider),
      PaymentAuthorizationError,
    );

    const unavailableProvider = new RefundProvider();
    unavailableProvider.failCreate = true;
    const failedRequestPayment = await createSucceededPayment({
      workspaceId: subscriptionWorkspace.id,
      actorUserId: workspaceOwner.id,
      purpose: "SUBSCRIPTION_INITIAL",
      amount: "3.0000",
    });
    await assert.rejects(
      requestPaymentRefund({ actorUserId: operator.id, paymentId: failedRequestPayment.id, reason: "Provider unavailable test refund request." }, unavailableProvider),
      PaymentProviderError,
    );
    const needsAttention = await db.paymentRefund.findFirstOrThrow({ where: { paymentId: failedRequestPayment.id } });
    assert.equal(needsAttention.status, "NEEDS_ATTENTION");
    assert.equal(needsAttention.active, true);
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: failedRequestPayment.id } })).reconciliationStatus, "REQUIRED");
  } finally {
    const paymentReferences = paymentIds.length ? await db.payment.findMany({ where: { id: { in: paymentIds } }, select: { internalReference: true } }) : [];
    const refunds = paymentIds.length ? await db.paymentRefund.findMany({ where: { paymentId: { in: paymentIds } }, select: { id: true } }) : [];
    const resourceIds = [...paymentIds, ...refunds.map(({ id }) => id)];
    if (workspaceIds.length) await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    if (resourceIds.length || userIds.length) await db.platformAuditEvent.deleteMany({ where: { OR: [{ resourceId: { in: resourceIds } }, { actorUserId: { in: userIds } }] } });
    if (workspaceIds.length) await db.documentCreditTransaction.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    if (paymentReferences.length) await db.paymentProviderEvent.deleteMany({ where: { providerReference: { in: paymentReferences.map(({ internalReference }) => internalReference) } } });
    if (paymentIds.length) await db.paymentRefund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    if (paymentIds.length) await db.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } });
    if (paymentIds.length) await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
    if (purchaseIds.length) await db.documentCreditPurchase.deleteMany({ where: { id: { in: purchaseIds } } });
    if (workspaceIds.length) {
      await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (packIds.length) await db.documentCreditPack.deleteMany({ where: { id: { in: packIds } } });
    if (userIds.length) {
      await db.platformMembership.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
});
