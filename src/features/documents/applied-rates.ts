import type { IssuedDocumentSnapshot } from "@/features/documents/snapshots";

export type AppliedRateRow = {
  key: string;
  name: string;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  rateLabel: string;
  label: string;
  amount: string;
  source: "CUSTOM" | "STATUTORY";
};

type CustomRateInput = {
  key?: string;
  name: string | null;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  amount: string;
};

type StatutoryRateInput = {
  key?: string;
  code: string;
  name: string;
  rate: string;
  amount: string;
};

function trimDecimal(value: string) {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function addMoney(left: string, right: string) {
  const oneHundred = BigInt(100);
  const toMinorUnits = (value: string) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * oneHundred + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  };
  const total = toMinorUnits(left) + toMinorUnits(right);
  return `${total / oneHundred}.${(total % oneHundred).toString().padStart(2, "0")}`;
}

export function formatAppliedRateValue(input: {
  type: "PERCENTAGE" | "FIXED";
  value: string;
  currency: string;
}) {
  const value = trimDecimal(input.value);
  return input.type === "PERCENTAGE" ? `${value}%` : `${input.currency} ${value} fixed`;
}

export function formatAppliedRateLabel(input: {
  name: string | null;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  currency: string;
}) {
  return `${input.name?.trim() || "Custom rate"} (${formatAppliedRateValue(input)})`;
}

export function buildAppliedRateRows(input: {
  currency: string;
  customRates?: readonly CustomRateInput[];
  statutoryRates?: readonly StatutoryRateInput[];
}): AppliedRateRow[] {
  const customRows = new Map<string, AppliedRateRow>();

  for (const rate of input.customRates ?? []) {
    const name = rate.name?.trim() || "Custom rate";
    const value = trimDecimal(rate.value);
    const signature = `${name}\u0000${rate.type}\u0000${value}`;
    const existing = customRows.get(signature);
    if (existing) {
      existing.amount = addMoney(existing.amount, rate.amount);
      continue;
    }
    const rateLabel = formatAppliedRateValue({ type: rate.type, value, currency: input.currency });
    customRows.set(signature, {
      key: rate.key ?? `custom:${signature}`,
      name,
      type: rate.type,
      value,
      rateLabel,
      label: `${name} (${rateLabel})`,
      amount: rate.amount,
      source: "CUSTOM",
    });
  }

  const statutoryRows = (input.statutoryRates ?? []).map((rate, index): AppliedRateRow => {
    const value = trimDecimal(rate.rate);
    const rateLabel = formatAppliedRateValue({ type: "PERCENTAGE", value, currency: input.currency });
    return {
      key: rate.key ?? `statutory:${rate.code}:${index}`,
      name: rate.name,
      type: "PERCENTAGE",
      value,
      rateLabel,
      label: `${rate.name} (${rateLabel})`,
      amount: rate.amount,
      source: "STATUTORY",
    };
  });

  return [...customRows.values(), ...statutoryRows];
}

export function buildSnapshotAppliedRateRows(snapshot: IssuedDocumentSnapshot) {
  return buildAppliedRateRows({
    currency: snapshot.document.currency,
    customRates: snapshot.lines.flatMap((line) => line.customRate ? [{
      key: `line:${line.order}`,
      name: line.customRate.name,
      type: line.customRate.type,
      value: line.customRate.value,
      amount: line.customRate.amount,
    }] : []),
    statutoryRates: snapshot.tax?.components.map((component) => ({
      key: `tax:${component.code}`,
      code: component.code,
      name: component.name,
      rate: component.rate,
      amount: component.amount,
    })),
  });
}
