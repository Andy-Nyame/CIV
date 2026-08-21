import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_CAPABILITIES,
  ALL_PLATFORM_CAPABILITIES,
  getPlatformCapabilitiesForRole,
  hasPlatformCapability,
} from "./capabilities";

test("PLATFORM_OWNER has every platform capability", () => {
  assert.deepEqual(
    new Set(getPlatformCapabilitiesForRole("PLATFORM_OWNER")),
    new Set(ALL_PLATFORM_CAPABILITIES),
  );
});

test("PLATFORM_ADMIN has broad operations access without finance or plan mutation", () => {
  const membership = { role: "PLATFORM_ADMIN" as const };
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.VIEW_USERS),
    true,
  );
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM),
    true,
  );
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.VIEW_FINANCIAL_ANALYTICS),
    false,
  );
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.MANAGE_PLATFORM_PLANS),
    false,
  );
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.VIEW_PAYMENTS),
    true,
  );
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.MANAGE_PAYMENT_REFUNDS),
    true,
  );
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.RECONCILE_PAYMENTS),
    true,
  );
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.VIEW_TRIALS),
    true,
  );
  assert.equal(
    hasPlatformCapability(membership, PLATFORM_CAPABILITIES.MANAGE_TRIALS),
    true,
  );
});

test("ANALYST is read-only, SUPPORT is operationally limited, and FINANCE is scoped", () => {
  assert.equal(
    hasPlatformCapability(
      { role: "ANALYST" },
      PLATFORM_CAPABILITIES.VIEW_PLATFORM_ANALYTICS,
    ),
    true,
  );
  assert.equal(
    hasPlatformCapability(
      { role: "ANALYST" },
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_SETTINGS,
    ),
    false,
  );
  assert.equal(
    hasPlatformCapability(
      { role: "ANALYST" },
      PLATFORM_CAPABILITIES.VIEW_PAYMENTS,
    ),
    true,
  );
  assert.equal(
    hasPlatformCapability({ role: "ANALYST" }, PLATFORM_CAPABILITIES.VIEW_TRIALS),
    true,
  );
  assert.equal(
    hasPlatformCapability({ role: "ANALYST" }, PLATFORM_CAPABILITIES.MANAGE_TRIALS),
    false,
  );
  assert.equal(
    hasPlatformCapability({ role: "ANALYST" }, PLATFORM_CAPABILITIES.MANAGE_PAYMENT_REFUNDS),
    false,
  );
  assert.equal(
    hasPlatformCapability({ role: "ANALYST" }, PLATFORM_CAPABILITIES.RECONCILE_PAYMENTS),
    false,
  );
  assert.equal(
    hasPlatformCapability({ role: "SUPPORT" }, PLATFORM_CAPABILITIES.VIEW_USERS),
    true,
  );
  assert.equal(
    hasPlatformCapability(
      { role: "SUPPORT" },
      PLATFORM_CAPABILITIES.VIEW_STORAGE_ANALYTICS,
    ),
    false,
  );
  assert.equal(
    hasPlatformCapability({ role: "SUPPORT" }, PLATFORM_CAPABILITIES.VIEW_TRIALS),
    true,
  );
  assert.equal(
    hasPlatformCapability({ role: "SUPPORT" }, PLATFORM_CAPABILITIES.MANAGE_TRIALS),
    false,
  );
  assert.equal(
    hasPlatformCapability({ role: "SUPPORT" }, PLATFORM_CAPABILITIES.VIEW_PAYMENTS),
    false,
  );
  assert.equal(
    hasPlatformCapability(
      { role: "FINANCE" },
      PLATFORM_CAPABILITIES.VIEW_FINANCIAL_ANALYTICS,
    ),
    true,
  );
  assert.equal(
    hasPlatformCapability(
      { role: "FINANCE" },
      PLATFORM_CAPABILITIES.VIEW_PAYMENTS,
    ),
    true,
  );
  assert.equal(
    hasPlatformCapability(
      { role: "FINANCE" },
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM,
    ),
    false,
  );
  assert.equal(
    hasPlatformCapability({ role: "FINANCE" }, PLATFORM_CAPABILITIES.MANAGE_PAYMENT_REFUNDS),
    false,
  );
  assert.equal(
    hasPlatformCapability({ role: "FINANCE" }, PLATFORM_CAPABILITIES.RECONCILE_PAYMENTS),
    true,
  );
  assert.equal(
    hasPlatformCapability({ role: "FINANCE" }, PLATFORM_CAPABILITIES.VIEW_TRIALS),
    true,
  );
  assert.equal(
    hasPlatformCapability({ role: "FINANCE" }, PLATFORM_CAPABILITIES.MANAGE_TRIALS),
    false,
  );
});
