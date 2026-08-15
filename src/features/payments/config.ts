import "server-only";

import { PaymentConfigurationError } from "./errors";

type PaymentEnvironment = Record<string, string | undefined>;

const PAYSTACK_ORIGIN = "https://api.paystack.co";

function parseExactOrigin(value: string | undefined) {
  if (!value) throw new PaymentConfigurationError();
  try {
    const url = new URL(value);
    if (
      url.origin !== PAYSTACK_ORIGIN ||
      url.pathname.replace(/\/$/, "") !== "" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new PaymentConfigurationError();
    }
    return url.origin;
  } catch (error) {
    if (error instanceof PaymentConfigurationError) throw error;
    throw new PaymentConfigurationError();
  }
}

function parseAppUrl(value: string | undefined, appEnv: string | undefined) {
  if (!value) throw new PaymentConfigurationError();
  try {
    const url = new URL(value);
    const localDevelopment =
      appEnv === "development" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname);
    if (
      (!localDevelopment && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new PaymentConfigurationError();
    }
    return url.origin;
  } catch (error) {
    if (error instanceof PaymentConfigurationError) throw error;
    throw new PaymentConfigurationError();
  }
}

export function readPaystackConfig(env: PaymentEnvironment = process.env) {
  const publicKey = env.PAYSTACK_PUBLIC_KEY;
  const secretKey = env.PAYSTACK_SECRET_KEY;
  const mode = env.PAYSTACK_MODE;

  if (
    mode !== "test" ||
    !publicKey?.startsWith("pk_test_") ||
    !secretKey?.startsWith("sk_test_") ||
    publicKey.startsWith("pk_live_") ||
    secretKey.startsWith("sk_live_")
  ) {
    throw new PaymentConfigurationError();
  }

  const baseUrl = parseExactOrigin(env.PAYSTACK_BASE_URL);
  const appUrl = parseAppUrl(env.APP_URL, env.APP_ENV);

  return {
    mode: "test" as const,
    publicKey,
    secretKey,
    baseUrl,
    appUrl,
    callbackUrl: `${appUrl}/app/settings/billing/payment-return`,
    webhookUrl: `${appUrl}/api/payments/paystack/webhook`,
  };
}
