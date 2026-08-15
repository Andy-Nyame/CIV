import { readPaystackConfig } from "../src/features/payments/config";

const config = readPaystackConfig();
let response: Response;
try {
  response = await fetch(`${config.baseUrl}/transaction?perPage=1&page=1`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.secretKey}` },
    signal: AbortSignal.timeout(10_000),
  });
} catch {
  throw new Error("Paystack Test API connectivity check failed.");
}

let payload: unknown;
try {
  payload = await response.json();
} catch {
  throw new Error("Paystack Test API returned an invalid response.");
}

if (
  !response.ok ||
  !payload ||
  typeof payload !== "object" ||
  !("status" in payload) ||
  payload.status !== true
) {
  throw new Error("Paystack Test API rejected the configured credentials.");
}

console.log("PASS Paystack Test API configuration, reachability, and secret authentication");
