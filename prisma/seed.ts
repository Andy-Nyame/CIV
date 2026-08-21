import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  Prisma,
  PrismaClient,
  RateScope,
  RateType,
} from "../src/generated/prisma/client";
import {
  CIV_DEFAULT_TRIAL_CONFIGURATION,
  CIV_DOCUMENT_CREDIT_PACK_CATALOG,
  CIV_PLAN_CATALOG,
} from "../src/features/commercial/catalog";

const connectionString = process.env.DIRECT_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL is required to seed the CIV database.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 15_000,
    timeout: 30_000,
  },
});

const ghanaTaxComponents = [
  {
    code: "NHIL",
    name: "National Health Insurance Levy",
    rate: "2.500000",
    calculationOrder: 10,
  },
  {
    code: "GETFUND",
    name: "GETFund Levy",
    rate: "2.500000",
    calculationOrder: 20,
  },
  {
    code: "VAT",
    name: "Value Added Tax",
    rate: "15.000000",
    calculationOrder: 30,
  },
] as const;

async function seed() {
  await prisma.$transaction(async (transaction) => {
    for (const plan of CIV_PLAN_CATALOG) {
      await transaction.plan.upsert({
        where: { code: plan.code },
        // Platform-managed commercial configuration must survive repeat seeds.
        update: {},
        create: { ...plan },
      });
    }

    for (const pack of CIV_DOCUMENT_CREDIT_PACK_CATALOG) {
      await transaction.documentCreditPack.upsert({
        where: { code: pack.code },
        update: {},
        create: { ...pack },
      });
    }

    const [businessPlan, freePlan] = await Promise.all([
      transaction.plan.findUniqueOrThrow({
        where: { code: "BUSINESS" },
        select: { id: true },
      }),
      transaction.plan.findUniqueOrThrow({
        where: { code: "FREE" },
        select: { id: true },
      }),
    ]);

    await transaction.trialConfiguration.upsert({
      where: { id: "GLOBAL" },
      // Platform-managed trial configuration must survive repeat seeds.
      update: {},
      create: {
        id: "GLOBAL",
        enabled: CIV_DEFAULT_TRIAL_CONFIGURATION.enabled,
        trialPlanId: businessPlan.id,
        durationDays: CIV_DEFAULT_TRIAL_CONFIGURATION.durationDays,
        fallbackPlanId: freePlan.id,
        newWorkspacesOnly:
          CIV_DEFAULT_TRIAL_CONFIGURATION.newWorkspacesOnly,
        oneTrialPerWorkspace:
          CIV_DEFAULT_TRIAL_CONFIGURATION.oneTrialPerWorkspace,
        paymentMethodRequired:
          CIV_DEFAULT_TRIAL_CONFIGURATION.paymentMethodRequired,
        allowManualGrant:
          CIV_DEFAULT_TRIAL_CONFIGURATION.allowManualGrant,
      },
    });

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

    const taxVersion = await transaction.taxVersion.upsert({
      where: {
        taxProfileId_version: {
          taxProfileId: taxProfile.id,
          version: "2026",
        },
      },
      update: {
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
        isActive: true,
      },
      create: {
        taxProfileId: taxProfile.id,
        version: "2026",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        isActive: true,
      },
    });

    for (const component of ghanaTaxComponents) {
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
        },
      });
    }
  });
}

seed()
  .then(() => {
    console.log("CIV database seed completed.");
  })
  .catch((error: unknown) => {
    console.error("CIV database seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
