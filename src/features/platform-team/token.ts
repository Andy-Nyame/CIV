import { createHash, randomBytes } from "node:crypto";

export const PLATFORM_INVITATION_TOKEN_BYTES = 32;
export const PLATFORM_INVITATION_TOKEN_LENGTH = 43;

export function hashPlatformInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createPlatformInvitationToken() {
  const token = randomBytes(PLATFORM_INVITATION_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashPlatformInvitationToken(token) };
}

export function isValidPlatformInvitationToken(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length === PLATFORM_INVITATION_TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}
