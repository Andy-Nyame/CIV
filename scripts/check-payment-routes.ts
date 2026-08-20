import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3018";
const suffix = randomUUID();
const password = `Civ-payment-route-${randomUUID()}`;

function updateCookies(jar: Map<string, string>, response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function signIn(email: string, callbackUrl: string) {
  const jar = new Map<string, string>();
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  updateCookies(jar, csrfResponse);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl }),
  });
  updateCookies(jar, response);
  assert.ok(response.status === 302 || response.status === 303);
  return jar;
}

const passwordHash = await hashPassword(password);
const free = await db.plan.findUniqueOrThrow({ where: { code: "FREE" }, select: { id: true } });
const users = await Promise.all(
  ["owner-a", "owner-b", "finance", "support"].map((kind) =>
    db.user.create({
      data: {
        name: `Payment route ${kind}`,
        email: `civ-payment-route-${kind}-${suffix}@example.invalid`,
        passwordHash,
      },
      select: { id: true, email: true },
    }),
  ),
);
await db.platformMembership.createMany({
  data: [
    { userId: users[2].id, role: "FINANCE", status: "ACTIVE" },
    { userId: users[3].id, role: "SUPPORT", status: "ACTIVE" },
  ],
});
const workspaces = await Promise.all(
  [users[0], users[1]].map((user, index) =>
    db.workspace.create({
      data: {
        name: `Payment route workspace ${index + 1} ${suffix}`,
        type: "BUSINESS",
        memberships: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
        subscription: { create: { planId: free.id, status: "BETA" } },
      },
      select: { id: true },
    }),
  ),
);
const reference = `CIV-PAY-${randomBytes(16).toString("hex").toUpperCase()}`;
const payment = await db.payment.create({
  data: {
    workspaceId: workspaces[0].id,
    initiatedByUserId: users[0].id,
    purpose: "BILLING_TEST",
    provider: "PAYSTACK",
    internalReference: reference,
    providerReference: reference,
    amount: "1.00",
    currency: "GHS",
    status: "PENDING",
    metadata: { entitlementGrant: false, routeTest: true },
    attempts: {
      create: {
        provider: "PAYSTACK",
        providerReference: reference,
        status: "PENDING",
        requestMetadata: { amountMinor: 100, currency: "GHS" },
      },
    },
  },
  select: { id: true },
});
const unknownReference = `CIV-PAY-${randomBytes(16).toString("hex").toUpperCase()}`;

try {
  const signedOut = await fetch(`${baseUrl}/app/settings/billing`, { redirect: "manual" });
  assert.equal(signedOut.status, 307);
  assert.match(signedOut.headers.get("location") ?? "", /\/login/);

  const ownerCookies = await signIn(users[0].email!, "/app/settings/billing");
  ownerCookies.set("civ-active-workspace", workspaces[0].id);
  const billingResponse = await fetch(`${baseUrl}/app/settings/billing`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  });
  const billingPage = await billingResponse.text();
  assert.equal(billingResponse.status, 200);
  for (const expected of ["Paystack Test Mode", reference, "Infrastructure only"]) {
    assert.match(billingPage, new RegExp(expected));
  }
  for (const removedControl of ["Infrastructure test checkout", "Initialize Test Checkout", "validate the checkout connection"]) {
    assert.doesNotMatch(billingPage, new RegExp(removedControl));
  }

  const callbackResponse = await fetch(
    `${baseUrl}/app/settings/billing/payment-return?reference=${reference}`,
    { headers: { Cookie: cookieHeader(ownerCookies) } },
  );
  const callbackPage = await callbackResponse.text();
  assert.equal(callbackResponse.status, 200);
  assert.match(callbackPage, /return alone does not prove payment success/i);
  assert.equal((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "PENDING");

  const otherCookies = await signIn(users[1].email!, "/app/settings/billing");
  otherCookies.set("civ-active-workspace", workspaces[1].id);
  assert.equal((await fetch(
    `${baseUrl}/app/settings/billing/payment-return?reference=${reference}`,
    { headers: { Cookie: cookieHeader(otherCookies) }, redirect: "manual" },
  )).status, 404);

  const ownerAdmin = await fetch(`${baseUrl}/civ-admin/payments`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
    redirect: "manual",
  });
  assert.equal(ownerAdmin.status, 404);

  const financeCookies = await signIn(users[2].email!, "/civ-admin/payments");
  const financeResponse = await fetch(`${baseUrl}/civ-admin/payments`, {
    headers: { Cookie: cookieHeader(financeCookies) },
  });
  const financePage = await financeResponse.text();
  assert.equal(financeResponse.status, 200);
  assert.match(financePage, new RegExp(reference));
  assert.doesNotMatch(financePage, /providerAccessCode|authorizationUrl|PAYSTACK_SECRET_KEY|sk_test_/);

  const supportCookies = await signIn(users[3].email!, "/civ-admin/payments");
  assert.equal((await fetch(`${baseUrl}/civ-admin/payments`, {
    headers: { Cookie: cookieHeader(supportCookies) },
    redirect: "manual",
  })).status, 404);

  const eventBody = JSON.stringify({
    event: "charge.success",
    data: { id: 987654321, status: "success", reference: unknownReference, amount: 100, currency: "GHS" },
  });
  const signature = createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!)
    .update(eventBody)
    .digest("hex");
  const validWebhook = await fetch(`${baseUrl}/api/payments/paystack/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body: eventBody,
  });
  assert.equal(validWebhook.status, 200);
  assert.deepEqual(await validWebhook.json(), { received: true });
  assert.equal((await db.paymentProviderEvent.findFirstOrThrow({ where: { providerReference: unknownReference } })).status, "IGNORED");

  const duplicate = await fetch(`${baseUrl}/api/payments/paystack/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body: eventBody,
  });
  assert.equal(duplicate.status, 200);
  assert.equal(await db.paymentProviderEvent.count({ where: { providerReference: unknownReference } }), 1);

  const modified = await fetch(`${baseUrl}/api/payments/paystack/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body: `${eventBody} `,
  });
  assert.equal(modified.status, 401);
  assert.equal(await db.documentCreditTransaction.count({ where: { workspaceId: workspaces[0].id } }), 0);
  console.log("PASS payment billing routes, callback non-authority, platform authorization, webhook signature/idempotency, and entitlement isolation");
} finally {
  await db.paymentProviderEvent.deleteMany({ where: { providerReference: { in: [reference, unknownReference] } } });
  await db.paymentAttempt.deleteMany({ where: { payment: { workspaceId: { in: workspaces.map(({ id }) => id) } } } });
  await db.payment.deleteMany({ where: { workspaceId: { in: workspaces.map(({ id }) => id) } } });
  await db.workspaceDocumentAllowancePeriod.deleteMany({
    where: { workspaceId: { in: workspaces.map(({ id }) => id) } },
  });
  await db.subscription.deleteMany({ where: { workspaceId: { in: workspaces.map(({ id }) => id) } } });
  await db.membership.deleteMany({ where: { workspaceId: { in: workspaces.map(({ id }) => id) } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaces.map(({ id }) => id) } } });
  await db.platformMembership.deleteMany({ where: { userId: { in: users.map(({ id }) => id) } } });
  await db.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  assert.equal(await db.platformMembership.count({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } }), 1);
  await db.$disconnect();
}
