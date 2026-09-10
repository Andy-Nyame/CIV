type AppEnvironment = "development" | "production";

const validEnvironments: AppEnvironment[] = ["development", "production"];

function parsePostgresUrl(
  name: "DATABASE_URL" | "DIRECT_URL",
  env: NodeJS.ProcessEnv,
  errors: string[],
) {
  const value = env[name];

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
    if (!url.hostname.endsWith(".neon.tech")) {
      errors.push(`${name} must target a Neon endpoint.`);
    }
    if (!["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) {
      errors.push(`${name} must require TLS with sslmode=require or sslmode=verify-full.`);
    }

    return url;
  } catch {
    errors.push(`${name} must be a valid URL.`);
    return undefined;
  }
}

export function validateDatabaseEnvironment(
  expectedEnvironment: AppEnvironment,
  env: NodeJS.ProcessEnv = process.env,
) {
  const errors: string[] = [];
  const appEnvironment = env.APP_ENV;

  if (!validEnvironments.includes(appEnvironment as AppEnvironment)) {
    errors.push("APP_ENV must be set to development or production.");
  } else if (appEnvironment !== expectedEnvironment) {
    errors.push(
      `APP_ENV is ${appEnvironment}; this command requires ${expectedEnvironment}.`,
    );
  }

  if (expectedEnvironment === "development" && env.NODE_ENV === "production") {
    errors.push("Development database commands cannot run with NODE_ENV=production.");
  }

  const runtimeUrl = parsePostgresUrl("DATABASE_URL", env, errors);
  const directUrl = parsePostgresUrl("DIRECT_URL", env, errors);

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

    const configuredHost = env.CIV_EXPECTED_DATABASE_HOST?.trim().toLowerCase();
    if (configuredHost && directUrl.hostname.toLowerCase() !== configuredHost) {
      errors.push("DIRECT_URL does not match CIV_EXPECTED_DATABASE_HOST.");
    }

    const productionHost = env.CIV_PRODUCTION_DATABASE_HOST?.trim().toLowerCase();
    if (
      expectedEnvironment === "development" &&
      productionHost &&
      directUrl.hostname.toLowerCase() === productionHost
    ) {
      errors.push("Development commands cannot target CIV_PRODUCTION_DATABASE_HOST.");
    }

    const targetText = `${directUrl.hostname}${directUrl.pathname}`;
    if (expectedEnvironment === "development" && /prod(uction)?/i.test(targetText)) {
      errors.push("Development commands refuse a database target marked as production.");
    }
    if (expectedEnvironment === "production" && /dev(elopment)?|test|preview/i.test(targetText)) {
      errors.push("Production commands refuse a database target marked as non-production.");
    }
  }

  return errors;
}

export function assertDatabaseEnvironment(
  expectedEnvironment: AppEnvironment,
  env: NodeJS.ProcessEnv = process.env,
) {
  const errors = validateDatabaseEnvironment(expectedEnvironment, env);
  if (errors.length) {
    throw new Error(
      `Database environment safety check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
}
