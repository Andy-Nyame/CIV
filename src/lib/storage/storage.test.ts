import assert from "node:assert/strict";
import test from "node:test";

import { readR2Config, StorageConfigurationError } from "./config";
import { createUserImageKey } from "./object-keys";

const validEnvironment = {
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET_NAME: "civ-private",
  R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  R2_REGION: "auto",
};

test("R2 configuration requires a matching Cloudflare account endpoint", () => {
  assert.equal(readR2Config(validEnvironment).region, "auto");
  assert.throws(
    () => readR2Config({ ...validEnvironment, R2_ACCOUNT_ID: "b".repeat(32) }),
    StorageConfigurationError,
  );
  assert.throws(
    () => readR2Config({ ...validEnvironment, R2_BUCKET_NAME: "public-assets" }),
    StorageConfigurationError,
  );
});

test("private object keys are user-scoped, random, and reject invalid identities", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const first = createUserImageKey({ userId, kind: "profile", mimeType: "image/webp" });
  const second = createUserImageKey({ userId, kind: "profile", mimeType: "image/webp" });
  assert.match(first, /^users\/[a-f0-9-]{36}\/profile\/[a-f0-9-]{36}\.webp$/);
  assert.notEqual(first, second);
  assert.throws(() =>
    createUserImageKey({ userId: "../another-user", kind: "profile", mimeType: "image/png" }),
  );
});
