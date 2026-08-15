import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlatformInvitationToken,
  hashPlatformInvitationToken,
  isValidPlatformInvitationToken,
  PLATFORM_INVITATION_TOKEN_BYTES,
} from "./token";

test("platform invitation tokens are random, URL-safe, and stored as SHA-256 hashes", () => {
  const first = createPlatformInvitationToken();
  const second = createPlatformInvitationToken();

  assert.equal(PLATFORM_INVITATION_TOKEN_BYTES, 32);
  assert.equal(isValidPlatformInvitationToken(first.token), true);
  assert.equal(first.token.length, 43);
  assert.equal(first.tokenHash.length, 64);
  assert.notEqual(first.token, first.tokenHash);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenHash, second.tokenHash);
  assert.equal(hashPlatformInvitationToken(first.token), first.tokenHash);
});

test("malformed platform invitation tokens are rejected before database access", () => {
  for (const token of ["", "short", "a".repeat(44), "!".repeat(43), null]) {
    assert.equal(isValidPlatformInvitationToken(token), false);
  }
});
