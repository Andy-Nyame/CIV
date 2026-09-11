"use client";
import { useActionState } from "react";
import { saveCustomerAction, type CustomerFormState } from "@/features/customers/actions";

export function CustomerForm({ customer }: { customer?: { id: string; name: string; email: string | null; phone: string | null; address: string | null; businessTin: string | null; taxpayerIdType: "GHANA_CARD_PIN" | "GRA_TIN" | null; taxpayerId: string | null; vatRegistrationStatus: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED" | null; notes: string | null } }) {
  const [state, action, pending] = useActionState(saveCustomerAction.bind(null, customer?.id ?? null), {} as CustomerFormState);
  const field = "min-h-11 w-full rounded-lg border border-border bg-page px-3 text-sm text-text focus:border-civ-blue focus:outline-none";
  return <form action={action} className="grid gap-4">
    <label className="grid gap-1.5 text-sm font-semibold text-text">Customer name<input className={field} name="name" defaultValue={customer?.name} required maxLength={200} /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-text">Email<input className={field} name="email" type="email" defaultValue={customer?.email ?? ""} /></label><label className="grid gap-1.5 text-sm font-semibold text-text">Phone<input className={field} name="phone" defaultValue={customer?.phone ?? ""} /></label></div>
    <label className="grid gap-1.5 text-sm font-semibold text-text">Address<textarea className={`${field} min-h-24 py-3`} name="address" defaultValue={customer?.address ?? ""} /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-text">Taxpayer ID type<select className={field} name="taxpayerIdType" defaultValue={customer?.taxpayerIdType ?? ""}><option value="">Not recorded</option><option value="GHANA_CARD_PIN">Ghana Card PIN</option><option value="GRA_TIN">GRA TIN</option></select></label><label className="grid gap-1.5 text-sm font-semibold text-text">Taxpayer identifier<input className={field} name="taxpayerId" defaultValue={customer?.taxpayerId ?? customer?.businessTin ?? ""} /></label></div>
    <label className="grid gap-1.5 text-sm font-semibold text-text">Recorded VAT status<select className={field} name="vatRegistrationStatus" defaultValue={customer?.vatRegistrationStatus ?? ""}><option value="">Not recorded</option><option value="NOT_REGISTERED">Not registered</option><option value="PENDING">Pending</option><option value="REGISTERED">Registered</option><option value="DEREGISTERED">Deregistered</option></select><span className="font-normal text-muted">Optional customer information only; CIV does not verify this status.</span></label>
    <label className="grid gap-1.5 text-sm font-semibold text-text">Notes<textarea className={`${field} min-h-24 py-3`} name="notes" defaultValue={customer?.notes ?? ""} /></label>
    {state.message ? <p role="status" className="text-sm text-danger">{state.message}</p> : null}
    <button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : "Save customer"}</button>
  </form>;
}
