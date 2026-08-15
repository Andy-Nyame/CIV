import { PaymentValidationError } from "./errors";

const MINOR_UNITS = { GHS: 2 } as const;

export type SupportedPaymentCurrency = keyof typeof MINOR_UNITS;

export function toMinorUnits(
  amount: string | { toString(): string },
  currency: SupportedPaymentCurrency,
) {
  const value = amount.toString();
  const decimals = MINOR_UNITS[currency];
  const match = new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${decimals}}))?$`).exec(value);
  if (!match) throw new PaymentValidationError("Payment amount is invalid.");

  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  const minor =
    BigInt(match[1]) * BigInt(10) ** BigInt(decimals) +
    BigInt(fraction || "0");
  if (minor <= BigInt(0) || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PaymentValidationError("Payment amount is outside the supported range.");
  }
  return Number(minor);
}

export function minorUnitsToDecimalString(
  amountMinor: number,
  currency: SupportedPaymentCurrency,
) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new PaymentValidationError("Payment amount is invalid.");
  }
  const decimals = MINOR_UNITS[currency];
  const scale = 10 ** decimals;
  const whole = Math.floor(amountMinor / scale);
  const fraction = String(amountMinor % scale).padStart(decimals, "0");
  return `${whole}.${fraction}`;
}
