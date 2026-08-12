import assert from "node:assert/strict";
import test from "node:test";

import { OwnerProtectionError } from "./errors";
import { assertOwnerProtections } from "./owner-policy";

test("non-Owner cannot modify an Owner membership", () => {
  assert.throws(
    () =>
      assertOwnerProtections({
        actorRole: "ADMIN",
        targetRole: "OWNER",
        targetStatus: "ACTIVE",
        nextStatus: "SUSPENDED",
        activeOwnerCount: 2,
      }),
    OwnerProtectionError,
  );
});

test("last active Owner cannot be demoted or suspended", () => {
  for (const mutation of [
    { nextRole: "ADMIN" as const },
    { nextStatus: "SUSPENDED" as const },
    { nextStatus: "REMOVED" as const },
  ]) {
    assert.throws(
      () =>
        assertOwnerProtections({
          actorRole: "OWNER",
          targetRole: "OWNER",
          targetStatus: "ACTIVE",
          activeOwnerCount: 1,
          ...mutation,
        }),
      OwnerProtectionError,
    );
  }
});

test("an Owner may change another Owner only when one active Owner remains", () => {
  assert.doesNotThrow(() =>
    assertOwnerProtections({
      actorRole: "OWNER",
      targetRole: "OWNER",
      targetStatus: "ACTIVE",
      nextStatus: "SUSPENDED",
      activeOwnerCount: 2,
    }),
  );
});

test("ordinary team management cannot grant Owner authority", () => {
  assert.throws(
    () =>
      assertOwnerProtections({
        actorRole: "OWNER",
        targetRole: "ADMIN",
        targetStatus: "ACTIVE",
        nextRole: "OWNER",
        activeOwnerCount: 1,
      }),
    OwnerProtectionError,
  );
});
