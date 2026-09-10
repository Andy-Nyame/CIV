import "dotenv/config";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { assertDatabaseEnvironment } from "./database-environment";

type MigrationRow = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

assertDatabaseEnvironment("development");

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsPath = path.join(repositoryRoot, "prisma", "migrations");
const entries = await readdir(migrationsPath, { withFileTypes: true });
const localNames = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const localChecksums = new Map<string, string>();

for (const name of localNames) {
  const sql = await readFile(path.join(migrationsPath, name, "migration.sql"));
  localChecksums.set(name, createHash("sha256").update(sql).digest("hex"));
}

const pool = new pg.Pool({
  connectionString: process.env.DIRECT_URL,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 1_000,
  query_timeout: 15_000,
});

try {
  const result = await pool.query<MigrationRow>(`
    SELECT migration_name, checksum, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    ORDER BY started_at
  `);
  const activeFailures = result.rows.filter(
    (row) => !row.finished_at && !row.rolled_back_at,
  );
  const successful = result.rows.filter(
    (row) => row.finished_at && !row.rolled_back_at,
  );
  const successfulByName = new Map(successful.map((row) => [row.migration_name, row]));
  const unapplied = localNames.filter((name) => !successfulByName.has(name));
  const missingLocally = successful.filter((row) => !localChecksums.has(row.migration_name));
  const checksumMismatches = successful.filter((row) => {
    const localChecksum = localChecksums.get(row.migration_name);
    return localChecksum !== undefined && localChecksum !== row.checksum;
  });

  if (activeFailures.length || unapplied.length || missingLocally.length || checksumMismatches.length) {
    const details = [
      ...activeFailures.map((row) => `failed/incomplete: ${row.migration_name}`),
      ...unapplied.map((name) => `not applied: ${name}`),
      ...missingLocally.map((row) => `missing locally: ${row.migration_name}`),
      ...checksumMismatches.map((row) => `checksum mismatch: ${row.migration_name}`),
    ];
    throw new Error(`Development migration state is not aligned:\n${details.join("\n")}`);
  }

  console.log(`Development migration state is aligned (${localNames.length} migrations).`);
} finally {
  await pool.end();
}
