import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvitationToken,
  hashInvitationToken,
  isValidInvitationToken,
} from "./token";

test("invitation tokens are random, URL-safe, and stored as SHA-256 hashes", () => {
  const first = createInvitationToken();
  const second = createInvitationToken();

  assert.equal(isValidInvitationToken(first.token), true);
  assert.equal(first.token.length, 43);
  assert.equal(first.tokenHash.length, 64);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenHash, second.tokenHash);
  assert.notEqual(first.token, first.tokenHash);
  assert.equal(hashInvitationToken(first.token), first.tokenHash);
});

test("malformed invitation tokens are rejected before database access", () => {
  for (const token of ["", "short", "a".repeat(44), "!".repeat(43), null]) {
    assert.equal(isValidInvitationToken(token), false);
  }
});
