import { Prisma } from "@/generated/prisma/client";

const ZERO = new Prisma.Decimal(0);
const MAX = new Prisma.Decimal("999999999999999.9999");
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

export type CalculatedLine = {
  description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal; rateTotal: Prisma.Decimal; lineTotal: Prisma.Decimal;
};

export function calculateDraftLine(input: { description: string; quantity: string; unitPrice: string; rate?: { type: "PERCENTAGE" | "FIXED"; value: string } | null }): CalculatedLine {
  const quantity = new Prisma.Decimal(input.quantity); const unitPrice = new Prisma.Decimal(input.unitPrice);
  if (!quantity.isFinite() || quantity.lte(0) || !unitPrice.isFinite() || unitPrice.lt(0)) throw new Error("Invalid line values.");
  const lineSubtotal = money(quantity.mul(unitPrice));
  const rateValue = input.rate ? new Prisma.Decimal(input.rate.value) : ZERO;
  if (!rateValue.isFinite() || rateValue.lt(0)) throw new Error("Invalid rate value.");
  const rateTotal = !input.rate ? ZERO : money(input.rate.type === "PERCENTAGE" ? lineSubtotal.mul(rateValue).div(100) : rateValue);
  const lineTotal = money(lineSubtotal.add(rateTotal));
  if (lineTotal.gt(MAX)) throw new Error("Line total exceeds supported range.");
  return { description: input.description, quantity, unitPrice, lineSubtotal, rateTotal, lineTotal };
}

export function calculateDraftTotals(lines: Array<Pick<CalculatedLine, "lineSubtotal" | "rateTotal" | "lineTotal">>) {
  const subtotal = money(lines.reduce((sum, line) => sum.add(line.lineSubtotal), ZERO));
  const rateTotal = money(lines.reduce((sum, line) => sum.add(line.rateTotal), ZERO));
  const grandTotal = money(lines.reduce((sum, line) => sum.add(line.lineTotal), ZERO));
  if (grandTotal.gt(MAX)) throw new Error("Document total exceeds supported range.");
  return { subtotal, discountTotal: ZERO, rateTotal, grandTotal };
}
