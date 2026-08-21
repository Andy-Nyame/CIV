import type { TaxCalculationBase } from "@/generated/prisma/enums";

export type TrustedTaxComponent = {
  code: string;
  name: string;
  rate: string;
  calculationOrder: number;
  baseStrategy: TaxCalculationBase;
  contributesToTaxableValue: boolean;
  contributesToTotal: boolean;
};

export type TaxComponentResult = TrustedTaxComponent & {
  calculationBase: string;
  amount: string;
};

export type TrustedTaxCalculation = {
  base: string;
  taxableValue: string;
  taxTotal: string;
  grossTotal: string;
  components: TaxComponentResult[];
};

export type TrustedTaxVersion = {
  id: string;
  version: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  profile: { jurisdiction: string; code: string; name: string };
  components: TrustedTaxComponent[];
};
