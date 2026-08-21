"use client";
import { useActionState } from "react";
import { saveCatalogueItemAction, type CatalogueFormState } from "@/features/catalog/actions";

export function CatalogueItemForm({ item, currency = "GHS" }: { item?: { id: string; name: string; description: string | null; type: "ITEM" | "SERVICE"; unitPrice: { toString(): string }; currency: string; unitLabel: string | null; sku: string | null }; currency?: string }) {
  const [state, action, pending] = useActionState(saveCatalogueItemAction.bind(null, item?.id ?? null), {} as CatalogueFormState); const field = "min-h-11 w-full rounded-lg border border-border bg-page px-3 text-sm text-text focus:border-civ-blue focus:outline-none";
  return <form action={action} className="grid gap-4">
    <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-text">Name<input className={field} name="name" defaultValue={item?.name} required /></label><label className="grid gap-1.5 text-sm font-semibold text-text">Type<select className={field} name="type" defaultValue={item?.type ?? "SERVICE"}><option value="SERVICE">Service</option><option value="ITEM">Item</option></select></label></div>
    <label className="grid gap-1.5 text-sm font-semibold text-text">Description<textarea className={`${field} min-h-24 py-3`} name="description" defaultValue={item?.description ?? ""} /></label>
    <div className="grid gap-4 sm:grid-cols-3"><label className="grid gap-1.5 text-sm font-semibold text-text">Unit price<input className={field} name="unitPrice" inputMode="decimal" defaultValue={item?.unitPrice.toString() ?? "0.00"} required /></label><label className="grid gap-1.5 text-sm font-semibold text-text">Currency<input className={field} name="currency" defaultValue={item?.currency ?? currency} maxLength={3} required /></label><label className="grid gap-1.5 text-sm font-semibold text-text">Unit label<input className={field} name="unitLabel" defaultValue={item?.unitLabel ?? ""} placeholder="hour, each, kg" /></label></div>
    <label className="grid gap-1.5 text-sm font-semibold text-text">SKU / code<input className={field} name="sku" defaultValue={item?.sku ?? ""} /></label>
    {state.message ? <p role="status" className="text-sm text-danger">{state.message}</p> : null}<button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : "Save catalogue entry"}</button>
  </form>;
}
