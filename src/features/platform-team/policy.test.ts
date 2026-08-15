import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformOwnerProtectionError,
  PlatformTeamAuthorizationError,
} from "./errors";
import {
  assertCanManagePlatformRole,
  assertPlatformOwnerInvariant,
  canManagePlatformRole,
  RECRUITABLE_PLATFORM_ROLES,
} from "./policy";

test("only approved subordinate roles are recruitable", () => {
  assert.deepEqual(RECRUITABLE_PLATFORM_ROLES, [
    "PLATFORM_ADMIN",
    "ANALYST",
    "SUPPORT",
    "FINANCE",
  ]);
  for (const role of RECRUITABLE_PLATFORM_ROLES) {
    assert.equal(canManagePlatformRole("PLATFORM_OWNER", role), true);
  }
  assert.equal(canManagePlatformRole("PLATFORM_ADMIN", "ANALYST"), true);
  assert.equal(canManagePlatformRole("PLATFORM_ADMIN", "PLATFORM_ADMIN"), false);
  assert.equal(canManagePlatformRole("ANALYST", "SUPPORT"), false);
  assert.equal(canManagePlatformRole("SUPPORT", "FINANCE"), false);
  assert.equal(canManagePlatformRole("FINANCE", "ANALYST"), false);
});

test("ordinary platform-team policy protects Platform Owner", () => {
  assert.throws(
    () => assertCanManagePlatformRole("PLATFORM_OWNER", "PLATFORM_OWNER"),
    PlatformOwnerProtectionError,
  );
  assert.throws(
    () => assertCanManagePlatformRole("PLATFORM_ADMIN", "PLATFORM_ADMIN"),
    PlatformTeamAuthorizationError,
  );
  assert.throws(
    () =>
      assertPlatformOwnerInvariant({
        targetRole: "PLATFORM_OWNER",
        targetStatus: "ACTIVE",
        nextStatus: "SUSPENDED",
        activeOwnerCount: 1,
      }),
    PlatformOwnerProtectionError,
  );
  assert.throws(
    () =>
      assertPlatformOwnerInvariant({
        targetRole: "PLATFORM_ADMIN",
        targetStatus: "ACTIVE",
        activeOwnerCount: 0,
      }),
    PlatformOwnerProtectionError,
  );
});
