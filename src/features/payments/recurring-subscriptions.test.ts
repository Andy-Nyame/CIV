import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { addUtcMonth } from "@/features/commercial/periods";
import { getPurchasedCreditBalance } from "@/features/commercial/ledger";
import { db } from "@/lib/db";
import { getWorkspaceEntitlements } from "@/features/trials/entitlements";

import { SubscriptionPaymentError } from "./errors";
import type {
  DisableProviderSubscriptionInput,
  InitializeProviderPaymentInput,
  ParsedProviderEvent,
  PaymentProviderClient,
  VerifiedProviderPayment,
} from "./provider";
import {
  cancelRecurringSubscription,
  fulfillRecurringSubscriptionPayment,
  initializeRecurringSubscription,
} from "./recurring-subscriptions";
import { verifyPaymentByReference } from "./service";
import { processPaystackWebhook } from "./webhook";

class RecurringProvider implements PaymentProviderClient {
  readonly provider = "PAYSTACK" as const;
  initialized: InitializeProviderPaymentInput[] = [];
  disabled: DisableProviderSubscriptionInput[] = [];
  verification: VerifiedProviderPayment | null = null;
  event: ParsedProviderEvent | null = null;

  async initializePayment(input: InitializeProviderPaymentInput) {
    this.initialized.push(input);
    return {
      authorizationUrl: `https://checkout.paystack.com/${input.reference}`,
      accessCode: `access-${input.reference}`,
      reference: input.reference,
    };
  }

  async verifyPayment(reference: string) {
    if (!this.verification) throw new Error("Missing verification fixture");
    return { ...this.verification, reference };
  }

  async disableSubscription(input: DisableProviderSubscriptionInput) {
    this.disabled.push(input);
  }

  validateWebhook(_rawBody: Uint8Array, signature: string | null) {
    return signature === "valid-recurring-signature";
  }

  parseWebhookEvent() {
    if (!this.event) throw new Error("Missing event fixture");
    return this.event;
  }
}

test("recurring checkout, activation, renewal, failure, cancellation, and isolation are authoritative", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const subscriptionIds: string[] = [];
  const platformResourceIds: string[] = [];
  let providerSubscriptionCode: string | null = null;
  const originalBusiness = await db.plan.findUniqueOrThrow({
    where: { code: "BUSINESS" },
  });
  const [free, business] = await Promise.all([
    db.plan.findUniqueOrThrow({ where: { code: "FREE" } }),
    db.plan.update({
      where: { code: "BUSINESS" },
      data: {
        billingMode: "RECURRING",
        monthlyPrice: "1.0000",
        currency: "GHS",
        paystackPlanCode: `PLN_TEST${suffix.replaceAll("-", "").slice(0, 20)}`,
        isActive: true,
        isPublic: true,
        isAvailableForNewWorkspaces: true,
      },
    }),
  ]);

  async function createUser(role: string) {
    const user = await db.user.create({
      data: {
        name: `Recurring ${role}`,
        email: `recurring-${role}-${suffix}@example.invalid`,
      },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    return user;
  }

  try {
    const [owner, admin, manager, staff, otherOwner] = await Promise.all([
      createUser("owner"),
      createUser("admin"),
      createUser("manager"),
      createUser("staff"),
      createUser("other-owner"),
    ]);
    const periodStart = new Date(Date.now() - 60_000);
    const workspace = await db.workspace.create({
      data: {
        name: `Recurring workspace ${suffix}`,
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
        documentAllowancePeriods: {
          create: {
            planId: free.id,
            periodStart,
            periodEnd: addUtcMonth(periodStart),
            allowance: free.documentLimit,
          },
        },
      },
      include: { subscription: true },
    });
    workspaceIds.push(workspace.id);
    subscriptionIds.push(workspace.subscription!.id);
    platformResourceIds.push(workspace.subscription!.id);
    const otherWorkspace = await db.workspace.create({
      data: {
        name: `Other recurring workspace ${suffix}`,
        type: "BUSINESS",
        memberships: {
          create: { userId: otherOwner.id, role: "OWNER", status: "ACTIVE" },
        },
        subscription: { create: { planId: free.id, status: "BETA" } },
      },
      include: { subscription: true },
    });
    workspaceIds.push(otherWorkspace.id);
    subscriptionIds.push(otherWorkspace.subscription!.id);
    platformResourceIds.push(otherWorkspace.subscription!.id);
    await db.platformMembership.create({
      data: { userId: otherOwner.id, role: "PLATFORM_ADMIN", status: "ACTIVE" },
    });
    await db.documentCreditTransaction.create({
      data: {
        workspaceId: workspace.id,
        type: "BONUS",
        amount: 73,
        source: "D3_TEST",
        sourceReference: `d3-credits-${suffix}`,
      },
    });
    const now = new Date();
    const trial = await db.workspaceTrial.create({
      data: {
        workspaceId: workspace.id,
        trialPlanId: business.id,
        fallbackPlanId: free.id,
        startsAt: now,
        endsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        grantSource: "PLATFORM_MANUAL",
        trialPlanCodeSnapshot: business.code,
        trialPlanNameSnapshot: business.name,
        trialMemberLimitSnapshot: business.memberLimit,
        trialDocumentLimitSnapshot: business.documentLimit,
        fallbackPlanCodeSnapshot: free.code,
        fallbackPlanNameSnapshot: free.name,
      },
    });
    platformResourceIds.push(trial.id);

    for (const actor of [admin, manager, staff, otherOwner]) {
      await assert.rejects(
        initializeRecurringSubscription(
          {
            actorUserId: actor.id,
            workspaceId: workspace.id,
            email: actor.email!,
            planCode: business.code,
          },
          new RecurringProvider(),
        ),
        WorkspaceAuthorizationError,
      );
    }

    const provider = new RecurringProvider();
    const initialized = await initializeRecurringSubscription(
      {
        actorUserId: owner.id,
        workspaceId: workspace.id,
        email: owner.email!,
        planCode: business.code,
      },
      provider,
    );
    assert.equal(initialized.kind, "INITIALIZED");
    if (initialized.kind !== "INITIALIZED") throw new Error("Missing checkout");
    assert.deepEqual(provider.initialized[0].channels, ["card"]);
    assert.equal(provider.initialized[0].planCode, business.paystackPlanCode);
    assert.equal(provider.initialized[0].amountMinor, 100);
    assert.equal(
      (await db.subscription.findUniqueOrThrow({ where: { workspaceId: workspace.id } })).planId,
      free.id,
      "browser checkout initialization cannot activate a plan",
    );

    provider.verification = {
      transactionId: `tx-${suffix}`,
      domain: "test",
      status: "success",
      reference: initialized.reference,
      amountMinor: 100,
      currency: "GHS",
      customerEmail: owner.email,
      channel: "mobile_money",
      gatewayResponse: "Successful",
      paidAt: new Date().toISOString(),
      planCode: business.paystackPlanCode,
      customerCode: `CUS_${suffix.replaceAll("-", "").slice(0, 18)}`,
    };
    await assert.rejects(
      verifyPaymentByReference(initialized.reference, { provider }),
    );
    assert.equal(
      (await db.subscription.findUniqueOrThrow({ where: { workspaceId: workspace.id } })).planId,
      free.id,
    );
    provider.verification.channel = "card";
    provider.verification.planCode = "PLN_WRONG";
    await assert.rejects(
      verifyPaymentByReference(initialized.reference, { provider }),
    );
    provider.verification.planCode = business.paystackPlanCode;
    const verified = await verifyPaymentByReference(initialized.reference, { provider });
    assert.equal(verified.status, "SUCCEEDED");
    assert.equal(verified.fulfillment?.kind, "SUBSCRIPTION");
    const payment = await db.payment.findUniqueOrThrow({
      where: { internalReference: initialized.reference },
    });
    await Promise.all(
      Array.from({ length: 4 }, () => fulfillRecurringSubscriptionPayment(payment.id)),
    );
    const active = await db.subscription.findUniqueOrThrow({
      where: { workspaceId: workspace.id },
    });
    assert.equal(active.planId, business.id);
    assert.equal(active.status, "ACTIVE");
    assert.equal(await db.subscriptionBillingPeriod.count({ where: { subscriptionId: active.id } }), 1);
    assert.equal((await db.workspaceTrial.findUniqueOrThrow({ where: { id: trial.id } })).status, "CONVERTED");
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 73);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: workspace.id, action: "SUBSCRIPTION_STARTED" } }), 1);

    const subscriptionCode = `SUB_${suffix.replaceAll("-", "").slice(0, 18)}`;
    providerSubscriptionCode = subscriptionCode;
    const cancellationToken = `token${suffix.replaceAll("-", "")}`;
    provider.event = {
      eventType: "subscription.create",
      eventIdentifier: `subscription.create:${subscriptionCode}`,
      providerReference: null,
      safeData: {
        subscriptionCode,
        planCode: business.paystackPlanCode!,
        customerCode: provider.verification.customerCode!,
        customerEmail: owner.email!,
        subscriptionStatus: "active",
        nextPaymentDate: active.currentPeriodEnd!.toISOString(),
      },
    };
    const subscriptionRaw = Buffer.from(`subscription-created-${suffix}`);
    await processPaystackWebhook(subscriptionRaw, "valid-recurring-signature", provider);
    const connected = await db.subscription.findUniqueOrThrow({ where: { id: active.id } });
    assert.equal(connected.providerSubscriptionCode, subscriptionCode);
    const storedSubscriptionEvent = await db.paymentProviderEvent.findFirstOrThrow({
      where: { eventType: "subscription.create", safeData: { path: ["subscriptionCode"], equals: subscriptionCode } },
    });
    assert.equal(JSON.stringify(storedSubscriptionEvent.safeData).includes(cancellationToken), false);

    const renewalStart = connected.currentPeriodEnd!;
    const renewalEnd = addUtcMonth(renewalStart);
    provider.event = {
      eventType: "invoice.update",
      eventIdentifier: `invoice.update:INV_${suffix}:success:paid:renew-${suffix}`,
      providerReference: `renew-${suffix}`,
      safeData: {
        invoiceCode: `INV_${suffix.replaceAll("-", "").slice(0, 18)}`,
        subscriptionCode,
        amountMinor: 100,
        currency: "GHS",
        periodStart: renewalStart.toISOString(),
        periodEnd: renewalEnd.toISOString(),
        invoiceStatus: "success",
        paid: true,
        paidAt: renewalStart.toISOString(),
        nextPaymentDate: renewalEnd.toISOString(),
        transactionReference: `renew-${suffix}`,
      },
    };
    const renewalRaw = Buffer.from(`renewal-${suffix}`);
    await Promise.all([
      processPaystackWebhook(renewalRaw, "valid-recurring-signature", provider),
      processPaystackWebhook(renewalRaw, "valid-recurring-signature", provider),
    ]);
    assert.equal(await db.payment.count({ where: { workspaceId: workspace.id, purpose: "SUBSCRIPTION_RENEWAL" } }), 1);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: workspace.id, action: "SUBSCRIPTION_RENEWED" } }), 1);
    assert.equal(await db.workspaceDocumentAllowancePeriod.count({ where: { workspaceId: workspace.id, periodStart: renewalStart } }), 1);

    const failedStart = renewalEnd;
    provider.event = {
      eventType: "invoice.payment_failed",
      eventIdentifier: `invoice.payment_failed:INV_FAIL_${suffix}`,
      providerReference: null,
      safeData: {
        invoiceCode: `INV_FAIL_${suffix.replaceAll("-", "").slice(0, 14)}`,
        subscriptionCode,
        amountMinor: 100,
        currency: "GHS",
        periodStart: failedStart.toISOString(),
        periodEnd: addUtcMonth(failedStart).toISOString(),
        invoiceStatus: "failed",
        paid: false,
        paidAt: null,
        nextPaymentDate: null,
        transactionReference: null,
      },
    };
    await processPaystackWebhook(Buffer.from(`failed-${suffix}`), "valid-recurring-signature", provider);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: active.id } })).status, "PAST_DUE");
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: active.id } })).planId, business.id);

    await db.subscription.update({
      where: { id: active.id },
      data: { status: "ACTIVE", currentPeriodEnd: renewalEnd, nextPaymentAt: renewalEnd },
    });
    const cancellation = await cancelRecurringSubscription(
      { actorUserId: owner.id, workspaceId: workspace.id },
      provider,
    );
    assert.equal(cancellation.idempotent, false);
    const repeatedCancellation = await cancelRecurringSubscription(
      { actorUserId: owner.id, workspaceId: workspace.id },
      provider,
    );
    assert.equal(repeatedCancellation.idempotent, true);
    assert.equal(provider.disabled.length, 1);
    assert.equal(provider.disabled[0].subscriptionCode, subscriptionCode);
    provider.event = {
      eventType: "subscription.disable",
      eventIdentifier: `subscription.disable:${subscriptionCode}`,
      providerReference: null,
      safeData: { subscriptionCode },
    };
    await processPaystackWebhook(Buffer.from(`disabled-${suffix}`), "valid-recurring-signature", provider);
    const beforePeriodEnd = await db.subscription.findUniqueOrThrow({ where: { id: active.id } });
    assert.equal(beforePeriodEnd.status, "ACTIVE");
    assert.equal(beforePeriodEnd.planId, business.id);
    await getWorkspaceEntitlements(workspace.id, {
      now: new Date(renewalEnd.getTime() + 1),
    });
    const cancelled = await db.subscription.findUniqueOrThrow({ where: { id: active.id } });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.planId, free.id);
    assert.equal(await getPurchasedCreditBalance(db, workspace.id), 73);
    assert.equal(await db.workspace.count({ where: { id: workspace.id } }), 1);

    await assert.rejects(
      initializeRecurringSubscription(
        { actorUserId: owner.id, workspaceId: workspace.id, email: owner.email!, planCode: "FREE" },
        provider,
      ),
      (error) => error instanceof SubscriptionPaymentError && error.reason === "PLAN_NOT_RECURRING",
    );
  } finally {
    const paymentReferences = await db.payment.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { internalReference: true, providerReference: true },
    });
    await db.paymentProviderEvent.deleteMany({
      where: {
        OR: [
          { providerReference: { in: paymentReferences.flatMap((item) => [item.internalReference, item.providerReference].filter((value): value is string => Boolean(value))) } },
          ...(providerSubscriptionCode
            ? [{ safeData: { path: ["subscriptionCode"], equals: providerSubscriptionCode } }]
            : []),
        ],
      },
    });
    await db.paymentAttempt.deleteMany({ where: { payment: { workspaceId: { in: workspaceIds } } } });
    await db.payment.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.subscriptionBillingPeriod.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
    await db.subscriptionChange.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.platformAuditEvent.deleteMany({ where: { resourceId: { in: platformResourceIds } } });
    await db.workspaceTrial.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.documentCreditTransaction.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await db.platformMembership.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.plan.update({
      where: { id: originalBusiness.id },
      data: {
        billingMode: originalBusiness.billingMode,
        monthlyPrice: originalBusiness.monthlyPrice,
        currency: originalBusiness.currency,
        paystackPlanCode: originalBusiness.paystackPlanCode,
        isActive: originalBusiness.isActive,
        isPublic: originalBusiness.isPublic,
        isAvailableForNewWorkspaces: originalBusiness.isAvailableForNewWorkspaces,
      },
    });
  }
});
