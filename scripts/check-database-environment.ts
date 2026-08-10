import "dotenv/config";

type AppEnvironment = "development" | "production";

const expectedEnvironment = process.argv[2] as AppEnvironment | undefined;
const validEnvironments: AppEnvironment[] = ["development", "production"];

if (!expectedEnvironment || !validEnvironments.includes(expectedEnvironment)) {
  console.error(
    "Usage: node --import tsx scripts/check-database-environment.ts <development|production>",
  );
  process.exit(1);
}

const errors: string[] = [];
const appEnvironment = process.env.APP_ENV;

if (!validEnvironments.includes(appEnvironment as AppEnvironment)) {
  errors.push("APP_ENV must be set to development or production.");
} else if (appEnvironment !== expectedEnvironment) {
  errors.push(
    `APP_ENV is ${appEnvironment}; this command requires ${expectedEnvironment}.`,
  );
}

function parsePostgresUrl(name: "DATABASE_URL" | "DIRECT_URL") {
  const value = process.env[name];

  if (!value) {
    errors.push(`${name} is required.`);
    return undefined;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      errors.push(`${name} must be a PostgreSQL connection URL.`);
      return undefined;
    }

    return url;
  } catch {
    errors.push(`${name} must be a valid URL.`);
    return undefined;
  }
}

const runtimeUrl = parsePostgresUrl("DATABASE_URL");
const directUrl = parsePostgresUrl("DIRECT_URL");

if (runtimeUrl && !runtimeUrl.hostname.includes("-pooler")) {
  errors.push("DATABASE_URL must use the pooled Neon endpoint (-pooler host).");
}

if (directUrl?.hostname.includes("-pooler")) {
  errors.push("DIRECT_URL must use the direct Neon endpoint, not a pooler host.");
}

if (runtimeUrl && directUrl) {
  const runtimeBaseHost = runtimeUrl.hostname.replace("-pooler", "");

  if (runtimeBaseHost !== directUrl.hostname) {
    errors.push("DATABASE_URL and DIRECT_URL must target the same Neon endpoint.");
  }

  if (runtimeUrl.pathname !== directUrl.pathname) {
    errors.push("DATABASE_URL and DIRECT_URL must target the same database.");
  }

  if (runtimeUrl.username !== directUrl.username) {
    errors.push("DATABASE_URL and DIRECT_URL must use the same database role.");
  }
}

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
