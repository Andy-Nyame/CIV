"use client";

import { useActionState } from "react";

import { verifyPaymentAction } from "@/features/payments/actions";
import { initialPaymentActionState } from "@/features/payments/types";

export function PaymentVerificationControl({ reference }: { reference: string }) {
  const [state, action, pending] = useActionState(
    verifyPaymentAction,
    initialPaymentActionState,
  );
  return (
    <form action={action} className="mt-5">
      <input type="hidden" name="reference" value={reference} />
      <button
        disabled={pending}
        className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Verifying…" : "Verify with Paystack"}
      </button>
      {state.message ? (
        <p className={`mt-3 text-sm ${state.success ? "text-success" : "text-danger"}`} role="status" aria-live="polite">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
