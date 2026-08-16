import "server-only";

import { recordPlatformAuditEvent } from "@/features/platform-team/audit";
import { db } from "@/lib/db";

import { requireCommercialCatalogManager } from "./authorization";
import { CommercialConfigurationError, CommercialValidationError } from "./errors";
import {
  commercialTransactionOptions,
  lockCommercialCatalog,
} from "./locking";
import {
  creditPackConfigurationSchema,
  creditPackUpdateSchema,
  planConfigurationSchema,
} from "./validation";

function changedFields(before: object, after: object) {
  return Object.keys(after).filter((key) => {
    const previous = Reflect.get(before, key) as unknown;
    const next = Reflect.get(after, key) as unknown;
    if (key === "betaPrice" || key === "monthlyPrice" || key === "price") {
      return Number(previous) !== Number(next);
    }
    return String(previous ?? "") !== String(next ?? "");
  });
}

export async function updatePlanConfiguration(input: {
  actorUserId: string;
  configuration: unknown;
}) {
  const parsed = planConfigurationSchema.safeParse(input.configuration);
  if (!parsed.success) {
    throw new CommercialValidationError(parsed.error.flatten().fieldErrors);
  }
  return db.$transaction(async (transaction) => {
    await lockCommercialCatalog(transaction);
    await requireCommercialCatalogManager(transaction, input.actorUserId);
    const existing = await transaction.plan.findUnique({
      where: { code: parsed.data.code },
    });
    if (!existing) throw new CommercialConfigurationError();
    const billingMode = parsed.data.billingMode ?? existing.billingMode;
    const monthlyPrice = parsed.data.monthlyPrice ?? existing.monthlyPrice.toString();
    const paystackPlanCode =
      parsed.data.paystackPlanCode === undefined
        ? existing.paystackPlanCode
        : parsed.data.paystackPlanCode;
    const recurringValid =
      billingMode !== "RECURRING" ||
      (Number(monthlyPrice) > 0 &&
        parsed.data.currency === "GHS" &&
        paystackPlanCode !== null);
    const nonRecurringValid =
      billingMode === "RECURRING" ||
      (Number(monthlyPrice) === 0 && paystackPlanCode === null);
    if (!recurringValid || !nonRecurringValid) {
      throw new CommercialValidationError({
        billingMode: [
          "Recurring plans require a positive GHS monthly price and Paystack Test plan code; Free/Custom plans must not have recurring provider mapping.",
        ],
      });
    }
    const data = {
      name: parsed.data.name,
      description: parsed.data.description,
      memberLimit: parsed.data.memberLimit,
      documentLimit: parsed.data.documentLimit,
      betaPrice: parsed.data.betaPrice,
      monthlyPrice,
      currency: parsed.data.currency,
      billingMode,
      paystackPlanCode,
      isActive: parsed.data.isActive,
      isPublic: parsed.data.isPublic,
      isAvailableForNewWorkspaces: parsed.data.isAvailableForNewWorkspaces,
      sortOrder: parsed.data.sortOrder,
    };
    const fields = changedFields(existing, data);
    if (fields.length === 0) return { plan: existing, changedFields: fields };
    const plan = await transaction.plan.update({
      where: { id: existing.id },
      data,
    });
    if (fields.includes("documentLimit")) {
      const now = new Date();
      await transaction.workspaceDocumentAllowancePeriod.updateMany({
        where: {
          planId: plan.id,
          periodStart: { lte: now },
          periodEnd: { gt: now },
          workspace: {
            trials: {
              none: { status: "ACTIVE", endsAt: { gt: now } },
            },
          },
        },
        data: { allowance: plan.documentLimit },
      });
    }
    await recordPlatformAuditEvent(transaction, {
      actorUserId: input.actorUserId,
      action: "PLATFORM_PLAN_UPDATED",
      resourceType: "PLAN",
      resourceId: plan.id,
      metadata: { planCode: plan.code, changedFields: fields },
    });
    return { plan, changedFields: fields };
  }, commercialTransactionOptions);
}

export async function createDocumentCreditPack(input: {
  actorUserId: string;
  configuration: unknown;
}) {
  const parsed = creditPackConfigurationSchema.safeParse(input.configuration);
  if (!parsed.success) {
    throw new CommercialValidationError(parsed.error.flatten().fieldErrors);
  }
  return db.$transaction(async (transaction) => {
    await lockCommercialCatalog(transaction);
    await requireCommercialCatalogManager(transaction, input.actorUserId);
    const pack = await transaction.documentCreditPack.create({
      data: parsed.data,
    });
    await recordPlatformAuditEvent(transaction, {
      actorUserId: input.actorUserId,
      action: "PLATFORM_CREDIT_PACK_CREATED",
      resourceType: "DOCUMENT_CREDIT_PACK",
      resourceId: pack.id,
      metadata: { packCode: pack.code, credits: pack.creditAmount },
    });
    return pack;
  }, commercialTransactionOptions);
}

export async function updateDocumentCreditPack(input: {
  actorUserId: string;
  configuration: unknown;
}) {
  const parsed = creditPackUpdateSchema.safeParse(input.configuration);
  if (!parsed.success) {
    throw new CommercialValidationError(parsed.error.flatten().fieldErrors);
  }
  return db.$transaction(async (transaction) => {
    await lockCommercialCatalog(transaction);
    await requireCommercialCatalogManager(transaction, input.actorUserId);
    const existing = await transaction.documentCreditPack.findUnique({
      where: { id: parsed.data.id },
    });
    if (!existing || existing.code !== parsed.data.code) {
      throw new CommercialConfigurationError();
    }
    const data = {
      name: parsed.data.name,
      description: parsed.data.description,
      creditAmount: parsed.data.creditAmount,
      price: parsed.data.price,
      currency: parsed.data.currency,
      isActive: parsed.data.isActive,
      isPublic: parsed.data.isPublic,
      sortOrder: parsed.data.sortOrder,
    };
    const fields = changedFields(existing, data);
    if (fields.length === 0) return { pack: existing, changedFields: fields };
    const pack = await transaction.documentCreditPack.update({
      where: { id: existing.id },
      data,
    });
    const nonActivationFields = fields.filter((field) => field !== "isActive");
    if (nonActivationFields.length > 0) {
      await recordPlatformAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "PLATFORM_CREDIT_PACK_UPDATED",
        resourceType: "DOCUMENT_CREDIT_PACK",
        resourceId: pack.id,
        metadata: { packCode: pack.code, changedFields: nonActivationFields },
      });
    }
    if (fields.includes("isActive")) {
      await recordPlatformAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: pack.isActive
          ? "PLATFORM_CREDIT_PACK_ACTIVATED"
          : "PLATFORM_CREDIT_PACK_DEACTIVATED",
        resourceType: "DOCUMENT_CREDIT_PACK",
        resourceId: pack.id,
        metadata: { packCode: pack.code },
      });
    }
    return { pack, changedFields: fields };
  }, commercialTransactionOptions);
}
