"use client";
import { useActionState } from "react";
import { saveCustomerAction, type CustomerFormState } from "@/features/customers/actions";

export function CustomerForm({ customer }: { customer?: { id: string; name: string; email: string | null; phone: string | null; address: string | null; businessTin: string | null; notes: string | null } }) {
  const [state, action, pending] = useActionState(saveCustomerAction.bind(null, customer?.id ?? null), {} as CustomerFormState);
  const field = "min-h-11 w-full rounded-lg border border-border bg-page px-3 text-sm text-text focus:border-civ-blue focus:outline-none";
  return <form action={action} className="grid gap-4">
    <label className="grid gap-1.5 text-sm font-semibold text-text">Customer name<input className={field} name="name" defaultValue={customer?.name} required maxLength={200} /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-text">Email<input className={field} name="email" type="email" defaultValue={customer?.email ?? ""} /></label><label className="grid gap-1.5 text-sm font-semibold text-text">Phone<input className={field} name="phone" defaultValue={customer?.phone ?? ""} /></label></div>
    <label className="grid gap-1.5 text-sm font-semibold text-text">Address<textarea className={`${field} min-h-24 py-3`} name="address" defaultValue={customer?.address ?? ""} /></label>
    <label className="grid gap-1.5 text-sm font-semibold text-text">Tax / TIN identifier<input className={field} name="businessTin" defaultValue={customer?.businessTin ?? ""} /></label>
    <label className="grid gap-1.5 text-sm font-semibold text-text">Notes<textarea className={`${field} min-h-24 py-3`} name="notes" defaultValue={customer?.notes ?? ""} /></label>
    {state.message ? <p role="status" className="text-sm text-danger">{state.message}</p> : null}
    <button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : "Save customer"}</button>
  </form>;
}
