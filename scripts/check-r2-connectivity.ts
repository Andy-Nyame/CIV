import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  deleteObject,
  getObject,
  objectExists,
  uploadObject,
} from "../src/lib/storage/object-storage";
import { readR2Config } from "../src/lib/storage/config";

const key = `civ-tests/connectivity/${randomUUID()}.txt`;
const expected = new TextEncoder().encode(`civ-r2-connectivity-${randomUUID()}`);

async function checkConnectivity() {
  try {
    await uploadObject({ key, body: expected, contentType: "text/plain" });
    assert.equal(await objectExists(key), true);

    const retrieved = await getObject(key);
    assert.deepEqual(retrieved.body, expected);

    const config = readR2Config();
    const unauthenticatedUrl = `${config.endpoint}/${config.bucketName}/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const unauthenticatedResponse = await fetch(unauthenticatedUrl);
    assert.equal(unauthenticatedResponse.ok, false);

    await deleteObject(key);
    assert.equal(await objectExists(key), false);
    console.log("PASS R2 private access, upload, retrieve, content verification, delete, and deletion confirmation");
  } finally {
    if (await objectExists(key).catch(() => false)) {
      await deleteObject(key);
    }
  }
}

try {
  await checkConnectivity();
} catch {
  console.error("FAIL R2 connectivity check. No credentials or endpoint details were printed.");
  process.exitCode = 1;
}
