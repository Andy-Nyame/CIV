import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { addUtcMonth } from "../src/features/commercial/periods";
import { grantConfiguredTrial } from "../src/features/trials/service";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3016";
const suffix = randomUUID();
const password = `Civ-trial-route-${randomUUID()}`;

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
const originalConfiguration = await db.trialConfiguration.findUniqueOrThrow({
  where: { id: "GLOBAL" },
});
const [business, free] = await Promise.all([
  db.plan.findUniqueOrThrow({ where: { code: "BUSINESS" }, select: { id: true } }),
  db.plan.findUniqueOrThrow({ where: { code: "FREE" }, select: { id: true, documentLimit: true } }),
]);
await db.trialConfiguration.update({
  where: { id: "GLOBAL" },
  data: {
    enabled: true,
    trialPlanId: business.id,
    durationDays: 14,
    fallbackPlanId: free.id,
    newWorkspacesOnly: true,
    oneTrialPerWorkspace: true,
    paymentMethodRequired: false,
    allowManualGrant: true,
  },
});

const users = await Promise.all(
  ["workspace-owner", "platform-admin", "analyst"].map((kind) =>
    db.user.create({
      data: {
        name: `Trial route ${kind}`,
        email: `civ-trial-route-${kind}-${suffix}@example.invalid`,
        passwordHash,
      },
      select: { id: true, email: true },
    }),
  ),
);
await db.platformMembership.createMany({
  data: [
    { userId: users[1].id, role: "PLATFORM_ADMIN", status: "ACTIVE" },
    { userId: users[2].id, role: "ANALYST", status: "ACTIVE" },
  ],
});
const periodStart = new Date(Date.now() - 60_000);
const workspace = await db.workspace.create({
  data: {
    name: `Trial Route ${suffix}`,
    type: "BUSINESS",
    memberships: { create: { userId: users[0].id, role: "OWNER", status: "ACTIVE" } },
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
  select: { id: true },
});
const trial = await grantConfiguredTrial({
  actorUserId: users[1].id,
  workspaceId: workspace.id,
});

try {
  const signedOut = await fetch(`${baseUrl}/civ-admin/trials`, { redirect: "manual" });
  assert.equal(signedOut.status, 307);
  assert.match(signedOut.headers.get("location") ?? "", /\/login/);

  const workspaceCookies = await signIn(users[0].email!, "/app/settings/plan");
  workspaceCookies.set("civ-active-workspace", workspace.id);
  const workspacePageResponse = await fetch(`${baseUrl}/app/settings/plan`, {
    headers: { Cookie: cookieHeader(workspaceCookies) },
  });
  const workspacePage = await workspacePageResponse.text();
  assert.equal(workspacePageResponse.status, 200);
  for (const expected of ["Business(?:<!-- -->)? Trial", "days remaining", "Normal plan", "Free"]) {
    assert.match(workspacePage, new RegExp(expected));
  }
  const customerAdmin = await fetch(`${baseUrl}/civ-admin/trials`, {
    headers: { Cookie: cookieHeader(workspaceCookies) },
    redirect: "manual",
  });
  assert.equal(customerAdmin.status, 404);

  const platformCookies = await signIn(users[1].email!, "/civ-admin/trials");
  const platformResponse = await fetch(`${baseUrl}/civ-admin/trials`, {
    headers: { Cookie: cookieHeader(platformCookies) },
  });
  const platformPage = await platformResponse.text();
  assert.equal(platformResponse.status, 200);
  for (const expected of ["Global trial configuration", "Grant configured trial", "Trial history", workspace.id]) {
    assert.match(platformPage, new RegExp(expected));
  }

  const analystCookies = await signIn(users[2].email!, "/civ-admin/trials");
  const analystPage = await (await fetch(`${baseUrl}/civ-admin/trials`, {
    headers: { Cookie: cookieHeader(analystCookies) },
  })).text();
  assert.match(analystPage, /Global trial configuration/);
  assert.doesNotMatch(analystPage, /Grant configured trial/);

  for (const forbidden of [
    "passwordHash",
    "access_token",
    "refresh_token",
    "storageKey",
    "DATABASE_URL",
    "R2_SECRET_ACCESS_KEY",
    "AUTH_SECRET",
  ]) {
    assert.equal(`${workspacePage}${platformPage}${analystPage}`.includes(forbidden), false);
  }
  console.log("PASS trial routes, customer status, platform authorization, read-only analytics, and secret exclusions");
} finally {
  await db.trialConfiguration.update({
    where: { id: "GLOBAL" },
    data: {
      enabled: originalConfiguration.enabled,
      trialPlanId: originalConfiguration.trialPlanId,
      durationDays: originalConfiguration.durationDays,
      fallbackPlanId: originalConfiguration.fallbackPlanId,
      newWorkspacesOnly: originalConfiguration.newWorkspacesOnly,
      oneTrialPerWorkspace: originalConfiguration.oneTrialPerWorkspace,
      paymentMethodRequired: originalConfiguration.paymentMethodRequired,
      allowManualGrant: originalConfiguration.allowManualGrant,
    },
  });
  await db.auditEvent.deleteMany({ where: { workspaceId: workspace.id } });
  await db.workspaceTrial.deleteMany({ where: { workspaceId: workspace.id } });
  await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: workspace.id } });
  await db.subscription.deleteMany({ where: { workspaceId: workspace.id } });
  await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
  await db.workspace.delete({ where: { id: workspace.id } });
  await db.platformAuditEvent.deleteMany({
    where: { OR: [{ actorUserId: { in: users.map(({ id }) => id) } }, { resourceId: trial.id }] },
  });
  await db.platformMembership.deleteMany({ where: { userId: { in: users.map(({ id }) => id) } } });
  await db.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  assert.equal(
    await db.platformMembership.count({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } }),
    1,
  );
  await db.$disconnect();
}
