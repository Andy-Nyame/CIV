"use client";

import { useActionState } from "react";

import { initializeBillingTestPaymentAction } from "@/features/payments/actions";
import { initialPaymentActionState } from "@/features/payments/types";

export function BillingTestControl() {
  const [state, action, pending] = useActionState(
    initializeBillingTestPaymentAction,
    initialPaymentActionState,
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-bold text-text">Infrastructure test checkout</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Initialize a GH₵1.00 Paystack Test transaction to validate the checkout connection. Completing it records payment status only—it cannot grant document credits or change a plan.
      </p>
      <form action={action} className="mt-5">
        <button
          disabled={pending}
          className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Connecting to Paystack…" : "Initialize Test Checkout"}
        </button>
      </form>
      {state.message ? (
        <p className={`mt-4 text-sm ${state.success ? "text-success" : "text-danger"}`} role="status" aria-live="polite">
          {state.message}
        </p>
      ) : null}
      {state.authorizationUrl ? (
        <a
          href={state.authorizationUrl}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-civ-blue px-4 py-3 text-sm font-semibold text-link hover:bg-hover"
        >
          Continue to Paystack Test Checkout
        </a>
      ) : null}
    </div>
  );
}
