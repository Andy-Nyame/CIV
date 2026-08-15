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
} from "./errors";
import {
  initializeBillingTestPayment,
  verifyPaymentByReference,
} from "./service";
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
  return { message: "The payment request could not be completed." };
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
    return {
      success: true,
      status: result.status,
      message:
        result.status === "SUCCEEDED"
          ? "Payment verified in Paystack Test Mode. No entitlement was granted."
          : `Paystack reports this payment as ${result.status.toLowerCase()}.`,
    };
  } catch (error) {
    return safePaymentError(error);
  }
}
