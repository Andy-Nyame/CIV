"use client";

import { useActionState, useState } from "react";

import { acquireBetaCreditsAction } from "@/features/commercial/actions";
import { initialCommercialFormState } from "@/features/commercial/types";

export function DocumentCreditPackCard({ pack, canAcquire }: { pack: { code: string; name: string; description: string | null; creditAmount: number; price: string; currency: string; alreadyAcquired: boolean }; canAcquire: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(acquireBetaCreditsAction, initialCommercialFormState);
  const price = pack.currency === "GHS" ? `GH₵${Number(pack.price).toLocaleString("en-GH")}` : `${pack.currency} ${pack.price}`;
  return (
    <article className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <h3 className="text-lg font-bold text-text">{pack.name}</h3>
      <p className="mt-1 text-sm font-semibold text-link">{pack.creditAmount.toLocaleString("en-GH")} carry-forward credits</p>
      {pack.description ? <p className="mt-3 text-sm leading-6 text-muted">{pack.description}</p> : null}
      <p className="mt-4 text-sm font-semibold text-text">Beta price: {price}</p>
      <div className="mt-auto pt-5">
        {pack.alreadyAcquired ? <p className="text-sm font-semibold text-muted">Already acquired during beta</p> : canAcquire ? confirming ? (
          <form action={action} className="grid gap-3">
            <input type="hidden" name="packCode" value={pack.code} />
            <p className="text-sm leading-6 text-text">Add {pack.creditAmount.toLocaleString("en-GH")} credits to this workspace for {price} during beta?</p>
            <div className="flex gap-2"><button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white">{pending ? "Adding…" : "Confirm"}</button><button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">Cancel</button></div>
          </form>
        ) : <button type="button" onClick={() => setConfirming(true)} className="min-h-11 w-full rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link">Add {pack.creditAmount.toLocaleString("en-GH")} Credits</button> : <p className="text-sm text-muted">Only the Workspace Owner can acquire credits.</p>}
        {state.message ? <p role="status" className={`mt-3 text-sm ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
      </div>
    </article>
  );
}
