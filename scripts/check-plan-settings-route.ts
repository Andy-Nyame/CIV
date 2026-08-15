import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3012";
const suffix = randomUUID();
const password = `Civ-plan-route-${randomUUID()}`;
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
        email: `civ-plan-route-${role.toLowerCase()}-${suffix}@example.invalid`,
        name: `Plan ${role}`,
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
    name: `CIV Plan Route ${suffix}`,
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
  select: { id: true },
});

try {
  const ownerCookies = await signIn(users[0].email!, workspace.id);
  const ownerResponse = await fetch(`${baseUrl}/app/settings/plan`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  });
  const ownerPage = await ownerResponse.text();
  assert.equal(ownerResponse.status, 200);
  assert.match(ownerPage, /All CIV plans are free during beta/);
  for (const planName of ["Free", "Starter", "Business", "Pro", "Enterprise"]) {
    assert.match(ownerPage, new RegExp(`>${planName}<`));
  }
  assert.equal(ownerPage.includes("Switch to"), true);

  const adminCookies = await signIn(users[1].email!, workspace.id);
  const adminResponse = await fetch(`${baseUrl}/app/settings/plan`, {
    headers: { Cookie: cookieHeader(adminCookies) },
  });
  const adminPage = await adminResponse.text();
  assert.equal(adminResponse.status, 200);
  assert.match(adminPage, /Only the Workspace Owner can change it/);
  assert.equal(adminPage.includes("Switch to"), false);

  for (const index of [2, 3]) {
    const cookies = await signIn(users[index].email!, workspace.id);
    const response = await fetch(`${baseUrl}/app/settings/plan`, {
      headers: { Cookie: cookieHeader(cookies) },
      redirect: "manual",
    });
    assert.equal(response.status, 404);
  }

  const outsiderCookies = await signIn(users[4].email!, workspace.id);
  const outsiderResponse = await fetch(`${baseUrl}/app/settings/plan`, {
    headers: { Cookie: cookieHeader(outsiderCookies) },
    redirect: "manual",
  });
  assert.equal(outsiderResponse.status, 307);
  assert.match(outsiderResponse.headers.get("location") ?? "", /\/onboarding$/);

  console.log("PASS plan settings route visibility and workspace-cookie isolation");
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
