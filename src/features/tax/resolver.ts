import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { assertGhanaVatStructure } from "./calculation";
import type { TrustedTaxVersion } from "./types";

type TaxClient = Prisma.TransactionClient | typeof db;

export function businessDate(value: string | Date) {
  if (value instanceof Date) return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid business date.");
  return new Date(`${value}T00:00:00.000Z`);
}

export async function resolveGhanaVatVersion(dateInput: string | Date, client: TaxClient = db): Promise<TrustedTaxVersion> {
  const date = businessDate(dateInput);
  const version = await client.taxVersion.findFirst({
    where: {
      taxProfile: { jurisdiction: "GH", code: "STANDARD_VAT" },
      isActive: true,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    include: { taxProfile: true, components: { orderBy: [{ calculationOrder: "asc" }, { code: "asc" }] } },
  });
  if (!version) throw new Error("No trusted Ghana VAT version applies to this document date.");
  const components = version.components.map((component) => ({ code: component.code, name: component.name, rate: component.rate.toString(), calculationOrder: component.calculationOrder, baseStrategy: component.baseStrategy, contributesToTaxableValue: component.contributesToTaxableValue, contributesToTotal: component.contributesToTotal }));
  assertGhanaVatStructure(components);
  return { id: version.id, version: version.version, effectiveFrom: version.effectiveFrom, effectiveTo: version.effectiveTo, profile: { jurisdiction: version.taxProfile.jurisdiction, code: version.taxProfile.code, name: version.taxProfile.name }, components };
}
