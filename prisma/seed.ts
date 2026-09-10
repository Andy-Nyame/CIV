import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
} from "../src/generated/prisma/client";
import { assertDatabaseEnvironment } from "../scripts/database-environment";
import {
  CIV_DEFAULT_TRIAL_CONFIGURATION,
  CIV_DOCUMENT_CREDIT_PACK_CATALOG,
  CIV_PLAN_CATALOG,
} from "../src/features/commercial/catalog";
import { synchronizeGhanaVat2026ReferenceData } from "./reference-data/ghana-vat-2026";

assertDatabaseEnvironment("development");

if (!process.argv.includes("--confirm-development-seed")) {
  throw new Error(
    "Development seed refused. Use the guarded npm run db:seed command.",
  );
}

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

    await synchronizeGhanaVat2026ReferenceData(transaction);
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
