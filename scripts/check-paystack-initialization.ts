import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { readPaystackConfig } from "../src/features/payments/config";
import { initializeBillingTestPayment } from "../src/features/payments/service";
import { db } from "../src/lib/db";

const config = readPaystackConfig();
if (process.env.APP_ENV !== "development" || config.mode !== "test") {
  throw new Error("Paystack initialization check is development test-mode only.");
}

const suffix = randomUUID();
let userId: string | null = null;
let workspaceId: string | null = null;
let reference: string | null = null;

try {
  const free = await db.plan.findUniqueOrThrow({ where: { code: "FREE" }, select: { id: true } });
  const user = await db.user.create({
    data: {
      name: "Paystack connectivity fixture",
      email: `civ-paystack-connectivity-${suffix}@example.com`,
    },
    select: { id: true, email: true },
  });
  userId = user.id;
  const workspace = await db.workspace.create({
    data: {
      name: `Paystack connectivity ${suffix}`,
      type: "BUSINESS",
      memberships: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
      subscription: { create: { planId: free.id, status: "BETA" } },
    },
    select: { id: true },
  });
  workspaceId = workspace.id;
  const initialized = await initializeBillingTestPayment({
    actorUserId: user.id,
    workspaceId: workspace.id,
    email: user.email!,
  });
  reference = initialized.reference;
  assert.equal(new URL(initialized.authorizationUrl).hostname, "checkout.paystack.com");
  const payment = await db.payment.findUniqueOrThrow({
    where: { internalReference: initialized.reference },
    include: { attempts: true },
  });
  assert.equal(payment.status, "PROCESSING");
  assert.equal(payment.attempts.length, 1);
  assert.equal(payment.attempts[0].status, "INITIALIZED");
  assert.equal(payment.metadata && JSON.stringify(payment.metadata).includes("entitlementGrant"), true);
  console.log("PASS real Paystack Test transaction initialization; no checkout was completed and no entitlement was granted");
} finally {
  if (workspaceId) {
    if (reference) await db.paymentProviderEvent.deleteMany({ where: { providerReference: reference } });
    await db.paymentAttempt.deleteMany({ where: { payment: { workspaceId } } });
    await db.payment.deleteMany({ where: { workspaceId } });
    await db.subscription.deleteMany({ where: { workspaceId } });
    await db.membership.deleteMany({ where: { workspaceId } });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
  }
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
}
