import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { db } from "../src/lib/db";
import { hashPlatformInvitationToken } from "../src/features/platform-team/token";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3014";
const suffix = randomUUID();
const password = `Civ-platform-route-${randomUUID()}`;

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

async function signIn(email: string) {
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
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: "/civ-admin",
    }),
  });
  updateCookies(jar, response);
  assert.ok(response.status === 302 || response.status === 303);
  return jar;
}

const passwordHash = await hashPassword(password);
const users = await Promise.all(
  ["workspace-owner", "platform-admin", "suspended-platform-admin"].map(
    (kind) =>
      db.user.create({
        data: {
          email: `civ-platform-route-${kind}-${suffix}@example.invalid`,
          name: `Platform route ${kind}`,
          passwordHash,
        },
        select: { id: true, email: true },
      }),
  ),
);

const freePlan = await db.plan.findUniqueOrThrow({
  where: { code: "FREE" },
  select: { id: true },
});
const workspace = await db.workspace.create({
  data: {
    name: `CIV Platform Boundary ${suffix}`,
    type: "BUSINESS",
    memberships: {
      create: {
        userId: users[0].id,
        role: "OWNER",
        status: "ACTIVE",
      },
    },
    subscription: { create: { planId: freePlan.id, status: "BETA" } },
  },
  select: { id: true },
});

await db.platformMembership.createMany({
  data: [
    {
      userId: users[1].id,
      role: "PLATFORM_ADMIN",
      status: "ACTIVE",
    },
    {
      userId: users[2].id,
      role: "PLATFORM_ADMIN",
      status: "SUSPENDED",
    },
  ],
});

const platformInvitationToken = randomBytes(32).toString("base64url");
const platformInvitation = await db.platformInvitation.create({
  data: {
    email: users[0].email!,
    role: "SUPPORT",
    tokenHash: hashPlatformInvitationToken(platformInvitationToken),
    invitedByUserId: users[1].id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  },
  select: { id: true },
});

try {
  const signedOutResponse = await fetch(`${baseUrl}/civ-admin`, {
    redirect: "manual",
  });
  assert.equal(signedOutResponse.status, 307);
  assert.match(
    signedOutResponse.headers.get("location") ?? "",
    /\/login\?callbackUrl=%2Fciv-admin$/,
  );

  const workspaceOwnerCookies = await signIn(users[0].email!);
  workspaceOwnerCookies.set("civ-active-workspace", workspace.id);
  const workspaceOwnerResponse = await fetch(`${baseUrl}/civ-admin`, {
    headers: { Cookie: cookieHeader(workspaceOwnerCookies) },
    redirect: "manual",
  });
  assert.equal(workspaceOwnerResponse.status, 404);

  const signedOutInvitationResponse = await fetch(
    `${baseUrl}/platform-invite/${platformInvitationToken}`,
  );
  const signedOutInvitationPage = await signedOutInvitationResponse.text();
  assert.equal(signedOutInvitationResponse.status, 200);
  assert.match(signedOutInvitationPage, /Join the CIV platform team/);
  assert.match(signedOutInvitationPage, /Sign In/);
  assert.match(signedOutInvitationPage, /Create Account/);
  assert.match(
    signedOutInvitationPage,
    new RegExp(`callbackUrl=%2Fplatform-invite%2F${platformInvitationToken}`),
  );

  const matchingInvitationResponse = await fetch(
    `${baseUrl}/platform-invite/${platformInvitationToken}`,
    { headers: { Cookie: cookieHeader(workspaceOwnerCookies) } },
  );
  assert.match(await matchingInvitationResponse.text(), /Accept Platform Invitation/);

  const suspendedCookies = await signIn(users[2].email!);
  const suspendedResponse = await fetch(`${baseUrl}/civ-admin`, {
    headers: { Cookie: cookieHeader(suspendedCookies) },
    redirect: "manual",
  });
  assert.equal(suspendedResponse.status, 404);

  const platformCookies = await signIn(users[1].email!);
  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: cookieHeader(platformCookies) },
  });
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  assert.equal(session.user?.id, users[1].id);

  const expectedPages = {
    "/civ-admin": "Platform Overview",
    "/civ-admin/users": "Newest CIV accounts",
    "/civ-admin/workspaces": "Newest workspaces",
    "/civ-admin/plans": "CIV beta plans",
    "/civ-admin/storage": "Tracked private assets",
    "/civ-admin/team": "Invite platform staff",
    "/civ-admin/activity": "Recent operational events",
    "/civ-admin/system": "Database connectivity",
  } as const;

  let combinedMarkup = "";
  for (const [pathname, expectedText] of Object.entries(expectedPages)) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: { Cookie: cookieHeader(platformCookies) },
    });
    const page = await response.text();
    assert.equal(response.status, 200, pathname);
    assert.match(page, new RegExp(expectedText), pathname);
    combinedMarkup += page;
  }

  for (const forbidden of [
    "passwordHash",
    "access_token",
    "refresh_token",
    "storageKey",
    "DATABASE_URL",
    "R2_SECRET_ACCESS_KEY",
    "AUTH_SECRET",
  ]) {
    assert.equal(combinedMarkup.includes(forbidden), false, forbidden);
  }

  console.log(
    "PASS platform route authentication, invitation continuation, workspace-role isolation, suspended denial, safe rendering, and navigation",
  );
} finally {
  await db.platformInvitation.deleteMany({
    where: { id: platformInvitation.id },
  });
  await db.platformMembership.deleteMany({
    where: { userId: { in: users.map(({ id }) => id) } },
  });
  await db.subscription.deleteMany({ where: { workspaceId: workspace.id } });
  await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
  await db.workspace.delete({ where: { id: workspace.id } });
  await db.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  await db.$disconnect();
}
