"use client";

import { useActionState, useState } from "react";

import { cancelTrialAction } from "@/features/trials/actions";
import { initialTrialFormState } from "@/features/trials/types";

export function TrialCancelButton({ trialId }: { trialId: string }) {
  const [state, action, pending] = useActionState(cancelTrialAction, initialTrialFormState);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button type="button" onClick={() => setConfirming(true)} className="min-h-10 rounded-lg border border-danger px-3 text-xs font-semibold text-danger">Cancel trial</button>;
  }
  return (
    <form action={action} className="grid min-w-44 gap-2">
      <input type="hidden" name="trialId" value={trialId} />
      <p className="text-xs leading-5 text-muted">End this trial immediately?</p>
      <div className="flex gap-2">
        <button disabled={pending} className="min-h-10 rounded-lg bg-danger px-3 text-xs font-semibold text-white disabled:opacity-60">{pending ? "Cancelling…" : "Confirm"}</button>
        <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="min-h-10 rounded-lg border border-border px-3 text-xs font-semibold text-text">Keep</button>
      </div>
      {state.message ? <p role="status" className={`text-xs ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
    </form>
  );
}
