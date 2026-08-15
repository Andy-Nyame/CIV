import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  Prisma,
  PrismaClient,
  RateScope,
  RateType,
} from "../src/generated/prisma/client";

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

type SeedPlan = {
  code: string;
  name: string;
  description: string;
  memberLimit: number | null;
  documentLimit: number | null;
  sortOrder: number;
  features: Prisma.InputJsonValue;
};

const betaPlans: SeedPlan[] = [
  {
    code: "FREE",
    name: "Free",
    description: "CIV essentials for an individual workspace.",
    memberLimit: 1,
    documentLimit: 50,
    sortOrder: 10,
    features: { betaAccess: true },
  },
  {
    code: "STARTER",
    name: "Starter",
    description: "A small workspace for getting started with CIV.",
    memberLimit: 3,
    documentLimit: 500,
    sortOrder: 20,
    features: { betaAccess: true },
  },
  {
    code: "BUSINESS",
    name: "Business",
    description: "A growing business workspace with a larger team allowance.",
    memberLimit: 10,
    documentLimit: 5_000,
    sortOrder: 30,
    features: { betaAccess: true },
  },
  {
    code: "PRO",
    name: "Pro",
    description: "A high-capacity CIV workspace for larger teams.",
    memberLimit: 30,
    documentLimit: 25_000,
    sortOrder: 40,
    features: { betaAccess: true },
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Custom CIV limits for enterprise workspaces.",
    memberLimit: null,
    documentLimit: null,
    sortOrder: 50,
    features: { betaAccess: true, customLimits: true },
  },
];

const betaCreditPacks = [
  {
    code: "CREDITS_100",
    name: "100 Document Credits",
    description: "A small carry-forward document credit pack.",
    creditAmount: 100,
    sortOrder: 10,
  },
  {
    code: "CREDITS_500",
    name: "500 Document Credits",
    description: "Carry-forward capacity for growing document needs.",
    creditAmount: 500,
    sortOrder: 20,
  },
  {
    code: "CREDITS_1000",
    name: "1,000 Document Credits",
    description: "A larger carry-forward document credit pack.",
    creditAmount: 1_000,
    sortOrder: 30,
  },
  {
    code: "CREDITS_5000",
    name: "5,000 Document Credits",
    description: "High-capacity carry-forward document credits.",
    creditAmount: 5_000,
    sortOrder: 40,
  },
] as const;

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
    for (const plan of betaPlans) {
      await transaction.plan.upsert({
        where: { code: plan.code },
        // Platform-managed commercial configuration must survive repeat seeds.
        update: {},
        create: {
          ...plan,
          betaPrice: "0.0000",
          currency: "GHS",
          isPublic: true,
          isActive: true,
          isAvailableForNewWorkspaces: true,
        },
      });
    }

    for (const pack of betaCreditPacks) {
      await transaction.documentCreditPack.upsert({
        where: { code: pack.code },
        update: {},
        create: {
          ...pack,
          price: "0.0000",
          currency: "GHS",
          isActive: true,
          isPublic: true,
        },
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
        enabled: true,
        trialPlanId: businessPlan.id,
        durationDays: 14,
        fallbackPlanId: freePlan.id,
        newWorkspacesOnly: true,
        oneTrialPerWorkspace: true,
        paymentMethodRequired: false,
        allowManualGrant: true,
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
