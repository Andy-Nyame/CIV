import assert from "node:assert/strict";
import test from "node:test";

import { PlatformOwnerProtectionError } from "./errors";
import { assertPlatformOwnerProtections } from "./owner-policy";

test("ordinary platform operations cannot grant Platform Owner", () => {
  assert.throws(
    () =>
      assertPlatformOwnerProtections({
        activeOwnerCount: 1,
        targetRole: "PLATFORM_ADMIN",
        targetStatus: "ACTIVE",
        nextRole: "PLATFORM_OWNER",
        nextStatus: "ACTIVE",
      }),
    PlatformOwnerProtectionError,
  );
});

test("ordinary platform operations cannot demote, suspend, or remove Platform Owner", () => {
  for (const proposed of [
    { role: "PLATFORM_ADMIN" as const, status: "ACTIVE" as const },
    { role: "PLATFORM_OWNER" as const, status: "SUSPENDED" as const },
    { role: "PLATFORM_OWNER" as const, status: "REMOVED" as const },
  ]) {
    assert.throws(
      () =>
        assertPlatformOwnerProtections({
          activeOwnerCount: 1,
          targetRole: "PLATFORM_OWNER",
          targetStatus: "ACTIVE",
          nextRole: proposed.role,
          nextStatus: proposed.status,
        }),
      PlatformOwnerProtectionError,
    );
  }
});

test("unchanged Platform Owner state remains valid and zero active owners is rejected", () => {
  assert.doesNotThrow(() =>
    assertPlatformOwnerProtections({
      activeOwnerCount: 1,
      targetRole: "PLATFORM_OWNER",
      targetStatus: "ACTIVE",
      nextRole: "PLATFORM_OWNER",
      nextStatus: "ACTIVE",
    }),
  );
  assert.throws(
    () =>
      assertPlatformOwnerProtections({
        activeOwnerCount: 0,
        targetRole: "PLATFORM_ADMIN",
        targetStatus: "ACTIVE",
        nextRole: "PLATFORM_ADMIN",
        nextStatus: "ACTIVE",
      }),
    PlatformOwnerProtectionError,
  );
});
