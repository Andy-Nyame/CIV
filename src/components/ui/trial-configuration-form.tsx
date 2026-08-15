"use client";

import { useActionState, useState } from "react";

import { updateTrialConfigurationAction } from "@/features/trials/actions";
import { initialTrialFormState } from "@/features/trials/types";

type Configuration = {
  enabled: boolean;
  durationDays: number;
  newWorkspacesOnly: boolean;
  oneTrialPerWorkspace: boolean;
  paymentMethodRequired: boolean;
  allowManualGrant: boolean;
  trialPlan: { code: string; name: string };
  fallbackPlan: { code: string; name: string };
};

export function TrialConfigurationForm({
  configuration,
  plans,
}: {
  configuration: Configuration;
  plans: { code: string; name: string; isAvailableForNewWorkspaces: boolean }[];
}) {
  const [state, action, pending] = useActionState(
    updateTrialConfigurationAction,
    initialTrialFormState,
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={action} className="mt-5 grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-semibold text-text">
          Trial plan
          <select name="trialPlanCode" defaultValue={configuration.trialPlan.code} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal">
            {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">
          Duration (days)
          <input name="durationDays" type="number" min="1" max="365" required defaultValue={configuration.durationDays} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal" />
          {state.fieldErrors?.durationDays ? <span className="text-xs text-danger">{state.fieldErrors.durationDays[0]}</span> : null}
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">
          New-workspace fallback
          <select name="fallbackPlanCode" defaultValue={configuration.fallbackPlan.code} className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal">
            {plans.filter((plan) => plan.isAvailableForNewWorkspaces).map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
          </select>
          {state.fieldErrors?.fallbackPlanCode ? <span className="text-xs text-danger">{state.fieldErrors.fallbackPlanCode[0]}</span> : null}
        </label>
      </div>
      <div className="grid gap-2 text-sm text-text sm:grid-cols-2 xl:grid-cols-3">
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="enabled" type="checkbox" defaultChecked={configuration.enabled} /> Trials enabled</label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="newWorkspacesOnly" type="checkbox" defaultChecked={configuration.newWorkspacesOnly} /> New workspaces only</label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="oneTrialPerWorkspace" type="checkbox" defaultChecked={configuration.oneTrialPerWorkspace} /> One trial per workspace</label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="allowManualGrant" type="checkbox" defaultChecked={configuration.allowManualGrant} /> Manual grants allowed</label>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3"><input name="paymentMethodRequired" type="checkbox" defaultChecked={configuration.paymentMethodRequired} /> Payment method required</label>
      </div>
      <p className="text-xs leading-5 text-muted">Payment collection is not implemented. Enabling the payment-method requirement makes workspaces ineligible until that future server-verified flow exists.</p>
      {confirming ? (
        <div className="rounded-lg border border-civ-blue bg-active p-3">
          <p className="text-sm leading-6 text-text">Apply these defaults to future trial decisions? Existing trial snapshots and history will remain unchanged.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : "Confirm configuration"}</button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="min-h-11 rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link hover:bg-hover">Review configuration</button>
      )}
      {state.message ? <p role="status" className={`text-sm ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
    </form>
  );
}
