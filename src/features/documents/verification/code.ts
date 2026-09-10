import "server-only";

import { randomInt } from "node:crypto";

export const VERIFICATION_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const VERIFICATION_CODE_PATTERN = /^CIV-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

export function normalizeVerificationCode(input: unknown) {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toUpperCase();
  return VERIFICATION_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function generateVerificationCode() {
  const groups = Array.from({ length: 3 }, () => Array.from(
    { length: 4 },
    () => VERIFICATION_CODE_ALPHABET[randomInt(VERIFICATION_CODE_ALPHABET.length)],
  ).join(""));
  return `CIV-${groups.join("-")}`;
}
