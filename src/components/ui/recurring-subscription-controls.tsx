"use client";

import { useActionState, useState } from "react";

import {
  cancelRecurringSubscriptionAction,
  initializeRecurringSubscriptionAction,
} from "@/features/payments/actions";
import { initialPaymentActionState } from "@/features/payments/types";

export function RecurringCheckoutControl({
  planCode,
  planName,
  priceLabel,
}: {
  planCode: string;
  planName: string;
  priceLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    initializeRecurringSubscriptionAction,
    initialPaymentActionState,
  );

  if (!confirming && !state.authorizationUrl) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 w-full rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link hover:bg-hover"
      >
        Subscribe to {planName}
      </button>
    );
  }

  return (
    <div className="grid gap-3">
      {!state.authorizationUrl ? (
        <>
          <p className="text-sm leading-6 text-text">
            Start a card-only Paystack Test subscription to {planName} for {priceLabel} per month? CIV changes the plan only after server verification.
          </p>
          <form action={action} className="flex flex-wrap gap-2">
            <input type="hidden" name="planCode" value={planCode} />
            <button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70">
              {pending ? "Preparing checkout…" : "Continue to card checkout"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">
              Cancel
            </button>
          </form>
        </>
      ) : (
        <a href={state.authorizationUrl} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white hover:bg-civ-blue-hover">
          Open secure Paystack Test checkout
        </a>
      )}
      {state.message ? (
        <p role="status" aria-live="polite" className={`text-sm ${state.success ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function RecurringCancellationControl({
  planName,
  periodEnd,
}: {
  planName: string;
  periodEnd: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    cancelRecurringSubscriptionAction,
    initialPaymentActionState,
  );

  return (
    <div className="rounded-xl border border-danger/40 bg-surface p-5">
      <h2 className="font-bold text-text">End recurring subscription</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Cancel {planName} renewal? Access continues through {new Date(periodEnd).toLocaleDateString("en-GH")}, then the stored fallback plan applies. Workspace data and purchased credits stay intact.
      </p>
      {confirming ? (
        <form action={action} className="mt-4 flex flex-wrap gap-2">
          <button disabled={pending} className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? "Cancelling…" : "Confirm cancellation"}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">
            Keep subscription
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-4 min-h-11 rounded-lg border border-danger px-4 text-sm font-semibold text-danger">
          Cancel renewal
        </button>
      )}
      {state.message ? <p role="status" className={`mt-3 text-sm ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
    </div>
  );
}
