import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { recordAuditEvent } from "../src/features/audit/service";
import { hashPassword } from "../src/features/auth/password";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3013";
const suffix = randomUUID();
const password = `Civ-audit-route-${randomUUID()}`;
const roles = ["OWNER", "ADMIN", "MANAGER", "STAFF"] as const;

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

async function signIn(email: string, workspaceId: string) {
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
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: "/app" }),
  });
  updateCookies(jar, response);
  assert.ok(response.status === 302 || response.status === 303);
  jar.set("civ-active-workspace", workspaceId);
  return jar;
}

const passwordHash = await hashPassword(password);
const users = await Promise.all(
  [...roles, "OUTSIDER" as const].map((role) =>
    db.user.create({
      data: {
        email: `civ-audit-route-${role.toLowerCase()}-${suffix}@example.invalid`,
        name: `Audit ${role}`,
        passwordHash,
      },
      select: { id: true, email: true },
    }),
  ),
);
const businessPlan = await db.plan.findUniqueOrThrow({
  where: { code: "BUSINESS" },
  select: { id: true },
});
const workspace = await db.workspace.create({
  data: {
    name: `CIV Audit Route ${suffix}`,
    type: "BUSINESS",
    memberships: {
      create: roles.map((role, index) => ({
        userId: users[index].id,
        role,
        status: "ACTIVE" as const,
      })),
    },
    subscription: { create: { planId: businessPlan.id, status: "BETA" } },
  },
  select: { id: true, subscription: { select: { id: true } } },
});

try {
  const providersResponse = await fetch(`${baseUrl}/api/auth/providers`);
  const providers = (await providersResponse.json()) as Record<string, unknown>;
  assert.equal(providersResponse.status, 200);
  assert.equal("credentials" in providers, true);
  assert.equal("google" in providers, true);

  await db.$transaction(
    async (transaction) => {
      await recordAuditEvent(transaction, {
        workspaceId: workspace.id,
        actorUserId: users[0].id,
        action: "WORKSPACE_PLAN_CHANGED",
        resourceType: "SUBSCRIPTION",
        resourceId: workspace.subscription!.id,
        metadata: { fromPlan: "FREE", toPlan: "BUSINESS" },
      });
      for (let index = 0; index < 21; index += 1) {
        await recordAuditEvent(transaction, {
          workspaceId: workspace.id,
          actorUserId: users[0].id,
          action: "WORKSPACE_UPDATED",
          resourceType: "WORKSPACE",
          resourceId: workspace.id,
          metadata: { changedFields: [`routeCheck${index}`] },
        });
      }
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  for (const index of [0, 1]) {
    const cookies = await signIn(users[index].email!, workspace.id);
    const response = await fetch(`${baseUrl}/app/activity`, {
      headers: { Cookie: cookieHeader(cookies) },
    });
    const page = await response.text();
    assert.equal(response.status, 200);
    assert.match(page, /See important actions that have taken place/);
    assert.match(page, /Workspace updated/);
    assert.match(page, /Older activity/);
    assert.match(page, /href="\/app\/activity"/);
  }

  for (const index of [2, 3]) {
    const cookies = await signIn(users[index].email!, workspace.id);
    const activityResponse = await fetch(`${baseUrl}/app/activity`, {
      headers: { Cookie: cookieHeader(cookies) },
      redirect: "manual",
    });
    assert.equal(activityResponse.status, 404);

    const appResponse = await fetch(`${baseUrl}/app`, {
      headers: { Cookie: cookieHeader(cookies) },
    });
    const appPage = await appResponse.text();
    assert.equal(appResponse.status, 200);
    assert.equal(appPage.includes('href="/app/activity"'), false);
  }

  const ownerCookies = await signIn(users[0].email!, workspace.id);
  const firstPage = await (await fetch(`${baseUrl}/app/activity`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  })).text();
  const cursor = firstPage.match(/\/app\/activity\?cursor=([0-9a-f-]{36})/)?.[1];
  assert.ok(cursor);
  const olderResponse = await fetch(`${baseUrl}/app/activity?cursor=${cursor}`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  });
  const olderPage = await olderResponse.text();
  assert.equal(olderResponse.status, 200);
  assert.match(olderPage, /switched this workspace from Free to Business/);
  assert.match(olderPage, /Newest activity/);

  const outsiderCookies = await signIn(users[4].email!, workspace.id);
  const outsiderResponse = await fetch(`${baseUrl}/app/activity`, {
    headers: { Cookie: cookieHeader(outsiderCookies) },
    redirect: "manual",
  });
  assert.equal(outsiderResponse.status, 307);
  assert.match(outsiderResponse.headers.get("location") ?? "", /\/onboarding$/);

  console.log("PASS activity route visibility, pagination, and workspace isolation");
} finally {
  await db.auditEvent.deleteMany({ where: { workspaceId: workspace.id } });
  await db.workspaceDocumentAllowancePeriod.deleteMany({
    where: { workspaceId: workspace.id },
  });
  await db.subscription.deleteMany({ where: { workspaceId: workspace.id } });
  await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
  await db.workspace.delete({ where: { id: workspace.id } });
  await db.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
}
