"use server";

import { revalidatePath } from "next/cache";

import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformCapability } from "@/features/platform-admin/authorization";
import { PlatformAuthorizationError } from "@/features/platform-admin/errors";

import {
  PaymentAuthorizationError,
  PaymentProviderError,
  PaymentRefundError,
  PaymentVerificationError,
} from "./errors";
import {
  reconcilePaymentOperation,
  requestPaymentRefund,
} from "./refunds";
import type { PaymentActionState } from "./types";

function refundErrorMessage(error: unknown) {
  if (
    error instanceof PaymentAuthorizationError ||
    error instanceof PlatformAuthorizationError
  ) {
    return "You are not authorized to perform this payment operation.";
  }
  if (error instanceof PaymentRefundError) {
    const messages = {
      PAYMENT_UNAVAILABLE: "This payment is not available for refund.",
      PAYMENT_NOT_SUCCEEDED: "Only a successfully verified payment can be refunded.",
      PURPOSE_UNSUPPORTED: "This payment purpose does not support refunds.",
      AMOUNT_INVALID: "Enter a valid refund amount and a reason of at least 10 characters.",
      AMOUNT_EXCEEDS_REMAINING: "The refund exceeds the remaining refundable amount.",
      CURRENCY_MISMATCH: "The refund currency does not match the payment.",
      REFUND_IN_PROGRESS: "A refund for this payment is already in progress.",
      CREDIT_PARTIAL_UNSUPPORTED: "Document Credit packs use full-unused-pack refunds only.",
      CREDITS_ALREADY_USED: "This pack cannot be refunded because purchased credits have been used.",
      REFUND_UNAVAILABLE: "This refund cannot be completed safely.",
      PROVIDER_MISMATCH: "Paystack refund data did not match CIV's record.",
      RECONCILIATION_REVIEW_REQUIRED: "This payment needs manual provider review before CIV can reconcile it.",
    } as const;
    return messages[error.reason];
  }
  if (error instanceof PaymentVerificationError) {
    return "Provider state did not match CIV's financial record. Reconciliation review is required.";
  }
  if (error instanceof PaymentProviderError) {
    return "Paystack Test Mode could not confirm this operation. CIV retained it for safe reconciliation.";
  }
  return "The payment operation could not be completed.";
}

function refreshPaymentPages() {
  revalidatePath("/civ-admin/payments");
  revalidatePath("/civ-admin/activity");
  revalidatePath("/app/settings/billing");
  revalidatePath("/app/settings/credits");
  revalidatePath("/app/activity");
  revalidatePath("/app");
}

export async function requestPaymentRefundAction(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _previous;
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_PAYMENT_REFUNDS,
    );
    const result = await requestPaymentRefund({
      actorUserId: context.user.id,
      paymentId: formData.get("paymentId"),
      amount: formData.get("amount") || undefined,
      reason: formData.get("reason"),
    });
    refreshPaymentPages();
    return {
      success: true,
      message: result.existing
        ? "A refund for this payment is already being processed."
        : `Refund submitted to Paystack Test Mode. Current status: ${result.status?.toLowerCase() ?? "requested"}.`,
    };
  } catch (error) {
    return { message: refundErrorMessage(error) };
  }
}

export async function reconcilePaymentAction(
  _previous: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _previous;
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.RECONCILE_PAYMENTS,
    );
    const result = await reconcilePaymentOperation({
      actorUserId: context.user.id,
      paymentId: formData.get("paymentId"),
      refundId: formData.get("refundId") || undefined,
    });
    refreshPaymentPages();
    return {
      success: true,
      message: `Provider reconciliation completed: ${result.outcome.toLowerCase().replaceAll("_", " ")}.`,
    };
  } catch (error) {
    return { message: refundErrorMessage(error) };
  }
}
