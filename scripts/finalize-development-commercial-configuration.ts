import { createHash } from "node:crypto";

import {
  CIV_DEFAULT_TRIAL_CONFIGURATION,
  CIV_DOCUMENT_CREDIT_PACK_CATALOG,
  CIV_PLAN_CATALOG,
} from "@/features/commercial/catalog";
import {
  updateDocumentCreditPack,
  updatePlanConfiguration,
} from "@/features/commercial/platform-service";
import { readPaystackConfig } from "@/features/payments/config";
import { updateTrialConfiguration } from "@/features/trials/service";
import { db } from "@/lib/db";

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function acceptedStarterFingerprint() {
  const subscriptions = await db.subscription.findMany({
    where: { status: "ACTIVE", plan: { code: "STARTER" } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      workspaceId: true,
      planId: true,
      fallbackPlanId: true,
      pendingPlanId: true,
      status: true,
      provider: true,
      providerCustomerCode: true,
      providerSubscriptionCode: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      nextPaymentAt: true,
      lastPaymentAt: true,
      cancelAtPeriodEnd: true,
      startedAt: true,
      endsAt: true,
      billingPeriods: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          planId: true,
          status: true,
          providerInvoiceCode: true,
          providerTransactionReference: true,
          periodStart: true,
          periodEnd: true,
          amount: true,
          currency: true,
          paidAt: true,
          failedAt: true,
        },
      },
    },
  });
  return { count: subscriptions.length, fingerprint: fingerprint(subscriptions) };
}

async function main() {
  if (process.env.APP_ENV !== "development") {
    throw new Error("Commercial finalization is restricted to APP_ENV=development.");
  }
  readPaystackConfig();

  const owners = await db.platformMembership.findMany({
    where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    select: { userId: true },
    take: 2,
  });
  if (owners.length !== 1) {
    throw new Error("Exactly one active development Platform Owner is required.");
  }
  const actorUserId = owners[0].userId;
  const starterBefore = await acceptedStarterFingerprint();
  if (starterBefore.count !== 1) {
    throw new Error("The accepted development STARTER subscription is unavailable or ambiguous.");
  }

  const existingPlans = await db.plan.findMany({
    where: { code: { in: CIV_PLAN_CATALOG.map(({ code }) => code) } },
    select: { code: true, paystackPlanCode: true },
  });
  if (existingPlans.length !== CIV_PLAN_CATALOG.length) {
    throw new Error("The five CIV plans must exist before commercial finalization.");
  }
  const providerMappingsBefore = new Map(
    existingPlans.map(({ code, paystackPlanCode }) => [code, paystackPlanCode]),
  );

  for (const plan of CIV_PLAN_CATALOG) {
    const paystackPlanCode = providerMappingsBefore.get(plan.code) ?? null;
    if (plan.billingMode === "RECURRING" && !paystackPlanCode) {
      throw new Error(`Recurring ${plan.code} mapping is not configured.`);
    }
    await updatePlanConfiguration({
      actorUserId,
      configuration: {
        ...plan,
        paystackPlanCode:
          plan.billingMode === "RECURRING" ? paystackPlanCode : null,
      },
    });
  }

  for (const pack of CIV_DOCUMENT_CREDIT_PACK_CATALOG) {
    const existing = await db.documentCreditPack.findUnique({
      where: { code: pack.code },
      select: { id: true },
    });
    if (!existing) throw new Error(`Credit pack ${pack.code} is unavailable.`);
    await updateDocumentCreditPack({
      actorUserId,
      configuration: { id: existing.id, ...pack },
    });
  }

  await updateTrialConfiguration({
    actorUserId,
    configuration: CIV_DEFAULT_TRIAL_CONFIGURATION,
  });

  const [plansAfter, starterAfter] = await Promise.all([
    db.plan.findMany({
      where: { code: { in: CIV_PLAN_CATALOG.map(({ code }) => code) } },
      select: { code: true, paystackPlanCode: true },
    }),
    acceptedStarterFingerprint(),
  ]);
  for (const plan of plansAfter) {
    if (plan.paystackPlanCode !== providerMappingsBefore.get(plan.code)) {
      throw new Error("A Paystack plan mapping changed unexpectedly.");
    }
  }
  if (
    starterAfter.count !== starterBefore.count ||
    starterAfter.fingerprint !== starterBefore.fingerprint
  ) {
    throw new Error("The accepted STARTER subscription changed unexpectedly.");
  }

  console.log(
    "Development commercial configuration finalized; Paystack mappings and the accepted STARTER subscription were preserved.",
  );
}

main()
  .catch(() => {
    console.error("Development commercial configuration finalization failed safely.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
