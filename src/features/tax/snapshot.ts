import type { TrustedTaxCalculation, TrustedTaxVersion } from "./types";

export function buildTaxSnapshot(version: TrustedTaxVersion, calculation: TrustedTaxCalculation) {
  return {
    profile: { jurisdiction: version.profile.jurisdiction, code: version.profile.code, name: version.profile.name },
    version: { id: version.id, code: version.version, effectiveFrom: version.effectiveFrom.toISOString().slice(0, 10), effectiveTo: version.effectiveTo?.toISOString().slice(0, 10) ?? null },
    base: calculation.base,
    taxableValue: calculation.taxableValue,
    taxTotal: calculation.taxTotal,
    grossTotal: calculation.grossTotal,
    components: calculation.components.map((component) => ({ code: component.code, name: component.name, rate: component.rate, order: component.calculationOrder, baseStrategy: component.baseStrategy, calculationBase: component.calculationBase, amount: component.amount })),
  } as const;
}
