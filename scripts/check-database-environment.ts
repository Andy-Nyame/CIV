import "dotenv/config";

import { validateDatabaseEnvironment } from "./database-environment";

const expectedEnvironment = process.argv[2] as "development" | "production" | undefined;

if (!expectedEnvironment || !["development", "production"].includes(expectedEnvironment)) {
  console.error(
    "Usage: node --import tsx scripts/check-database-environment.ts <development|production>",
  );
  process.exit(1);
}

const errors = validateDatabaseEnvironment(expectedEnvironment);

if (errors.length > 0) {
  console.error("Database environment safety check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Database environment check passed for ${expectedEnvironment}: pooled runtime URL and direct administrative URL are configured.`,
);
