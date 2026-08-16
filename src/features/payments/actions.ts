"use server";

import { revalidatePath } from "next/cache";

import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";

import {
  PaymentAuthorizationError,
  PaymentConfigurationError,
  PaymentNotFoundError,
  PaymentProviderError,
  PaymentValidationError,
  PaymentVerificationError,
  SubscriptionPaymentError,
} from "./errors";
import {
  initializeBillingTestPayment,
  verifyPaymentByReference,
} from "./service";
import {
  cancelRecurringSubscription,
  initializeRecurringSubscription,
} from "./recurring-subscriptions";
import type { PaymentActionState } from "./types";

function safePaymentError(error: unknown): PaymentActionState {
  if (
    error instanceof PaymentAuthorizationError ||
    error instanceof WorkspaceAuthorizationError
  ) {
    return { message: "You are not authorized to manage this payment." };
  }
  if (
    error instanceof PaymentValidationError ||
    error instanceof PaymentNotFoundError
  ) {
    return { message: "This payment reference is not valid for this workspace." };
  }
  if (error instanceof PaymentVerificationError) {
    return { message: "Paystack verification did not match CIV's payment record." };
  }
  if (
    error instanceof PaymentConfigurationError ||
    error instanceof PaymentProviderError
  ) {
    return { message: "The Paystack test service is temporarily unavailable." };
  }
  if (error instanceof SubscriptionPaymentError) {
    const messages = {
      PLAN_UNAVAILABLE: "This plan is not available for self-service subscription.",
      PLAN_NOT_RECURRING: "This plan does not use recurring billing.",
      PLAN_MAPPING_MISSING: "This plan is not yet connected to a Paystack Test recurring plan.",
      ACTIVE_SUBSCRIPTION: "Cancel the current recurring subscription before starting another paid plan. CIV does not apply unsupported mid-cycle proration.",
      CHANGE_IN_PROGRESS: "A subscription checkout is already in progress.",
      FULFILLMENT_MISMATCH: "Paystack verification did not match the intended subscription.",
      SUBSCRIPTION_UNAVAILABLE: "This subscription payment is not available.",
      CANCELLATION_UNAVAILABLE: "This subscription cannot currently be cancelled through CIV.",
      DOWNGRADE_BLOCKED: "Current workspace usage exceeds this plan's limits.",
    } as const;
    return { message: messages[error.reason] };
  }
  return { message: "The payment request could not be completed." };
}

export async function initializeRecurringSubscriptionAction(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _previous;
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_SUBSCRIPTION);
    if (!context.user.email) throw new PaymentValidationError();
    const result = await initializeRecurringSubscription({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      email: context.user.email,
      planCode: formData.get("planCode"),
    });
    revalidatePath("/app");
    revalidatePath("/app/settings/plan");
    revalidatePath("/app/settings/billing");
    return {
      success: true,
      message: result.reused
        ? "Your existing card-only Paystack Test subscription checkout is ready."
        : "Card-only Paystack Test subscription checkout initialized. The plan changes only after verified payment.",
      authorizationUrl:
        "authorizationUrl" in result ? result.authorizationUrl : undefined,
      reference: result.reference,
    };
  } catch (error) {
    return safePaymentError(error);
  }
}

export async function cancelRecurringSubscriptionAction(
  _previous: PaymentActionState,
  _formData: FormData,
): Promise<PaymentActionState> {
  void _previous;
  void _formData;
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_SUBSCRIPTION);
    const result = await cancelRecurringSubscription({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
    });
    revalidatePath("/app");
    revalidatePath("/app/settings/plan");
    revalidatePath("/app/settings/billing");
    revalidatePath("/app/activity");
    return {
      success: true,
      message: result.idempotent
        ? "This subscription is already scheduled to end."
        : `The recurring subscription will end at the close of the current billing period on ${result.effectiveAt.toLocaleDateString("en-GH")}.`,
    };
  } catch (error) {
    return safePaymentError(error);
  }
}

export async function initializeBillingTestPaymentAction(
  _previous: PaymentActionState,
  _formData: FormData,
): Promise<PaymentActionState> {
  void _previous;
  void _formData;
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_SUBSCRIPTION);
    if (!context.user.email) throw new PaymentValidationError();
    const result = await initializeBillingTestPayment({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      email: context.user.email,
    });
    revalidatePath("/app/settings/billing");
    return {
      success: true,
      message: "Paystack Test checkout initialized. No CIV entitlement was granted.",
      authorizationUrl: result.authorizationUrl,
      reference: result.reference,
    };
  } catch (error) {
    return safePaymentError(error);
  }
}

export async function verifyPaymentAction(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _previous;
  try {
    const context = await requireCapability(CAPABILITIES.VIEW_SUBSCRIPTION);
    const result = await verifyPaymentByReference(formData.get("reference"), {
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
    });
    revalidatePath("/app/settings/billing");
    revalidatePath("/app/settings/billing/payment-return");
    revalidatePath("/app/settings/credits");
    revalidatePath("/app/settings/plan");
    revalidatePath("/app");
    revalidatePath("/app/activity");
    return {
      success: true,
      status: result.status,
      message:
        result.status === "SUCCEEDED" &&
        result.fulfillment?.credits !== undefined
          ? `${result.fulfillment.credits.toLocaleString("en-GH")} document credits are now available in this workspace.`
          : result.status === "SUCCEEDED" &&
              result.fulfillment?.kind === "SUBSCRIPTION"
            ? `${result.fulfillment.planCode ?? "Paid"} subscription activated for this workspace.`
          : result.status === "SUCCEEDED"
            ? "Payment verified in Paystack Test Mode. This payment has no entitlement."
          : `Paystack reports this payment as ${result.status.toLowerCase()}.`,
    };
  } catch (error) {
    return safePaymentError(error);
  }
}
