import assert from "node:assert/strict";
import test from "node:test";

import {
  signatureFileConstraints,
  validateSignatureDimensions,
  validateSignatureFileDescriptor,
} from "./signature";
import { displayNameSchema, passwordUpdateSchema } from "./validation";

test("display names are trimmed and blank names are rejected", () => {
  assert.equal(displayNameSchema.parse({ name: "  Ama Mensah  " }).name, "Ama Mensah");
  assert.equal(displayNameSchema.safeParse({ name: "   " }).success, false);
});

test("password validation preserves length policy and confirmation", () => {
  assert.equal(
    passwordUpdateSchema.safeParse({
      newPassword: "eight888",
      confirmPassword: "eight888",
    }).success,
    true,
  );
  assert.equal(
    passwordUpdateSchema.safeParse({
      newPassword: "short",
      confirmPassword: "short",
    }).success,
    false,
  );
  assert.equal(
    passwordUpdateSchema.safeParse({
      newPassword: "eight888",
      confirmPassword: "different",
    }).success,
    false,
  );
});

test("signature uploads accept only bounded raster images", () => {
  for (const type of signatureFileConstraints.allowedMimeTypes) {
    assert.equal(validateSignatureFileDescriptor({ type, size: 100_000 }), null);
  }
  assert.match(
    validateSignatureFileDescriptor({ type: "image/svg+xml", size: 100_000 }) ?? "",
    /SVG/,
  );
  assert.notEqual(
    validateSignatureFileDescriptor({ type: "image/png", size: 2_000_000 }),
    null,
  );
});

test("signature dimensions reject tiny and unreasonable images", () => {
  assert.equal(validateSignatureDimensions(1200, 360), null);
  assert.notEqual(validateSignatureDimensions(16, 8), null);
  assert.notEqual(validateSignatureDimensions(5000, 300), null);
});
