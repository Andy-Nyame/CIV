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
  features: Prisma.InputJsonValue;
};

const betaPlans: SeedPlan[] = [
  {
    code: "FREE",
    name: "Free",
    description: "CIV essentials for an individual workspace.",
    memberLimit: 1,
    documentLimit: 50,
    features: { betaAccess: true },
  },
  {
    code: "STARTER",
    name: "Starter",
    description: "A small workspace for getting started with CIV.",
    memberLimit: 3,
    documentLimit: 500,
    features: { betaAccess: true },
  },
  {
    code: "BUSINESS",
    name: "Business",
    description: "A growing business workspace with a larger team allowance.",
    memberLimit: 10,
    documentLimit: 5_000,
    features: { betaAccess: true },
  },
  {
    code: "PRO",
    name: "Pro",
    description: "A high-capacity CIV workspace for larger teams.",
    memberLimit: 30,
    documentLimit: 25_000,
    features: { betaAccess: true },
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Custom CIV limits for enterprise workspaces.",
    memberLimit: null,
    documentLimit: null,
    features: { betaAccess: true, customLimits: true },
  },
];

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
        update: {
          name: plan.name,
          description: plan.description,
          betaPrice: "0.0000",
          currency: "GHS",
          memberLimit: plan.memberLimit,
          documentLimit: plan.documentLimit,
          isPublic: true,
          isActive: true,
          features: plan.features,
        },
        create: {
          ...plan,
          betaPrice: "0.0000",
          currency: "GHS",
          isPublic: true,
          isActive: true,
        },
      });
    }

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
