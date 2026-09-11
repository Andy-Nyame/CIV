import { Prisma } from "@/generated/prisma/client";
import type { TrustedTaxComponent } from "@/features/tax/types";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const MAX = new Prisma.Decimal("999999999999999.9999");

/**
 * CIV's canonical money policy is decimal arithmetic with ROUND_HALF_UP at the
 * currency boundary (two decimals). Inclusive-price residual cents are assigned
 * to the final statutory component so base + components always reconciles to
 * the entered inclusive amount. A future GRA adapter may replace that explicit
 * policy only when authoritative interface rules are available.
 */
export const roundMoney = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type GhanaTaxTreatment = "STANDARD_RATED" | "ZERO_RATED" | "EXEMPT";
export type TaxPriceMode = "TAX_EXCLUSIVE" | "TAX_INCLUSIVE";

export type CalculatedLine = {
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  originalAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
  taxableBase: Prisma.Decimal;
  rateTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  taxTreatment: GhanaTaxTreatment;
  reliefApplied: boolean;
  taxComponents: Array<TrustedTaxComponent & { calculationBase: string; amount: string }>;
};

export type CalculateDocumentLineInput = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  priceMode?: TaxPriceMode;
  taxTreatment?: GhanaTaxTreatment;
  reliefApplied?: boolean;
  supplierVatEligible?: boolean;
  statutoryComponents?: TrustedTaxComponent[];
  rate?: { type: "PERCENTAGE" | "FIXED"; value: string } | null;
};

function validateDecimal(value: Prisma.Decimal, message: string) {
  if (!value.isFinite() || value.lt(0) || value.gt(MAX)) throw new Error(message);
}

function calculateExclusiveComponents(base: Prisma.Decimal, components: TrustedTaxComponent[]) {
  return [...components]
    .sort((a, b) => a.calculationOrder - b.calculationOrder)
    .map((component) => ({
      ...component,
      calculationBase: base.toFixed(2),
      amount: roundMoney(base.mul(component.rate).div(HUNDRED)).toFixed(2),
    }));
}

function calculateInclusiveComponents(inclusive: Prisma.Decimal, components: TrustedTaxComponent[]) {
  const ordered = [...components].sort((a, b) => a.calculationOrder - b.calculationOrder);
  const totalRate = ordered
    .filter((component) => component.contributesToTotal)
    .reduce((sum, component) => sum.add(component.rate), ZERO);
  if (totalRate.lte(0)) return { base: inclusive, components: [] as CalculatedLine["taxComponents"] };
  const base = roundMoney(inclusive.div(new Prisma.Decimal(1).add(totalRate.div(HUNDRED))));
  const totalTax = roundMoney(inclusive.sub(base));
  let allocated = ZERO;
  const totalComponents = ordered.filter((component) => component.contributesToTotal);
  const lastTotalCode = totalComponents.at(-1)?.code;
  const calculated = ordered.map((component) => {
    const amount = component.code === lastTotalCode
      ? roundMoney(totalTax.sub(allocated))
      : roundMoney(base.mul(component.rate).div(HUNDRED));
    if (component.contributesToTotal) allocated = roundMoney(allocated.add(amount));
    return { ...component, calculationBase: base.toFixed(2), amount: amount.toFixed(2) };
  });
  return { base, components: calculated };
}

export function calculateDocumentLine(input: CalculateDocumentLineInput): CalculatedLine {
  const quantity = new Prisma.Decimal(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const discountAmount = roundMoney(new Prisma.Decimal(input.discountAmount ?? 0));
  if (!quantity.isFinite() || quantity.lte(0)) throw new Error("Invalid line quantity.");
  validateDecimal(unitPrice, "Invalid line price.");
  const originalAmount = roundMoney(quantity.mul(unitPrice));
  validateDecimal(discountAmount, "Invalid line discount.");
  if (discountAmount.gt(originalAmount)) throw new Error("A line discount cannot exceed its original amount.");

  const discountedEnteredAmount = roundMoney(originalAmount.sub(discountAmount));
  const taxTreatment = input.taxTreatment ?? "STANDARD_RATED";
  const reliefApplied = Boolean(input.reliefApplied);
  const appliesStatutoryTax = Boolean(
    input.supplierVatEligible &&
    taxTreatment === "STANDARD_RATED" &&
    !reliefApplied &&
    input.statutoryComponents?.length,
  );
  const priceMode = input.priceMode ?? "TAX_EXCLUSIVE";
  const inclusive = appliesStatutoryTax && priceMode === "TAX_INCLUSIVE"
    ? calculateInclusiveComponents(discountedEnteredAmount, input.statutoryComponents ?? [])
    : null;
  const lineSubtotal = inclusive?.base ?? discountedEnteredAmount;
  const taxComponents = appliesStatutoryTax
    ? inclusive?.components ?? calculateExclusiveComponents(lineSubtotal, input.statutoryComponents ?? [])
    : [];
  const taxTotal = roundMoney(taxComponents.reduce(
    (sum, component) => component.contributesToTotal ? sum.add(component.amount) : sum,
    ZERO,
  ));
  const taxableBase = appliesStatutoryTax ? lineSubtotal : ZERO;
  const rateValue = input.rate ? new Prisma.Decimal(input.rate.value) : ZERO;
  validateDecimal(rateValue, "Invalid custom rate value.");
  const rateTotal = !input.rate
    ? ZERO
    : roundMoney(input.rate.type === "PERCENTAGE"
      ? lineSubtotal.mul(rateValue).div(HUNDRED)
      : rateValue);
  const taxInclusiveValue = roundMoney(lineSubtotal.add(taxTotal));
  const lineTotal = roundMoney(taxInclusiveValue.add(rateTotal));
  if (lineTotal.gt(MAX)) throw new Error("Line total exceeds supported range.");

  return {
    description: input.description,
    quantity,
    unitPrice,
    originalAmount,
    discountAmount,
    lineSubtotal,
    taxableBase,
    rateTotal,
    taxTotal,
    lineTotal,
    taxTreatment,
    reliefApplied,
    taxComponents,
  };
}

/** Backward-compatible entry point used by existing custom-rate callers. */
export function calculateDraftLine(input: {
  description: string;
  quantity: string;
  unitPrice: string;
  rate?: { type: "PERCENTAGE" | "FIXED"; value: string } | null;
}): CalculatedLine {
  return calculateDocumentLine(input);
}

export function calculateDraftTotals(lines: Array<Pick<CalculatedLine,
  "originalAmount" | "discountAmount" | "lineSubtotal" | "taxableBase" |
  "rateTotal" | "taxTotal" | "lineTotal" | "taxTreatment" | "reliefApplied" | "taxComponents"
>>) {
  const sum = (field: "originalAmount" | "discountAmount" | "lineSubtotal" | "taxableBase" | "rateTotal" | "taxTotal" | "lineTotal") =>
    roundMoney(lines.reduce((total, line) => total.add(line[field]), ZERO));
  const category = (treatment: GhanaTaxTreatment, relieved = false) => roundMoney(lines.reduce(
    (total, line) => line.taxTreatment === treatment && line.reliefApplied === relieved
      ? total.add(line.lineSubtotal)
      : total,
    ZERO,
  ));
  const componentMap = new Map<string, CalculatedLine["taxComponents"][number] & { amountDecimal: Prisma.Decimal; baseDecimal: Prisma.Decimal }>();
  for (const line of lines) {
    for (const component of line.taxComponents) {
      const previous = componentMap.get(component.code);
      componentMap.set(component.code, {
        ...component,
        amountDecimal: roundMoney((previous?.amountDecimal ?? ZERO).add(component.amount)),
        baseDecimal: roundMoney((previous?.baseDecimal ?? ZERO).add(component.calculationBase)),
      });
    }
  }
  const subtotal = sum("lineSubtotal");
  const taxTotal = sum("taxTotal");
  const rateTotal = sum("rateTotal");
  const grandTotal = sum("lineTotal");
  if (grandTotal.gt(MAX)) throw new Error("Document total exceeds supported range.");
  return {
    originalAmount: sum("originalAmount"),
    subtotal,
    discountTotal: sum("discountAmount"),
    taxableValue: sum("taxableBase"),
    rateTotal,
    taxTotal,
    taxInclusiveValue: roundMoney(subtotal.add(taxTotal)),
    grandTotal,
    standardRatedValue: category("STANDARD_RATED"),
    zeroRatedValue: category("ZERO_RATED"),
    exemptValue: category("EXEMPT"),
    relievedValue: roundMoney(lines.reduce((total, line) => line.reliefApplied ? total.add(line.lineSubtotal) : total, ZERO)),
    taxComponents: [...componentMap.values()]
      .sort((a, b) => a.calculationOrder - b.calculationOrder)
      .map(({ amountDecimal, baseDecimal, ...component }) => ({
        ...component,
        calculationBase: baseDecimal.toFixed(2),
        amount: amountDecimal.toFixed(2),
      })),
  };
}

export function calculateNetPayable(grandTotal: Prisma.Decimal, withholdingApplied: boolean, withholdingAmountInput: string) {
  const withholdingAmount = roundMoney(new Prisma.Decimal(withholdingApplied ? withholdingAmountInput : 0));
  validateDecimal(withholdingAmount, "Invalid VAT withholding amount.");
  if (withholdingAmount.gt(grandTotal)) throw new Error("VAT withholding cannot exceed the gross document total.");
  return { withholdingAmount, netPayable: roundMoney(grandTotal.sub(withholdingAmount)) };
}

export function adjustmentEffect(type: "CREDIT_NOTE" | "DEBIT_NOTE", amount: Prisma.Decimal) {
  return type === "CREDIT_NOTE" ? amount.negated() : amount;
}
