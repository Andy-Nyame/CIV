import "server-only";

import { createHash, randomBytes } from "node:crypto";

const tokenByteLength = 32;
const rawTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createInvitationToken() {
  const token = randomBytes(tokenByteLength).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidInvitationToken(token: unknown): token is string {
  return typeof token === "string" && rawTokenPattern.test(token);
}
