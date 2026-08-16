"use client";

import { useActionState } from "react";

import { acquireDocumentCreditsAction } from "@/features/commercial/actions";
import { initialCommercialFormState } from "@/features/commercial/types";

export function DocumentCreditPurchaseRetry({ purchaseId }: { purchaseId: string }) {
  const [state, action, pending] = useActionState(
    acquireDocumentCreditsAction,
    initialCommercialFormState,
  );
  return (
    <form action={action}>
      <input type="hidden" name="purchaseId" value={purchaseId} />
      <button disabled={pending} className="min-h-10 rounded-lg border border-civ-blue px-3 text-xs font-semibold text-link disabled:opacity-60">
        {pending ? "Connecting…" : "Retry payment"}
      </button>
      {state.message ? <p role="status" className={`mt-2 max-w-xs text-xs ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
      {state.authorizationUrl ? <a href={state.authorizationUrl} className="mt-2 inline-flex min-h-10 items-center rounded-lg bg-civ-blue px-3 text-xs font-semibold text-white">Continue checkout</a> : null}
    </form>
  );
}
