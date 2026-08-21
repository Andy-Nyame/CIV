"use client";

import { useActionState, useState } from "react";

import { updatePlanConfigurationAction } from "@/features/commercial/actions";
import { initialCommercialFormState } from "@/features/commercial/types";

type EditablePlan = {
  code: string;
  name: string;
  description: string | null;
  memberLimit: number | null;
  documentLimit: number | null;
  betaPrice: string;
  monthlyPrice: string;
  currency: string;
  billingMode: "FREE" | "RECURRING" | "CUSTOM";
  paystackPlanCode: string | null;
  isActive: boolean;
  isPublic: boolean;
  isAvailableForNewWorkspaces: boolean;
  sortOrder: number;
  workspaces: number;
};

export function PlatformPlanEditor({
  plan,
  canManage,
}: {
  plan: EditablePlan;
  canManage: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    updatePlanConfigurationAction,
    initialCommercialFormState,
  );

  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-link">{plan.code}</p>
          <h2 className="mt-1 text-xl font-bold text-text">{plan.name}</h2>
        </div>
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-muted">
          {plan.workspaces.toLocaleString()} workspace{plan.workspaces === 1 ? "" : "s"}
        </span>
      </div>

      {canManage ? (
        <form action={action} className="mt-5 grid gap-4">
          <input type="hidden" name="code" value={plan.code} />
          <label className="grid gap-1.5 text-sm font-semibold text-text">
            Display name
            <input name="name" defaultValue={plan.name} required maxLength={100} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-text">
            Description
            <textarea name="description" defaultValue={plan.description ?? ""} maxLength={2000} rows={3} className="rounded-lg border border-border bg-surface px-3 py-2 font-normal" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-text">Member limit<input name="memberLimit" type="number" min="1" defaultValue={plan.memberLimit ?? ""} placeholder="Custom" className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-text">Monthly documents<input name="documentLimit" type="number" min="1" defaultValue={plan.documentLimit ?? ""} placeholder="Custom" className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-text">Non-recurring price<input name="betaPrice" inputMode="decimal" defaultValue={plan.betaPrice} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-text">Monthly recurring price<input name="monthlyPrice" inputMode="decimal" defaultValue={plan.monthlyPrice} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-text">Currency<input name="currency" defaultValue={plan.currency} maxLength={3} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal uppercase" /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-text">Sort order<input name="sortOrder" type="number" min="0" defaultValue={plan.sortOrder} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" /></label>
            <label className="grid gap-1.5 text-sm font-semibold text-text">
              Billing mode
              <select name="billingMode" defaultValue={plan.billingMode} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal">
                <option value="FREE">Free / non-billable</option>
                <option value="RECURRING">Recurring card subscription</option>
                <option value="CUSTOM">Custom / contact CIV</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">
              Paystack Test plan code
              <input name="paystackPlanCode" defaultValue={plan.paystackPlanCode ?? ""} placeholder="PLN_… (recurring plans only)" autoComplete="off" className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" />
              <span className="text-xs font-normal leading-5 text-muted">Safe provider identifier only. Free and custom plans must leave this blank.</span>
            </label>
          </div>
          <div className="grid gap-2 text-sm text-text sm:grid-cols-3">
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="isActive" type="checkbox" defaultChecked={plan.isActive} /> Active</label>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="isPublic" type="checkbox" defaultChecked={plan.isPublic} /> Public</label>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="isAvailableForNewWorkspaces" type="checkbox" defaultChecked={plan.isAvailableForNewWorkspaces} /> Selectable</label>
          </div>
          {confirming ? (
            <div className="rounded-lg border border-civ-blue bg-active p-3">
              <p className="text-sm leading-6 text-text">Apply these limits and settings to all current and future {plan.name} subscriptions? Existing members, documents, and purchased credits will be preserved.</p>
              <div className="mt-3 flex gap-2">
                <button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : "Confirm changes"}</button>
                <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="min-h-11 rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link hover:bg-hover">Review changes</button>
          )}
          {state.message ? <p role="status" className={`text-sm ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
        </form>
      ) : (
        <dl className="mt-5 grid gap-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">Members</dt><dd className="font-semibold text-text">{plan.memberLimit?.toLocaleString() ?? "Custom"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Monthly documents</dt><dd className="font-semibold text-text">{plan.documentLimit?.toLocaleString() ?? "Custom"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Billing</dt><dd className="font-semibold text-text">{plan.billingMode === "RECURRING" ? `${plan.currency} ${Number(plan.monthlyPrice).toFixed(2)} monthly` : plan.billingMode === "CUSTOM" ? "Contact CIV" : "Non-billable"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">State</dt><dd className="font-semibold text-text">{plan.isActive ? "Active" : "Inactive"} · {plan.isPublic ? "Public" : "Hidden"}</dd></div>
        </dl>
      )}
    </article>
  );
}
