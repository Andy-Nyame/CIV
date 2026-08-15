import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { addUtcMonth } from "../src/features/commercial/periods";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3015";
const suffix = randomUUID();
const password = `Civ-commercial-route-${randomUUID()}`;

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
const [workspaceOwner, platformAdmin] = await Promise.all([
  db.user.create({
    data: {
      name: "Commercial route Owner",
      email: `civ-commercial-route-owner-${suffix}@example.invalid`,
      passwordHash,
    },
    select: { id: true, email: true },
  }),
  db.user.create({
    data: {
      name: "Commercial route Platform Admin",
      email: `civ-commercial-route-platform-${suffix}@example.invalid`,
      passwordHash,
      platformMembership: {
        create: { role: "PLATFORM_ADMIN", status: "ACTIVE" },
      },
    },
    select: { id: true, email: true },
  }),
]);
const business = await db.plan.findUniqueOrThrow({
  where: { code: "BUSINESS" },
  select: { id: true, documentLimit: true },
});
const periodStart = new Date(Date.now() - 60_000);
const workspace = await db.workspace.create({
  data: {
    name: `Commercial Route ${suffix}`,
    type: "BUSINESS",
    memberships: {
      create: { userId: workspaceOwner.id, role: "OWNER", status: "ACTIVE" },
    },
    subscription: { create: { planId: business.id, status: "BETA" } },
    documentAllowancePeriods: {
      create: {
        planId: business.id,
        periodStart,
        periodEnd: addUtcMonth(periodStart),
        allowance: business.documentLimit,
      },
    },
  },
  select: { id: true },
});

try {
  const signedOut = await fetch(`${baseUrl}/app/settings/credits`, {
    redirect: "manual",
  });
  assert.equal(signedOut.status, 307);
  assert.match(signedOut.headers.get("location") ?? "", /\/login/);

  const workspaceCookies = await signIn(
    workspaceOwner.email!,
    "/app/settings/credits",
  );
  workspaceCookies.set("civ-active-workspace", workspace.id);
  const creditsResponse = await fetch(`${baseUrl}/app/settings/credits`, {
    headers: { Cookie: cookieHeader(workspaceCookies) },
  });
  const creditsPage = await creditsResponse.text();
  assert.equal(creditsResponse.status, 200);
  for (const text of [
    "Document Credits",
    "Monthly allowance",
    "Purchased balance",
    "Available beta credit packs",
    "100 Document Credits",
  ]) {
    assert.match(creditsPage, new RegExp(text));
  }
  assert.doesNotMatch(
    creditsPage,
    /DATABASE_URL|R2_SECRET_ACCESS_KEY|AUTH_SECRET|storageKey|passwordHash/,
  );

  const customerAdminAttempt = await fetch(`${baseUrl}/civ-admin/credits`, {
    headers: { Cookie: cookieHeader(workspaceCookies) },
    redirect: "manual",
  });
  assert.equal(customerAdminAttempt.status, 404);

  const platformCookies = await signIn(platformAdmin.email!, "/civ-admin/plans");
  for (const [path, expected] of [
    ["/civ-admin/plans", "Your platform role has read-only plan access"],
    ["/civ-admin/credits", "Outstanding purchased credits"],
  ] as const) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: cookieHeader(platformCookies) },
    });
    const page = await response.text();
    assert.equal(response.status, 200, path);
    assert.match(page, new RegExp(expected));
    assert.doesNotMatch(
      page,
      /DATABASE_URL|R2_SECRET_ACCESS_KEY|AUTH_SECRET|storageKey|passwordHash/,
    );
  }

  console.log(
    "PASS commercial customer/platform routes, authorization boundary, allowance rendering, and secret exclusions",
  );
} finally {
  await db.workspaceDocumentAllowancePeriod.deleteMany({
    where: { workspaceId: workspace.id },
  });
  await db.subscription.deleteMany({ where: { workspaceId: workspace.id } });
  await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
  await db.workspace.delete({ where: { id: workspace.id } });
  await db.platformMembership.deleteMany({ where: { userId: platformAdmin.id } });
  await db.user.deleteMany({
    where: { id: { in: [workspaceOwner.id, platformAdmin.id] } },
  });
  await db.$disconnect();
}
