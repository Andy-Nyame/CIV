import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";

import { db } from "@/lib/db";

import { readPaystackConfig } from "./config";
import { minorUnitsToDecimalString, toMinorUnits } from "./currency";
import {
  PaymentConfigurationError,
  PaymentProviderError,
  PaymentVerificationError,
} from "./errors";
import { PaystackPaymentProvider } from "./paystack";
import type {
  InitializeProviderPaymentInput,
  ParsedProviderEvent,
  PaymentProviderClient,
  VerifiedProviderPayment,
} from "./provider";
import { createInternalPaymentReference, createInternalRefundReference } from "./reference";
import {
  initializeBillingTestPayment,
  verifyPaymentByReference,
} from "./service";
import { processPaystackWebhook } from "./webhook";

const fakeEnvironment = {
  APP_ENV: "development",
  APP_URL: "http://localhost:3000",
  PAYSTACK_PUBLIC_KEY: "pk_test_example_public",
  PAYSTACK_SECRET_KEY: "sk_test_example_secret",
  PAYSTACK_MODE: "test",
  PAYSTACK_BASE_URL: "https://api.paystack.co",
};

class MockProvider implements PaymentProviderClient {
  readonly provider = "PAYSTACK" as const;
  verifyCalls = 0;
  initializedInput: InitializeProviderPaymentInput | null = null;
  verification: VerifiedProviderPayment | null = null;
  event: ParsedProviderEvent | null = null;
  failInitialization = false;

  async initializePayment(input: InitializeProviderPaymentInput) {
    this.initializedInput = input;
    if (this.failInitialization) throw new PaymentProviderError();
    return {
      authorizationUrl: "https://checkout.paystack.com/test-access",
      accessCode: "test-access",
      reference: input.reference,
    };
  }

  async verifyPayment(reference: string) {
    this.verifyCalls += 1;
    if (!this.verification) throw new PaymentProviderError();
    return { ...this.verification, reference };
  }

  validateWebhook(_rawBody: Uint8Array, signature: string | null) {
    return signature === "valid-test-signature";
  }

  parseWebhookEvent() {
    if (!this.event) throw new Error("Missing test event");
    return this.event;
  }
}

test("configuration enforces test-only keys, official base URL, and safe app origin", () => {
  assert.equal(readPaystackConfig(fakeEnvironment).mode, "test");
  for (const invalid of [
    { ...fakeEnvironment, PAYSTACK_SECRET_KEY: undefined },
    { ...fakeEnvironment, PAYSTACK_MODE: "live" },
    { ...fakeEnvironment, PAYSTACK_SECRET_KEY: "sk_live_forbidden" },
    { ...fakeEnvironment, PAYSTACK_PUBLIC_KEY: "pk_live_forbidden" },
    { ...fakeEnvironment, PAYSTACK_BASE_URL: "https://example.com" },
    { ...fakeEnvironment, APP_URL: "http://public.example.com" },
  ]) {
    assert.throws(() => readPaystackConfig(invalid), PaymentConfigurationError);
  }
});

test("the retained infrastructure checkout service rejects non-development or non-test environments", async () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalPaystackMode = process.env.PAYSTACK_MODE;
  try {
    process.env.APP_ENV = "production";
    process.env.PAYSTACK_MODE = "test";
    await assert.rejects(
      initializeBillingTestPayment({
        actorUserId: randomUUID(),
        workspaceId: randomUUID(),
        email: "billing@example.invalid",
      }, new MockProvider()),
      PaymentConfigurationError,
    );

    process.env.APP_ENV = "development";
    process.env.PAYSTACK_MODE = "live";
    await assert.rejects(
      initializeBillingTestPayment({
        actorUserId: randomUUID(),
        workspaceId: randomUUID(),
        email: "billing@example.invalid",
      }, new MockProvider()),
      PaymentConfigurationError,
    );
  } finally {
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
    if (originalPaystackMode === undefined) delete process.env.PAYSTACK_MODE;
    else process.env.PAYSTACK_MODE = originalPaystackMode;
  }
});

test("GHS Decimal conversion never uses floating point", () => {
  assert.equal(toMinorUnits("10.00", "GHS"), 1000);
  assert.equal(toMinorUnits("0.01", "GHS"), 1);
  assert.equal(minorUnitsToDecimalString(1000, "GHS"), "10.00");
  assert.throws(() => toMinorUnits("10.001", "GHS"));
  assert.throws(() => toMinorUnits("0", "GHS"));
});

test("CIV references are provider-safe, unique, and unpredictable", () => {
  const references = new Set(Array.from({ length: 100 }, createInternalPaymentReference));
  assert.equal(references.size, 100);
  for (const reference of references) assert.match(reference, /^CIV-PAY-[A-F0-9]{32}$/);
  assert.match(createInternalRefundReference(), /^CIV-REF-[A-F0-9]{32}$/);
});

test("Paystack refund client uses trusted minor units and parses asynchronous states", async () => {
  const reference = createInternalPaymentReference();
  let requestBody: Record<string, unknown> = {};
  const provider = new PaystackPaymentProvider(async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      status: true,
      data: {
        id: 72,
        refund_reference: "RFD_TEST72",
        status: "pending",
        amount: 100,
        currency: "GHS",
        domain: "test",
        expected_at: "2026-08-25T12:00:00.000Z",
        refunded_at: null,
        transaction: { id: 9001, reference },
      },
    });
  }, fakeEnvironment);
  const refund = await provider.createRefund({
    transactionReference: reference,
    amountMinor: 100,
    currency: "GHS",
    customerNote: "Approved refund",
    merchantNote: createInternalRefundReference(),
  });
  assert.equal(requestBody.transaction, reference);
  assert.equal(requestBody.amount, 100);
  assert.equal(refund.status, "pending");
  assert.equal(refund.providerRefundId, "72");
  assert.equal(refund.providerRefundReference, "RFD_TEST72");

  const fetchProvider = new PaystackPaymentProvider(async () => Response.json({
    status: true,
    data: {
      id: 72,
      refund_reference: "RFD_TEST72",
      status: "processed",
      amount: 100,
      currency: "GHS",
      domain: "test",
      expected_at: "2026-08-25T12:00:00.000Z",
      refunded_at: "2026-08-25T12:01:00.000Z",
      transaction: 9001,
    },
  }), fakeEnvironment);
  const fetchedRefund = await fetchProvider.fetchRefund("72");
  assert.equal(fetchedRefund.transactionReference, null);
  assert.equal(fetchedRefund.transactionIdentifier, "9001");
  assert.equal(fetchedRefund.status, "processed");

  const event = provider.parseWebhookEvent(Buffer.from(JSON.stringify({
    event: "refund.processed",
    data: {
      id: 72,
      refund_reference: "RFD_TEST72",
      transaction_reference: reference,
      status: "processed",
      amount: "100",
      currency: "GHS",
      domain: "test",
      customer_note: "must not be retained",
    },
  })));
  assert.equal(event.providerReference, reference);
  assert.equal(event.safeData.refundStatus, "processed");
  assert.equal(JSON.stringify(event.safeData).includes("customer_note"), false);
});

test("Paystack client sends trusted minor units and validates response/reference", async () => {
  let authorization = "";
  let requestBody: Record<string, unknown> = {};
  const reference = createInternalPaymentReference();
  const provider = new PaystackPaymentProvider(async (_url, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      status: true,
      data: {
        authorization_url: "https://checkout.paystack.com/test-code",
        access_code: "test-code",
        reference,
      },
    });
  }, fakeEnvironment);
  const initialized = await provider.initializePayment({
    amountMinor: 100,
    callbackUrl: "http://localhost:3000/app/settings/billing/payment-return",
    currency: "GHS",
    email: "billing@example.invalid",
    metadata: { entitlementGrant: "false" },
    channels: ["card"],
    planCode: "PLN_TESTRECURRING",
    reference,
  });
  assert.equal(requestBody.amount, "100");
  assert.equal(requestBody.reference, reference);
  assert.deepEqual(requestBody.channels, ["card"]);
  assert.equal(requestBody.plan, "PLN_TESTRECURRING");
  assert.equal(initialized.reference, reference);
  assert.equal(authorization.startsWith("Bearer sk_test_"), true);
  assert.equal(JSON.stringify(initialized).includes("sk_test_"), false);
});

test("Paystack subscription webhook parser keeps cancellation token transient", () => {
  const provider = new PaystackPaymentProvider(fetch, fakeEnvironment);
  const event = provider.parseWebhookEvent(Buffer.from(JSON.stringify({
    event: "subscription.create",
    data: {
      subscription_code: "SUB_TESTSUBSCRIPTION",
      email_token: "secretCancellationToken",
      status: "active",
      next_payment_date: "2026-09-16T12:00:00.000Z",
      plan: { plan_code: "PLN_TESTRECURRING" },
      customer: {
        customer_code: "CUS_TESTCUSTOMER",
        email: "owner@example.invalid",
      },
    },
  })));
  assert.equal(JSON.stringify(event.safeData).includes("secretCancellationToken"), false);
});

test("Paystack verification resolves the provider plan code safely", async () => {
  const reference = createInternalPaymentReference();
  const provider = new PaystackPaymentProvider(async () => Response.json({
    status: true,
    data: {
      id: 42,
      domain: "test",
      status: "success",
      reference,
      amount: 100,
      currency: "GHS",
      channel: "card",
      gateway_response: "Successful",
      paid_at: "2026-08-16T12:00:00.000Z",
      customer: {
        email: "owner@example.invalid",
        customer_code: "CUS_TESTCUSTOMER",
      },
      plan: "123456",
      plan_object: { plan_code: "PLN_TESTRECURRING" },
    },
  }), fakeEnvironment);
  const verified = await provider.verifyPayment(reference);
  assert.equal(verified.planCode, "PLN_TESTRECURRING");
  assert.equal(verified.channel, "card");
});

test("Paystack cancellation token is fetched server-side and never returned", async () => {
  const requests: Array<{ url: string; body?: string }> = [];
  const provider = new PaystackPaymentProvider(async (url, init) => {
    requests.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
    if (String(url).endsWith("/subscription/SUB_TESTSUBSCRIPTION")) {
      return Response.json({
        status: true,
        data: {
          subscription_code: "SUB_TESTSUBSCRIPTION",
          email_token: "transientCancellationToken",
        },
      });
    }
    return Response.json({ status: true });
  }, fakeEnvironment);
  await provider.disableSubscription({ subscriptionCode: "SUB_TESTSUBSCRIPTION" });
  assert.equal(requests.length, 2);
  assert.match(requests[1].body ?? "", /transientCancellationToken/);
});

test("Paystack HMAC checks exact raw bytes and rejects modification", () => {
  const provider = new PaystackPaymentProvider(fetch, fakeEnvironment);
  const raw = Buffer.from('{"event":"charge.success","data":{"id":1}}');
  const signature = createHmac("sha512", fakeEnvironment.PAYSTACK_SECRET_KEY)
    .update(raw)
    .digest("hex");
  assert.equal(provider.validateWebhook(raw, signature), true);
  assert.equal(provider.validateWebhook(Buffer.concat([raw, Buffer.from(" ")]), signature), false);
  assert.equal(provider.validateWebhook(raw, "not-a-signature"), false);
});

test("payment initialization, verification, idempotency, webhook, and entitlement isolation", async () => {
  const suffix = randomUUID();
  let userId: string | null = null;
  let workspaceId: string | null = null;
  try {
    const freePlan = await db.plan.findUniqueOrThrow({ where: { code: "FREE" }, select: { id: true } });
    const user = await db.user.create({
      data: { name: "Payment test owner", email: `civ-payment-${suffix}@example.invalid` },
      select: { id: true, email: true },
    });
    userId = user.id;
    const workspace = await db.workspace.create({
      data: {
        name: `Payment test ${suffix}`,
        type: "BUSINESS",
        memberships: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
        subscription: { create: { planId: freePlan.id, status: "BETA" } },
      },
      select: { id: true },
    });
    workspaceId = workspace.id;
    const provider = new MockProvider();
    const initialized = await initializeBillingTestPayment({
      actorUserId: user.id,
      workspaceId: workspace.id,
      email: user.email!,
    }, provider);
    assert.equal(provider.initializedInput?.amountMinor, 100);
    const payment = await db.payment.findUniqueOrThrow({
      where: { internalReference: initialized.reference },
      include: { attempts: true },
    });
    assert.equal(payment.status, "PROCESSING");
    assert.equal(payment.purpose, "BILLING_TEST");
    assert.equal(payment.attempts.length, 1);
    assert.equal(payment.attempts[0].status, "INITIALIZED");

    provider.verification = {
      transactionId: "12345",
      domain: "test",
      status: "success",
      reference: initialized.reference,
      amountMinor: 100,
      currency: "GHS",
      customerEmail: user.email,
      channel: "card",
      gatewayResponse: "Successful",
      paidAt: new Date().toISOString(),
    };
    assert.equal((await verifyPaymentByReference(initialized.reference, { provider })).status, "SUCCEEDED");
    assert.equal((await verifyPaymentByReference(initialized.reference, { provider })).idempotent, true);
    assert.equal(provider.verifyCalls, 1);
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "SUCCEEDED");
    assert.equal(await db.documentCreditTransaction.count({ where: { workspaceId: workspace.id } }), 0);
    assert.equal(await db.documentCreditPurchase.count({ where: { workspaceId: workspace.id } }), 0);

    provider.event = {
      eventType: "charge.success",
      eventIdentifier: "12345",
      providerReference: initialized.reference,
      safeData: { transactionId: "12345", amountMinor: 100, currency: "GHS", status: "success" },
    };
    const raw = Buffer.from("test-webhook-body");
    const [firstWebhook, duplicateWebhook] = await Promise.all([
      processPaystackWebhook(raw, "valid-test-signature", provider),
      processPaystackWebhook(raw, "valid-test-signature", provider),
    ]);
    assert.equal(firstWebhook.accepted && duplicateWebhook.accepted, true);
    assert.equal(await db.paymentProviderEvent.count({ where: { providerReference: initialized.reference } }), 1);

    const mismatchProvider = new MockProvider();
    const mismatch = await initializeBillingTestPayment({
      actorUserId: user.id,
      workspaceId: workspace.id,
      email: user.email!,
    }, mismatchProvider);
    mismatchProvider.verification = { ...provider.verification!, reference: mismatch.reference, amountMinor: 101 };
    await assert.rejects(
      verifyPaymentByReference(mismatch.reference, { provider: mismatchProvider }),
      PaymentVerificationError,
    );
    assert.notEqual((await db.payment.findUniqueOrThrow({ where: { internalReference: mismatch.reference } })).status, "SUCCEEDED");

    const failedProvider = new MockProvider();
    failedProvider.failInitialization = true;
    await assert.rejects(
      initializeBillingTestPayment({ actorUserId: user.id, workspaceId: workspace.id, email: user.email! }, failedProvider),
      PaymentProviderError,
    );
    const failedAttempt = await db.paymentAttempt.findFirstOrThrow({
      where: { payment: { workspaceId: workspace.id, status: "FAILED" } },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(failedAttempt.status, "FAILED");
  } finally {
    if (workspaceId) {
      const references = await db.payment.findMany({
        where: { workspaceId },
        select: { internalReference: true },
      });
      await db.paymentProviderEvent.deleteMany({
        where: { providerReference: { in: references.map(({ internalReference }) => internalReference) } },
      });
      await db.paymentAttempt.deleteMany({ where: { payment: { workspaceId } } });
      await db.payment.deleteMany({ where: { workspaceId } });
      await db.subscription.deleteMany({ where: { workspaceId } });
      await db.membership.deleteMany({ where: { workspaceId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (userId) await db.user.deleteMany({ where: { id: userId } });
  }
});
