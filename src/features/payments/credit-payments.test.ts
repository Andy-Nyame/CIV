import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { getPurchasedCreditBalance } from "@/features/commercial/ledger";
import { db } from "@/lib/db";

import {
  fulfillDocumentCreditPurchase,
  initializeDocumentCreditPurchase,
} from "./credit-purchases";
import {
  DocumentCreditPaymentError,
  PaymentNotFoundError,
  PaymentProviderError,
  PaymentVerificationError,
} from "./errors";
import type {
  InitializeProviderPaymentInput,
  ParsedProviderEvent,
  PaymentProviderClient,
  VerifiedProviderPayment,
} from "./provider";
import { createInternalPaymentReference } from "./reference";
import { verifyPaymentByReference } from "./service";
import { processPaystackWebhook } from "./webhook";

class CreditPaymentProvider implements PaymentProviderClient {
  readonly provider = "PAYSTACK" as const;
  initializedInputs: InitializeProviderPaymentInput[] = [];
  verification: VerifiedProviderPayment | null = null;
  event: ParsedProviderEvent | null = null;
  failInitialization = false;
  verifyCalls = 0;

  async initializePayment(input: InitializeProviderPaymentInput) {
    this.initializedInputs.push(input);
    if (this.failInitialization) throw new PaymentProviderError();
    return {
      authorizationUrl: `https://checkout.paystack.com/${input.reference}`,
      accessCode: `access-${input.reference}`,
      reference: input.reference,
    };
  }

  async verifyPayment(reference: string) {
    this.verifyCalls += 1;
    if (!this.verification) throw new PaymentProviderError();
    return { ...this.verification, reference };
  }

  validateWebhook(_rawBody: Uint8Array, signature: string | null) {
    return signature === "valid-credit-signature";
  }

  parseWebhookEvent() {
    if (!this.event) throw new PaymentProviderError();
    return this.event;
  }
}

function verification(input: {
  reference: string;
  email: string;
  status?: string;
  amountMinor?: number;
  currency?: string;
  channel?: string;
}): VerifiedProviderPayment {
  return {
    transactionId: randomUUID(),
    domain: "test",
    status: input.status ?? "success",
    reference: input.reference,
    amountMinor: input.amountMinor ?? 100,
    currency: input.currency ?? "GHS",
    customerEmail: input.email,
    channel: input.channel ?? "card",
    gatewayResponse: input.status === "pending" ? "Pending" : "Successful",
    paidAt: input.status === "pending" ? null : new Date().toISOString(),
  };
}

test("paid document-credit checkout, async verification, fulfillment, retries, and races are authoritative", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const packIds: string[] = [];

  async function user(role: string) {
    const created = await db.user.create({
      data: {
        name: `Credit payment ${role}`,
        email: `civ-credit-payment-${role}-${suffix}@example.invalid`,
      },
      select: { id: true, email: true },
    });
    userIds.push(created.id);
    return created;
  }

  try {
    const [owner, admin, manager, staff, otherOwner] = await Promise.all([
      user("owner"),
      user("admin"),
      user("manager"),
      user("staff"),
      user("other-owner"),
    ]);
    const free = await db.plan.findUniqueOrThrow({
      where: { code: "FREE" },
      select: { id: true },
    });
    const workspace = await db.workspace.create({
      data: {
        name: `Credit payment workspace ${suffix}`,
        type: "BUSINESS",
        memberships: {
          create: [
            { userId: owner.id, role: "OWNER", status: "ACTIVE" },
            { userId: admin.id, role: "ADMIN", status: "ACTIVE" },
            { userId: manager.id, role: "MANAGER", status: "ACTIVE" },
            { userId: staff.id, role: "STAFF", status: "ACTIVE" },
          ],
        },
        subscription: { create: { planId: free.id, status: "BETA" } },
      },
      select: { id: true },
    });
    workspaceIds.push(workspace.id);
    const otherWorkspace = await db.workspace.create({
      data: {
        name: `Other credit payment workspace ${suffix}`,
        type: "BUSINESS",
        memberships: {
          create: { userId: otherOwner.id, role: "OWNER", status: "ACTIVE" },
        },
        subscription: { create: { planId: free.id, status: "BETA" } },
      },
      select: { id: true },
    });
    workspaceIds.push(otherWorkspace.id);
    const pack = await db.documentCreditPack.create({
      data: {
        code: `TEST_CREDITS_${suffix.replaceAll("-", "").slice(0, 16).toUpperCase()}`,
        name: "Temporary Paystack Test Credits",
        description: "Admin D.2 isolated fixture",
        creditAmount: 100,
        price: "1.0000",
        currency: "GHS",
        isActive: true,
        isPublic: true,
        sortOrder: 99999,
      },
    });
    packIds.push(pack.id);

    for (const unauthorized of [admin, manager, staff]) {
      await assert.rejects(
        initializeDocumentCreditPurchase(
          {
            actorUserId: unauthorized.id,
            workspaceId: workspace.id,
            email: unauthorized.email!,
            packCode: pack.code,
          },
          new CreditPaymentProvider(),
        ),
        WorkspaceAuthorizationError,
      );
    }
    await assert.rejects(
      initializeDocumentCreditPurchase(
        {
          actorUserId: otherOwner.id,
          workspaceId: workspace.id,
          email: otherOwner.email!,
          packCode: pack.code,
        },
        new CreditPaymentProvider(),
      ),
      WorkspaceAuthorizationError,
    );

    const provider = new CreditPaymentProvider();
    const initialized = await initializeDocumentCreditPurchase(
      {
        actorUserId: owner.id,
        workspaceId: workspace.id,
        email: owner.email!,
        packCode: pack.code,
      },
      provider,
    );
    assert.equal(initialized.kind, "INITIALIZED");
    if (initialized.kind !== "INITIALIZED") throw new Error("Checkout missing");
    assert.equal(provider.initializedInputs[0].amountMinor, 100);
    assert.deepEqual(provider.initializedInputs[0].channels, ["card", "mobile_money"]);
    assert.equal(provider.initializedInputs[0].metadata.packCode, pack.code);

    const pendingPurchase = await db.documentCreditPurchase.findUniqueOrThrow({
      where: { id: initialized.purchaseId },
      include: { payments: { include: { attempts: true } } },
    });
    assert.equal(pendingPurchase.status, "PENDING");
    assert.equal(pendingPurchase.creditAmountSnapshot, 100);
    assert.equal(pendingPurchase.priceSnapshot.toString(), "1");
    assert.equal(pendingPurchase.payments.length, 1);
    assert.equal(pendingPurchase.payments[0].purpose, "DOCUMENT_CREDITS");
    assert.equal(pendingPurchase.payments[0].status, "PROCESSING");
    assert.equal(pendingPurchase.payments[0].attempts.length, 1);

    provider.verification = verification({
      reference: initialized.reference,
      email: owner.email!,
      status: "pending",
      channel: "mobile_money",
    });
    assert.equal(
      (await verifyPaymentByReference(initialized.reference, { provider })).status,
      "PROCESSING",
    );
    assert.equal(
      (await db.documentCreditPurchase.findUniqueOrThrow({
        where: { id: initialized.purchaseId },
      })).status,
      "PENDING",
    );
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 0);

    provider.verification = verification({
      reference: initialized.reference,
      email: owner.email!,
      channel: "mobile_money",
    });
    const verified = await verifyPaymentByReference(initialized.reference, { provider });
    assert.equal(verified.status, "SUCCEEDED");
    assert.equal(verified.fulfillment?.credits, 100);
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 100);
    assert.equal(
      await db.documentCreditTransaction.count({
        where: { purchaseId: initialized.purchaseId, type: "PURCHASE" },
      }),
      1,
    );
    assert.equal(
      (await db.documentCreditPurchase.findUniqueOrThrow({
        where: { id: initialized.purchaseId },
      })).status,
      "COMPLETED",
    );
    assert.equal(
      await db.auditEvent.count({
        where: {
          workspaceId: workspace.id,
          action: "DOCUMENT_CREDITS_ACQUIRED",
          resourceId: initialized.purchaseId,
        },
      }),
      1,
    );

    const payment = await db.payment.findUniqueOrThrow({
      where: { internalReference: initialized.reference },
    });
    const fulfillmentRace = await Promise.all(
      Array.from({ length: 4 }, () => fulfillDocumentCreditPurchase(payment.id)),
    );
    assert.ok(fulfillmentRace.every((result) => result.credits === 100));
    assert.equal(
      await db.documentCreditTransaction.count({
        where: { purchaseId: initialized.purchaseId },
      }),
      1,
    );

    provider.event = {
      eventType: "charge.success",
      eventIdentifier: "credit-event-one",
      providerReference: initialized.reference,
      safeData: {
        transactionId: "credit-event-one",
        status: "success",
        amountMinor: 100,
        currency: "GHS",
      },
    };
    const raw = Buffer.from("credit-success-event-one");
    await Promise.all([
      processPaystackWebhook(raw, "valid-credit-signature", provider),
      processPaystackWebhook(raw, "valid-credit-signature", provider),
      verifyPaymentByReference(initialized.reference, { provider }),
    ]);
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 100);
    assert.equal(
      await db.paymentProviderEvent.count({
        where: { providerReference: initialized.reference },
      }),
      1,
    );

    const failedProvider = new CreditPaymentProvider();
    failedProvider.failInitialization = true;
    await assert.rejects(
      initializeDocumentCreditPurchase(
        {
          actorUserId: owner.id,
          workspaceId: workspace.id,
          email: owner.email!,
          packCode: pack.code,
        },
        failedProvider,
      ),
      PaymentProviderError,
    );
    const failedPurchase = await db.documentCreditPurchase.findFirstOrThrow({
      where: {
        workspaceId: workspace.id,
        packId: pack.id,
        betaAcquisition: false,
        status: "FAILED",
      },
      orderBy: { createdAt: "desc" },
    });
    const retryProvider = new CreditPaymentProvider();
    const retried = await initializeDocumentCreditPurchase(
      {
        actorUserId: owner.id,
        workspaceId: workspace.id,
        email: owner.email!,
        purchaseId: failedPurchase.id,
      },
      retryProvider,
    );
    assert.equal(retried.kind, "INITIALIZED");
    if (retried.kind !== "INITIALIZED") throw new Error("Retry missing");
    assert.equal(retried.purchaseId, failedPurchase.id);
    assert.equal(
      await db.payment.count({
        where: { documentCreditPurchaseId: failedPurchase.id },
      }),
      2,
    );
    retryProvider.verification = verification({
      reference: retried.reference,
      email: owner.email!,
    });
    await verifyPaymentByReference(retried.reference, { provider: retryProvider });
    assert.equal(
      await db.documentCreditTransaction.count({ where: { purchaseId: failedPurchase.id } }),
      1,
    );
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 200);

    const mismatchProvider = new CreditPaymentProvider();
    const mismatch = await initializeDocumentCreditPurchase(
      {
        actorUserId: owner.id,
        workspaceId: workspace.id,
        email: owner.email!,
        packCode: pack.code,
      },
      mismatchProvider,
    );
    assert.equal(mismatch.kind, "INITIALIZED");
    if (mismatch.kind !== "INITIALIZED") throw new Error("Mismatch checkout missing");
    mismatchProvider.verification = verification({
      reference: mismatch.reference,
      email: owner.email!,
      amountMinor: 101,
    });
    await assert.rejects(
      verifyPaymentByReference(mismatch.reference, { provider: mismatchProvider }),
      PaymentVerificationError,
    );
    mismatchProvider.verification = verification({
      reference: mismatch.reference,
      email: owner.email!,
      currency: "NGN",
    });
    await assert.rejects(
      verifyPaymentByReference(mismatch.reference, { provider: mismatchProvider }),
      PaymentVerificationError,
    );
    await assert.rejects(
      verifyPaymentByReference(createInternalPaymentReference(), {
        provider: mismatchProvider,
      }),
      PaymentNotFoundError,
    );
    assert.equal(
      await db.documentCreditTransaction.count({ where: { purchaseId: mismatch.purchaseId } }),
      0,
    );

    mismatchProvider.event = {
      eventType: "charge.success",
      eventIdentifier: "invalid-signature-event",
      providerReference: mismatch.reference,
      safeData: { transactionId: "invalid", status: "success", amountMinor: 100, currency: "GHS" },
    };
    assert.deepEqual(
      await processPaystackWebhook(Buffer.from("invalid-signature"), "invalid", mismatchProvider),
      { accepted: false, status: 401 },
    );
    assert.equal(
      await db.documentCreditTransaction.count({ where: { purchaseId: mismatch.purchaseId } }),
      0,
    );

    await assert.rejects(
      initializeDocumentCreditPurchase(
        {
          actorUserId: otherOwner.id,
          workspaceId: otherWorkspace.id,
          email: otherOwner.email!,
          purchaseId: mismatch.purchaseId,
        },
        new CreditPaymentProvider(),
      ),
      DocumentCreditPaymentError,
    );
  } finally {
    if (workspaceIds.length) {
      const references = await db.payment.findMany({
        where: { workspaceId: { in: workspaceIds } },
        select: { internalReference: true },
      });
      await db.paymentProviderEvent.deleteMany({
        where: {
          providerReference: { in: references.map(({ internalReference }) => internalReference) },
        },
      });
      await db.paymentAttempt.deleteMany({
        where: { payment: { workspaceId: { in: workspaceIds } } },
      });
      await db.payment.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentCreditTransaction.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.documentCreditPurchase.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.workspaceDocumentAllowancePeriod.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.subscription.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (packIds.length) {
      await db.documentCreditPack.deleteMany({ where: { id: { in: packIds } } });
    }
    if (userIds.length) {
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
});
