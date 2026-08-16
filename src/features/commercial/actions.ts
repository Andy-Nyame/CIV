"use server";

import { revalidatePath } from "next/cache";

import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformCapability } from "@/features/platform-admin/authorization";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { DocumentCreditPaymentError } from "@/features/payments/errors";
import { initializeDocumentCreditPurchase } from "@/features/payments/credit-purchases";
import { db } from "@/lib/db";

import { acquireBetaDocumentCredits } from "./acquisition";
import {
  CommercialAuthorizationError,
  CommercialConfigurationError,
  CommercialValidationError,
  CreditAcquisitionUnavailableError,
} from "./errors";
import {
  createDocumentCreditPack,
  updateDocumentCreditPack,
  updatePlanConfiguration,
} from "./platform-service";
import type { CommercialFormState } from "./types";

function checkbox(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function safeCommercialError(error: unknown): CommercialFormState {
  if (error instanceof CommercialValidationError) {
    return {
      message: "Check the highlighted commercial settings and try again.",
      fieldErrors: error.fieldErrors,
    };
  }
  if (error instanceof CreditAcquisitionUnavailableError) {
    return {
      message:
        error.reason === "ALREADY_ACQUIRED"
          ? "This beta credit pack has already been acquired for this workspace."
          : error.reason === "PAID"
            ? "This pack requires a future verified payment flow and cannot be acquired yet."
            : "This document credit pack is not currently available.",
    };
  }
  if (
    error instanceof CommercialAuthorizationError ||
    error instanceof CommercialConfigurationError
  ) {
    return { message: "You do not have access to this commercial action." };
  }
  if (error instanceof DocumentCreditPaymentError) {
    return {
      message:
        error.reason === "INITIALIZATION_IN_PROGRESS"
          ? "This checkout is already being initialized. Try again in a moment."
          : error.reason === "FREE_PACK"
            ? "This beta pack does not require a Paystack payment."
            : error.reason === "PACK_UNAVAILABLE"
              ? "This document credit pack is not currently available."
              : "This document credit purchase is not available for checkout.",
    };
  }
  return { message: "Unable to complete this commercial action right now." };
}

export async function updatePlanConfigurationAction(
  _previous: CommercialFormState,
  formData: FormData,
): Promise<CommercialFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_PLANS,
    );
    const result = await updatePlanConfiguration({
      actorUserId: context.user.id,
      configuration: {
        code: formData.get("code"),
        name: formData.get("name"),
        description: formData.get("description"),
        memberLimit: formData.get("memberLimit"),
        documentLimit: formData.get("documentLimit"),
        betaPrice: formData.get("betaPrice"),
        monthlyPrice: formData.get("monthlyPrice"),
        currency: formData.get("currency"),
        billingMode: formData.get("billingMode"),
        paystackPlanCode: formData.get("paystackPlanCode"),
        sortOrder: formData.get("sortOrder"),
        isActive: checkbox(formData, "isActive"),
        isPublic: checkbox(formData, "isPublic"),
        isAvailableForNewWorkspaces: checkbox(
          formData,
          "isAvailableForNewWorkspaces",
        ),
      },
    });
    revalidatePath("/civ-admin/plans");
    revalidatePath("/app/settings/plan");
    return {
      success: true,
      message: result.changedFields.length
        ? `${result.plan.name} was updated.`
        : "No plan changes were needed.",
    };
  } catch (error) {
    return safeCommercialError(error);
  }
}

function packConfiguration(formData: FormData) {
  return {
    code: formData.get("code"),
    name: formData.get("name"),
    description: formData.get("description"),
    creditAmount: formData.get("creditAmount"),
    price: formData.get("price"),
    currency: formData.get("currency"),
    sortOrder: formData.get("sortOrder"),
    isActive: checkbox(formData, "isActive"),
    isPublic: checkbox(formData, "isPublic"),
  };
}

export async function createCreditPackAction(
  _previous: CommercialFormState,
  formData: FormData,
): Promise<CommercialFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_PLANS,
    );
    const pack = await createDocumentCreditPack({
      actorUserId: context.user.id,
      configuration: packConfiguration(formData),
    });
    revalidatePath("/civ-admin/credits");
    return { success: true, message: `${pack.name} was created.` };
  } catch (error) {
    return safeCommercialError(error);
  }
}

export async function updateCreditPackAction(
  _previous: CommercialFormState,
  formData: FormData,
): Promise<CommercialFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_PLANS,
    );
    const result = await updateDocumentCreditPack({
      actorUserId: context.user.id,
      configuration: { id: formData.get("id"), ...packConfiguration(formData) },
    });
    revalidatePath("/civ-admin/credits");
    revalidatePath("/app/settings/credits");
    return {
      success: true,
      message: result.changedFields.length
        ? `${result.pack.name} was updated.`
        : "No credit-pack changes were needed.",
    };
  } catch (error) {
    return safeCommercialError(error);
  }
}

export async function acquireBetaCreditsAction(
  _previous: CommercialFormState,
  formData: FormData,
): Promise<CommercialFormState> {
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_SUBSCRIPTION);
    const result = await acquireBetaDocumentCredits({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      packCode: formData.get("packCode"),
    });
    revalidatePath("/app/settings/credits");
    revalidatePath("/app/activity");
    return {
      success: true,
      message: `${result.credits.toLocaleString("en-GH")} document credits added. New purchased balance: ${result.balance.toLocaleString("en-GH")}.`,
    };
  } catch (error) {
    return safeCommercialError(error);
  }
}

export async function acquireDocumentCreditsAction(
  _previous: CommercialFormState,
  formData: FormData,
): Promise<CommercialFormState> {
  void _previous;
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_SUBSCRIPTION);
    if (!context.user.email) {
      return { message: "A verified account email is required for checkout." };
    }
    const purchaseId = formData.get("purchaseId");
    const packCode = formData.get("packCode");
    if (!purchaseId) {
      const pack = await db.documentCreditPack.findUnique({
        where: { code: String(packCode ?? "").trim().toUpperCase() },
        select: { price: true },
      });
      if (pack?.price.equals(0)) {
        const result = await acquireBetaDocumentCredits({
          actorUserId: context.user.id,
          workspaceId: context.workspace.id,
          packCode,
        });
        revalidatePath("/app/settings/credits");
        revalidatePath("/app/activity");
        return {
          success: true,
          message: `${result.credits.toLocaleString("en-GH")} beta document credits added. New purchased balance: ${result.balance.toLocaleString("en-GH")}.`,
        };
      }
    }

    const result = await initializeDocumentCreditPurchase({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      email: context.user.email,
      ...(purchaseId ? { purchaseId } : { packCode }),
    });
    revalidatePath("/app/settings/credits");
    revalidatePath("/app/settings/billing");
    revalidatePath("/app/activity");
    if (result.kind === "ALREADY_SUCCEEDED") {
      return {
        success: true,
        message: "This purchase was already paid and its document credits are available.",
        reference: result.reference,
      };
    }
    return {
      success: true,
      message: result.reused
        ? "Your existing Paystack Test checkout is ready."
        : "Paystack Test checkout initialized. Credits will be added only after verified payment.",
      authorizationUrl: result.authorizationUrl,
      reference: result.reference,
    };
  } catch (error) {
    return safeCommercialError(error);
  }
}
