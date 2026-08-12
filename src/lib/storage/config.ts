import "server-only";

const REQUIRED_R2_ENVIRONMENT_VARIABLES = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "R2_REGION",
] as const;

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
  region: string;
};

export class StorageConfigurationError extends Error {
  constructor() {
    super("Private storage is not configured correctly.");
    this.name = "StorageConfigurationError";
  }
}

export function readR2Config(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): R2Config {
  if (REQUIRED_R2_ENVIRONMENT_VARIABLES.some((key) => !environment[key])) {
    throw new StorageConfigurationError();
  }

  const accountId = environment.R2_ACCOUNT_ID!;
  const endpoint = environment.R2_ENDPOINT!;
  let endpointUrl: URL;

  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new StorageConfigurationError();
  }

  const accountIdIsValid = /^[a-f0-9]{32}$/i.test(accountId);
  const endpointIsValid =
    endpointUrl.protocol === "https:" &&
    endpointUrl.username === "" &&
    endpointUrl.password === "" &&
    endpointUrl.pathname === "/" &&
    endpointUrl.search === "" &&
    endpointUrl.hash === "" &&
    endpointUrl.hostname.toLowerCase() ===
      `${accountId.toLowerCase()}.r2.cloudflarestorage.com`;

  if (
    !accountIdIsValid ||
    !endpointIsValid ||
    environment.R2_BUCKET_NAME !== "civ-private" ||
    environment.R2_REGION !== "auto"
  ) {
    throw new StorageConfigurationError();
  }

  return {
    accountId,
    accessKeyId: environment.R2_ACCESS_KEY_ID!,
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY!,
    bucketName: environment.R2_BUCKET_NAME!,
    endpoint: endpointUrl.origin,
    region: environment.R2_REGION!,
  };
}
