import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { addUtcMonth } from "../src/features/commercial/periods";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3018";
const suffix = randomUUID();
const password = `Civ-workspace-summary-route-${randomUUID()}`;
const userIds: string[] = [];
const workspaceIds: string[] = [];

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

function mainContent(page: string) {
  const start = page.indexOf('<main id="main-content"');
  const end = page.indexOf("</main>", start);
  assert.ok(start >= 0 && end > start);
  return page.slice(start, end + "</main>".length);
}

async function signIn(email: string) {
  const cookies = new Map<string, string>();
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  updateCookies(cookies, csrfResponse);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(cookies),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: "/app",
    }),
  });
  updateCookies(cookies, response);
  assert.ok(response.status === 302 || response.status === 303);
  return cookies;
}

const passwordHash = await hashPassword(password);
const [owner, staff] = await Promise.all(
  ["owner", "staff"].map(async (role) => {
    const user = await db.user.create({
      data: {
        name: `Workspace summary route ${role}`,
        email: `civ-workspace-summary-route-${role}-${suffix}@example.invalid`,
        passwordHash,
      },
      select: { id: true, email: true },
    });
    userIds.push(user.id);
    return user;
  }),
);
const plans = Object.fromEntries(
  (await db.plan.findMany({
    where: { code: { in: ["FREE", "BUSINESS"] } },
    select: { id: true, code: true, documentLimit: true },
  })).map((plan) => [plan.code, plan]),
);
assert.ok(plans.FREE.documentLimit !== null);
assert.ok(plans.BUSINESS.documentLimit !== null);
const periodStart = new Date(Date.now() - 60_000);
const periodEnd = addUtcMonth(periodStart);

async function createWorkspace(label: string, planCode: "FREE" | "BUSINESS") {
  const plan = plans[planCode];
  const workspace = await db.workspace.create({
    data: {
      name: `Workspace Summary Route ${label} ${suffix}`,
      type: "BUSINESS",
      memberships: {
        create: { userId: owner.id, role: "OWNER", status: "ACTIVE" },
      },
      subscription: {
        create: { planId: plan.id, status: "BETA", startedAt: periodStart },
      },
      documentAllowancePeriods: {
        create: {
          planId: plan.id,
          periodStart,
          periodEnd,
          allowance: plan.documentLimit,
        },
      },
    },
    select: { id: true, name: true },
  });
  workspaceIds.push(workspace.id);
  return workspace;
}

const freeWorkspace = await createWorkspace("Free", "FREE");
const businessWorkspace = await createWorkspace("Business", "BUSINESS");
await db.membership.create({
  data: {
    workspaceId: businessWorkspace.id,
    userId: staff.id,
    role: "STAFF",
    status: "ACTIVE",
  },
});
await db.documentCreditTransaction.create({
  data: {
    workspaceId: freeWorkspace.id,
    type: "BONUS",
    amount: 100,
    source: "WORKSPACE_SUMMARY_HTTP_TEST",
    sourceReference: `workspace-summary-http-${suffix}`,
  },
});

try {
  const ownerCookies = await signIn(owner.email!);
  ownerCookies.set("civ-active-workspace", freeWorkspace.id);
  const freeResponse = await fetch(`${baseUrl}/app`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  });
  const freePage = await freeResponse.text();
  const freeMain = mainContent(freePage);
  assert.equal(freeResponse.status, 200);
  assert.match(freeMain, /Workspace Plan &amp; Usage/);
  assert.match(freeMain, new RegExp(freeWorkspace.name));
  assert.match(freeMain, /Purchased credits/);
  assert.match(freeMain, /Owned by this workspace/);
  assert.match(freeMain, /100/);
  assert.match(freeMain, /Next renewal/);
  for (const route of [
    "/app/settings/plan",
    "/app/settings/credits",
    "/app/settings/billing",
  ]) {
    assert.match(freePage, new RegExp(`href=\\"${route}\\"`));
  }

  ownerCookies.set("civ-active-workspace", businessWorkspace.id);
  const businessResponse = await fetch(`${baseUrl}/app`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  });
  const businessPage = await businessResponse.text();
  const businessMain = mainContent(businessPage);
  assert.equal(businessResponse.status, 200);
  assert.match(businessMain, new RegExp(businessWorkspace.name));
  assert.match(businessMain, /Business/);
  assert.doesNotMatch(businessMain, new RegExp(freeWorkspace.name));
  assert.doesNotMatch(businessMain, /Owned by this workspace[^<]*100/);

  const staffCookies = await signIn(staff.email!);
  staffCookies.set("civ-active-workspace", businessWorkspace.id);
  const staffResponse = await fetch(`${baseUrl}/app`, {
    headers: { Cookie: cookieHeader(staffCookies) },
  });
  const staffPage = await staffResponse.text();
  const staffMain = mainContent(staffPage);
  assert.equal(staffResponse.status, 200);
  assert.match(staffMain, /Workspace Plan &amp; Usage/);
  assert.match(staffMain, new RegExp(businessWorkspace.name));
  for (const route of [
    "/app/settings/plan",
    "/app/settings/credits",
    "/app/settings/billing",
  ]) {
    assert.doesNotMatch(staffPage, new RegExp(`href=\\"${route}\\"`));
  }
  assert.doesNotMatch(
    staffPage,
    /DATABASE_URL|PAYSTACK_SECRET_KEY|R2_SECRET_ACCESS_KEY|passwordHash|storageKey/,
  );

  console.log(
    "PASS active-workspace plan/usage rendering, ledger balance, workspace isolation, renewal details, and role-aware actions",
  );
} finally {
  if (workspaceIds.length) {
    await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.documentCreditTransaction.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
}
