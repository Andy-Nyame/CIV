import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import sharp from "sharp";

import { hashPassword } from "../src/features/auth/password";
import {
  removePersonalSignature,
  savePersonalSignature,
} from "../src/features/profile/service";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3011";
const password = `Civ-storage-${randomUUID()}`;
const suffix = randomUUID();
const emails = [
  `civ-private-route-owner-${suffix}@example.invalid`,
  `civ-private-route-other-${suffix}@example.invalid`,
];

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
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: "/app" }),
  });
  updateCookies(jar, response);
  assert.ok(response.status === 302 || response.status === 303);

  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: cookieHeader(jar) },
  });
  const session = (await sessionResponse.json()) as { user?: { id?: string } };
  assert.equal(typeof session.user?.id, "string");
  return jar;
}

const passwordHash = await hashPassword(password);
const users = await Promise.all(
  emails.map((email) =>
    db.user.create({ data: { email, passwordHash }, select: { id: true } }),
  ),
);

try {
  const signature = await sharp({
    create: {
      width: 1200,
      height: 360,
      channels: 4,
      background: { r: 16, g: 42, b: 67, alpha: 0.4 },
    },
  })
    .png()
    .toBuffer();
  await savePersonalSignature(
    users[0].id,
    new File([signature], "signature.png", { type: "image/png" }),
  );
  const metadata = await db.signatureProfile.findUniqueOrThrow({
    where: { userId: users[0].id },
    select: { storageKey: true },
  });

  const ownerCookies = await signIn(emails[0]);
  const ownerResponse = await fetch(`${baseUrl}/api/profile/assets/signature`, {
    headers: { Cookie: cookieHeader(ownerCookies) },
  });
  assert.equal(ownerResponse.status, 200);
  assert.equal(ownerResponse.headers.get("content-type"), "image/png");
  assert.equal(ownerResponse.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await ownerResponse.arrayBuffer()), signature);

  const otherCookies = await signIn(emails[1]);
  const crossUserResponse = await fetch(
    `${baseUrl}/api/profile/assets/signature?key=${encodeURIComponent(metadata.storageKey)}`,
    { headers: { Cookie: cookieHeader(otherCookies) } },
  );
  assert.equal(crossUserResponse.status, 404);

  console.log("PASS authenticated private delivery and cross-user denial");
} finally {
  await removePersonalSignature(users[0].id).catch(() => undefined);
  await db.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
}
