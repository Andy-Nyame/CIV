import {
  Prisma,
  RateScope,
  RateType,
} from "../../src/generated/prisma/client";

export const GHANA_VAT_2026_VERSION = "2026-ACT-1151";
export const GHANA_VAT_2026_EFFECTIVE_FROM = new Date(
  "2026-01-01T00:00:00.000Z",
);

export const GHANA_VAT_2026_COMPONENTS = [
  {
    code: "NHIL",
    name: "National Health Insurance Levy",
    rate: "2.500000",
    calculationOrder: 10,
    baseStrategy: "ORIGINAL_BASE",
    contributesToTaxableValue: false,
    contributesToTotal: true,
  },
  {
    code: "GETFUND",
    name: "GETFund Levy",
    rate: "2.500000",
    calculationOrder: 20,
    baseStrategy: "ORIGINAL_BASE",
    contributesToTaxableValue: false,
    contributesToTotal: true,
  },
  {
    code: "VAT",
    name: "Value Added Tax",
    rate: "15.000000",
    calculationOrder: 30,
    baseStrategy: "ORIGINAL_BASE",
    contributesToTaxableValue: false,
    contributesToTotal: true,
  },
] as const;

/**
 * Installs the corrected 2026 reference-data version without touching documents
 * or their immutable snapshots. The superseded, cascading `2026` version is
 * retained for historical document references but cannot be selected for new
 * calculations.
 */
export async function synchronizeGhanaVat2026ReferenceData(
  transaction: Prisma.TransactionClient,
) {
  const taxProfile = await transaction.taxProfile.upsert({
    where: {
      jurisdiction_code: {
        jurisdiction: "GH",
        code: "STANDARD_VAT",
      },
    },
    update: {
      name: "Ghana Standard VAT",
      description: "Versioned Ghana standard VAT profile for CIV.",
    },
    create: {
      jurisdiction: "GH",
      code: "STANDARD_VAT",
      name: "Ghana Standard VAT",
      description: "Versioned Ghana standard VAT profile for CIV.",
    },
  });

  await transaction.taxVersion.updateMany({
    where: {
      taxProfileId: taxProfile.id,
      version: "2026",
      isActive: true,
    },
    data: { isActive: false },
  });

  const taxVersion = await transaction.taxVersion.upsert({
    where: {
      taxProfileId_version: {
        taxProfileId: taxProfile.id,
        version: GHANA_VAT_2026_VERSION,
      },
    },
    update: {
      effectiveFrom: GHANA_VAT_2026_EFFECTIVE_FROM,
      effectiveTo: null,
      isActive: true,
    },
    create: {
      taxProfileId: taxProfile.id,
      version: GHANA_VAT_2026_VERSION,
      effectiveFrom: GHANA_VAT_2026_EFFECTIVE_FROM,
      isActive: true,
    },
  });

  await transaction.taxComponent.deleteMany({
    where: { taxVersionId: taxVersion.id, code: "COVID" },
  });

  for (const component of GHANA_VAT_2026_COMPONENTS) {
    await transaction.taxComponent.upsert({
      where: {
        taxVersionId_code: {
          taxVersionId: taxVersion.id,
          code: component.code,
        },
      },
      update: {
        name: component.name,
        type: RateType.PERCENTAGE,
        scope: RateScope.STATUTORY,
        rate: component.rate,
        calculationOrder: component.calculationOrder,
        baseStrategy: component.baseStrategy,
        contributesToTaxableValue: component.contributesToTaxableValue,
        contributesToTotal: component.contributesToTotal,
        baseReference: null,
        metadata: Prisma.JsonNull,
      },
      create: {
        taxVersionId: taxVersion.id,
        code: component.code,
        name: component.name,
        type: RateType.PERCENTAGE,
        scope: RateScope.STATUTORY,
        rate: component.rate,
        calculationOrder: component.calculationOrder,
        baseStrategy: component.baseStrategy,
        contributesToTaxableValue: component.contributesToTaxableValue,
        contributesToTotal: component.contributesToTotal,
      },
    });
  }

  return taxVersion;
}
