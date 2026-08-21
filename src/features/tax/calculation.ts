import { Prisma } from "@/generated/prisma/client";
import type { TrustedTaxCalculation, TrustedTaxComponent } from "./types";

const ZERO = new Prisma.Decimal(0);
const MAX = new Prisma.Decimal("999999999999999.99");
export const roundGhs = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export function calculateTrustedTax(baseInput: string | Prisma.Decimal, components: TrustedTaxComponent[]): TrustedTaxCalculation {
  const base = roundGhs(new Prisma.Decimal(baseInput));
  if (!base.isFinite() || base.lt(0) || base.gt(MAX)) throw new Error("Invalid taxable base.");
  let taxableLevies = ZERO;
  let totalTax = ZERO;
  const ordered = [...components].sort((a, b) => a.calculationOrder - b.calculationOrder);
  const seen = new Set<string>();
  const results = ordered.map((component) => {
    if (seen.has(component.code)) throw new Error("Duplicate tax component code.");
    seen.add(component.code);
    const rate = new Prisma.Decimal(component.rate);
    if (!rate.isFinite() || rate.lt(0) || rate.gt(100)) throw new Error("Invalid tax component rate.");
    const calculationBase = component.baseStrategy === "ORIGINAL_BASE" ? base : roundGhs(base.add(taxableLevies));
    const amount = roundGhs(calculationBase.mul(rate).div(100));
    if (component.contributesToTaxableValue) taxableLevies = roundGhs(taxableLevies.add(amount));
    if (component.contributesToTotal) totalTax = roundGhs(totalTax.add(amount));
    return { ...component, calculationBase: calculationBase.toFixed(2), amount: amount.toFixed(2) };
  });
  const taxableValue = roundGhs(base.add(taxableLevies));
  const grossTotal = roundGhs(base.add(totalTax));
  if (grossTotal.gt(MAX)) throw new Error("Tax calculation exceeds supported range.");
  return { base: base.toFixed(2), taxableValue: taxableValue.toFixed(2), taxTotal: totalTax.toFixed(2), grossTotal: grossTotal.toFixed(2), components: results };
}

export function assertGhanaVatStructure(components: TrustedTaxComponent[]) {
  const byCode = new Map(components.map((component) => [component.code, component]));
  const required = ["NHIL", "GETFUND", "VAT", "COVID"];
  if (required.some((code) => !byCode.has(code))) throw new Error("Ghana VAT configuration is incomplete.");
  if (byCode.get("NHIL")!.baseStrategy !== "ORIGINAL_BASE" || !byCode.get("NHIL")!.contributesToTaxableValue) throw new Error("NHIL configuration is invalid.");
  if (byCode.get("GETFUND")!.baseStrategy !== "ORIGINAL_BASE" || !byCode.get("GETFUND")!.contributesToTaxableValue) throw new Error("GETFund configuration is invalid.");
  if (byCode.get("VAT")!.baseStrategy !== "BASE_PLUS_APPLICABLE_LEVIES") throw new Error("VAT configuration is invalid.");
  if (!new Prisma.Decimal(byCode.get("NHIL")!.rate).eq("2.5") || !new Prisma.Decimal(byCode.get("GETFUND")!.rate).eq("2.5") || !new Prisma.Decimal(byCode.get("VAT")!.rate).eq("15") || !new Prisma.Decimal(byCode.get("COVID")!.rate).eq(0)) throw new Error("Ghana VAT rates do not match the approved trusted configuration.");
  if (!byCode.get("VAT")!.contributesToTotal || byCode.get("VAT")!.contributesToTaxableValue || !byCode.get("COVID")!.contributesToTotal) throw new Error("Ghana VAT contribution rules are invalid.");
  return components;
}
