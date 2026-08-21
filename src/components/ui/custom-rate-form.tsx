"use client";
import { useActionState } from "react";
import { saveCustomRateAction, type RateFormState } from "@/features/rates/actions";

export function CustomRateForm({ rate }: { rate?: { id: string; name: string; type: "PERCENTAGE" | "FIXED"; value: string; description: string | null } }) {
  const [state, action, pending] = useActionState(saveCustomRateAction.bind(null, rate?.id ?? null), {} as RateFormState);
  const field = "min-h-11 w-full rounded-lg border border-border bg-page px-3 text-sm text-text focus:border-civ-blue focus:outline-none";
  return <form action={action} className="grid gap-4"><label className="grid gap-1.5 text-sm font-semibold text-text">Name<input className={field} name="name" defaultValue={rate?.name} required maxLength={200}/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Type<select className={field} name="type" defaultValue={rate?.type ?? "PERCENTAGE"}><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount per line</option></select></label><label className="grid gap-1.5 text-sm font-semibold text-text">Value<input className={field} name="value" inputMode="decimal" defaultValue={rate?.value ?? "0"} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Description<textarea className={`${field} min-h-20 py-3`} name="description" defaultValue={rate?.description ?? ""}/></label><button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : "Save Custom Rate"}</button>{state.message?<p role="status" className={state.errors?"text-sm text-danger":"text-sm text-success"}>{state.message}</p>:null}</form>;
}
