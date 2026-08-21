"use client";

import { useActionState, useState } from "react";

import {
  createCreditPackAction,
  updateCreditPackAction,
} from "@/features/commercial/actions";
import { initialCommercialFormState } from "@/features/commercial/types";

type CreditPack = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  creditAmount: number;
  price: string;
  currency: string;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  purchases: number;
};

function PackFields({ pack }: { pack?: CreditPack }) {
  return (
    <>
      {pack ? <input type="hidden" name="id" value={pack.id} /> : null}
      <label className="grid gap-1.5 text-sm font-semibold text-text">Stable code<input name="code" defaultValue={pack?.code ?? ""} readOnly={Boolean(pack)} required maxLength={50} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal uppercase read-only:bg-surface-muted" /></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text">Name<input name="name" defaultValue={pack?.name ?? ""} required maxLength={100} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text">Description<textarea name="description" defaultValue={pack?.description ?? ""} rows={2} maxLength={2000} className="rounded-lg border border-border bg-surface px-3 py-2 font-normal" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-text">Credits<input name="creditAmount" type="number" min="1" defaultValue={pack?.creditAmount ?? 100} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">Pack price<input name="price" inputMode="decimal" defaultValue={pack?.price ?? "0.0000"} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">Currency<input name="currency" defaultValue={pack?.currency ?? "GHS"} maxLength={3} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal uppercase" /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">Sort order<input name="sortOrder" type="number" min="0" defaultValue={pack?.sortOrder ?? 50} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
      </div>
      <div className="grid gap-2 text-sm text-text sm:grid-cols-2">
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="isActive" type="checkbox" defaultChecked={pack?.isActive ?? true} /> Active</label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="isPublic" type="checkbox" defaultChecked={pack?.isPublic ?? true} /> Public</label>
      </div>
    </>
  );
}

export function PlatformCreditPackEditor({ pack }: { pack: CreditPack }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(updateCreditPackAction, initialCommercialFormState);
  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <div className="flex justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-link">{pack.code}</p><h2 className="mt-1 text-lg font-bold text-text">{pack.name}</h2></div><span className="text-xs font-semibold text-muted">{pack.purchases} acquired</span></div>
      <form action={action} className="mt-5 grid gap-4">
        <PackFields pack={pack} />
        {confirming ? <div className="grid gap-2 rounded-lg border border-civ-blue bg-active p-3"><p className="text-sm text-text">Apply this pack configuration? Existing purchase snapshots will not change.</p><div className="flex gap-2"><button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white">{pending ? "Saving…" : "Confirm"}</button><button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold">Cancel</button></div></div> : <button type="button" onClick={() => setConfirming(true)} className="min-h-11 rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link">Review changes</button>}
        {state.message ? <p role="status" className={`text-sm ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
      </form>
    </article>
  );
}

export function PlatformCreditPackCreateForm() {
  const [state, action, pending] = useActionState(createCreditPackAction, initialCommercialFormState);
  return (
    <form action={action} className="grid gap-4">
      <PackFields />
      <button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 font-semibold text-white disabled:opacity-60">{pending ? "Creating…" : "Create credit pack"}</button>
      {state.message ? <p role="status" className={`text-sm ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
    </form>
  );
}
