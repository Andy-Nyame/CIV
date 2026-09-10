import assert from "node:assert/strict";
import test from "node:test";

import { validateDatabaseEnvironment } from "./database-environment";

const developmentEnvironment: NodeJS.ProcessEnv = {
  APP_ENV: "development",
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://civ:secret@ep-civ-dev-pooler.eu.neon.tech/civ?sslmode=require",
  DIRECT_URL: "postgresql://civ:secret@ep-civ-dev.eu.neon.tech/civ?sslmode=require",
};

test("development database guard accepts matching TLS-protected Neon endpoints", () => {
  assert.deepEqual(validateDatabaseEnvironment("development", developmentEnvironment), []);
});

test("development database guard fails closed for production and mismatched targets", () => {
  assert.ok(validateDatabaseEnvironment("development", {
    ...developmentEnvironment,
    NODE_ENV: "production",
  }).some((error) => error.includes("NODE_ENV=production")));

  assert.ok(validateDatabaseEnvironment("development", {
    ...developmentEnvironment,
    DIRECT_URL: "postgresql://civ:secret@ep-civ-production.eu.neon.tech/civ?sslmode=require",
  }).length > 0);

  assert.ok(validateDatabaseEnvironment("development", {
    ...developmentEnvironment,
    DIRECT_URL: "postgresql://civ:secret@ep-civ-dev.eu.neon.tech/civ",
  }).some((error) => error.includes("require TLS")));

  assert.ok(validateDatabaseEnvironment("development", {
    ...developmentEnvironment,
    CIV_EXPECTED_DATABASE_HOST: "ep-another-dev.eu.neon.tech",
  }).some((error) => error.includes("CIV_EXPECTED_DATABASE_HOST")));

  assert.ok(validateDatabaseEnvironment("development", {
    ...developmentEnvironment,
    CIV_PRODUCTION_DATABASE_HOST: "ep-civ-dev.eu.neon.tech",
  }).some((error) => error.includes("CIV_PRODUCTION_DATABASE_HOST")));
});
