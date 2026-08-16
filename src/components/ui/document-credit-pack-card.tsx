"use client";

import { useActionState, useState } from "react";

import { acquireDocumentCreditsAction } from "@/features/commercial/actions";
import { initialCommercialFormState } from "@/features/commercial/types";

export function DocumentCreditPackCard({ pack, canAcquire }: { pack: { code: string; name: string; description: string | null; creditAmount: number; price: string; currency: string; alreadyAcquired: boolean }; canAcquire: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(acquireDocumentCreditsAction, initialCommercialFormState);
  const price = pack.currency === "GHS" ? `GH₵${Number(pack.price).toLocaleString("en-GH")}` : `${pack.currency} ${pack.price}`;
  const isBetaFree = Number(pack.price) === 0;
  return (
    <article className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <h3 className="text-lg font-bold text-text">{pack.name}</h3>
      <p className="mt-1 text-sm font-semibold text-link">{pack.creditAmount.toLocaleString("en-GH")} carry-forward credits</p>
      {pack.description ? <p className="mt-3 text-sm leading-6 text-muted">{pack.description}</p> : null}
      <p className="mt-4 text-sm font-semibold text-text">{isBetaFree ? "Beta price" : "Test price"}: {price}</p>
      <div className="mt-auto pt-5">
        {isBetaFree && pack.alreadyAcquired ? <p className="text-sm font-semibold text-muted">Already acquired during beta</p> : canAcquire ? confirming ? (
          <form action={action} className="grid gap-3">
            <input type="hidden" name="packCode" value={pack.code} />
            <p className="text-sm leading-6 text-text">{isBetaFree ? `Add ${pack.creditAmount.toLocaleString("en-GH")} beta credits to this workspace?` : `Start a Paystack Test checkout for ${pack.creditAmount.toLocaleString("en-GH")} credits at ${price}?`}</p>
            <div className="flex gap-2"><button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white">{pending ? (isBetaFree ? "Adding…" : "Connecting…") : "Confirm"}</button><button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">Cancel</button></div>
          </form>
        ) : <button type="button" onClick={() => setConfirming(true)} className="min-h-11 w-full rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link">{isBetaFree ? "Add Beta Credits" : "Buy Credits"}</button> : <p className="text-sm text-muted">Only the Workspace Owner can acquire credits.</p>}
        {state.message ? <p role="status" className={`mt-3 text-sm ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
        {state.authorizationUrl ? <a href={state.authorizationUrl} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-civ-blue px-4 py-3 text-sm font-semibold text-white hover:bg-civ-blue-hover">Continue to Paystack Test Checkout</a> : null}
      </div>
    </article>
  );
}
