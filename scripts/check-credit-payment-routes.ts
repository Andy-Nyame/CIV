import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { initializeDocumentCreditPurchase } from "../src/features/payments/credit-purchases";
import type {
  InitializeProviderPaymentInput,
  PaymentProviderClient,
  VerifiedProviderPayment,
} from "../src/features/payments/provider";
import { verifyPaymentByReference } from "../src/features/payments/service";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3018";
const suffix = randomUUID();
const password = `Civ-credit-payment-route-${randomUUID()}`;

class RoutePaymentProvider implements PaymentProviderClient {
  readonly provider = "PAYSTACK" as const;
  verification: VerifiedProviderPayment | null = null;

  async initializePayment(input: InitializeProviderPaymentInput) {
    return {
      authorizationUrl: `https://checkout.paystack.com/${input.reference}`,
      accessCode: `route-${input.reference}`,
      reference: input.reference,
    };
  }

  async verifyPayment(reference: string) {
    if (!this.verification) throw new Error("Missing route verification fixture");
    return { ...this.verification, reference };
  }

  validateWebhook(_rawBody: Uint8Array, _signature: string | null) {
    void _rawBody;
    void _signature;
    return false;
  }

  parseWebhookEvent(_rawBody: Uint8Array): never {
    void _rawBody;
    throw new Error("Not used by route test");
  }
}

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
const users = await Promise.all(
  ["owner", "other-owner", "finance"].map((kind) =>
    db.user.create({
      data: {
        name: `Credit payment route ${kind}`,
        email: `civ-credit-payment-route-${kind}-${suffix}@example.invalid`,
        passwordHash,
      },
      select: { id: true, email: true },
    }),
  ),
);
await db.platformMembership.create({
  data: { userId: users[2].id, role: "FINANCE", status: "ACTIVE" },
});
const free = await db.plan.findUniqueOrThrow({
  where: { code: "FREE" },
  select: { id: true },
});
const workspaces = await Promise.all(
  users.slice(0, 2).map((user, index) =>
    db.workspace.create({
      data: {
        name: `Credit payment route workspace ${index + 1} ${suffix}`,
        type: "BUSINESS",
        memberships: {
          create: { userId: user.id, role: "OWNER", status: "ACTIVE" },
        },
        subscription: { create: { planId: free.id, status: "BETA" } },
      },
      select: { id: true },
    }),
  ),
);
const pack = await db.documentCreditPack.create({
  data: {
    code: `TEST_ROUTE_${suffix.replaceAll("-", "").slice(0, 18).toUpperCase()}`,
    name: "Temporary Route Test Credits",
    description: "Admin D.2 HTTP fixture",
    creditAmount: 100,
    price: "1.0000",
    currency: "GHS",
    isActive: true,
    isPublic: true,
    sortOrder: 99999,
  },
});
const provider = new RoutePaymentProvider();
const initialized = await initializeDocumentCreditPurchase(
  {
    actorUserId: users[0].id,
    workspaceId: workspaces[0].id,
    email: users[0].email!,
    packCode: pack.code,
  },
  provider,
);
if (initialized.kind !== "INITIALIZED") throw new Error("Route checkout missing");
provider.verification = {
  transactionId: randomUUID(),
  domain: "test",
  status: "success",
  reference: initialized.reference,
  amountMinor: 100,
  currency: "GHS",
  customerEmail: users[0].email,
  channel: "card",
  gatewayResponse: "Successful",
  paidAt: new Date().toISOString(),
};
await verifyPaymentByReference(initialized.reference, { provider });

try {
  const ownerCookies = await signIn(users[0].email!, "/app/settings/credits");
  ownerCookies.set("civ-active-workspace", workspaces[0].id);
  const creditsResponse = await fetch(`${baseUrl}/app/settings/credits`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  });
  const creditsPage = await creditsResponse.text();
  assert.equal(creditsResponse.status, 200);
  for (const text of [
    "Paystack Test Mode",
    "Card and Mobile Money",
    "Temporary Route Test Credits",
    "Recent credit purchases",
    "Completed",
    "100",
  ]) {
    assert.match(creditsPage, new RegExp(text));
  }

  const billingResponse = await fetch(`${baseUrl}/app/settings/billing`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  });
  const billingPage = await billingResponse.text();
  assert.equal(billingResponse.status, 200);
  assert.match(billingPage, /Document Credits/);
  assert.match(billingPage, /Completed · 100 credits/);

  const callback = await fetch(
    `${baseUrl}/app/settings/billing/payment-return?reference=${initialized.reference}`,
    { headers: { Cookie: cookieHeader(ownerCookies) } },
  );
  const callbackPage = await callback.text();
  assert.equal(callback.status, 200);
  assert.match(callbackPage, /This payment is linked to/);
  assert.match(callbackPage, /100<!-- --> credits/);

  const otherCookies = await signIn(users[1].email!, "/app/settings/credits");
  otherCookies.set("civ-active-workspace", workspaces[1].id);
  assert.equal(
    (
      await fetch(
        `${baseUrl}/app/settings/billing/payment-return?reference=${initialized.reference}`,
        { headers: { Cookie: cookieHeader(otherCookies) }, redirect: "manual" },
      )
    ).status,
    404,
  );

  const financeCookies = await signIn(users[2].email!, "/civ-admin/payments");
  const platformPayments = await fetch(`${baseUrl}/civ-admin/payments`, {
    headers: { Cookie: cookieHeader(financeCookies) },
  });
  const platformPaymentsPage = await platformPayments.text();
  assert.equal(platformPayments.status, 200);
  assert.match(platformPaymentsPage, new RegExp(initialized.reference));
  assert.match(platformPaymentsPage, /Completed · TEST_ROUTE_/);
  assert.doesNotMatch(
    platformPaymentsPage,
    /providerAccessCode|authorizationUrl|PAYSTACK_SECRET_KEY|sk_test_/,
  );

  const platformCredits = await fetch(`${baseUrl}/civ-admin/credits`, {
    headers: { Cookie: cookieHeader(financeCookies) },
  });
  const platformCreditsPage = await platformCredits.text();
  assert.equal(platformCredits.status, 200);
  assert.match(platformCreditsPage, /Completed paid test purchases/);
  assert.match(platformCreditsPage, /not real revenue/i);
  console.log(
    "PASS credit purchase UI, billing linkage, callback scope, platform fulfillment visibility, and Test Mode analytics",
  );
} finally {
  const workspaceIds = workspaces.map(({ id }) => id);
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
  await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.documentCreditPack.delete({ where: { id: pack.id } });
  await db.platformMembership.deleteMany({
    where: { userId: { in: users.map(({ id }) => id) } },
  });
  await db.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  assert.equal(
    await db.platformMembership.count({
      where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    }),
    1,
  );
  await db.$disconnect();
}
