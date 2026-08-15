"use client";

import { useActionState } from "react";

import { grantTrialAction } from "@/features/trials/actions";
import { initialTrialFormState } from "@/features/trials/types";

export function TrialGrantForm({
  workspaces,
}: {
  workspaces: { id: string; name: string; subscription: { plan: { name: string } } | null; _count: { trials: number } }[];
}) {
  const [state, action, pending] = useActionState(grantTrialAction, initialTrialFormState);
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <label className="grid gap-1.5 text-sm font-semibold text-text">
        Eligible workspace
        <select name="workspaceId" required className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal">
          <option value="">Select a workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.subscription?.plan.name ?? "No plan"}{workspace._count.trials ? " · trial history" : ""}</option>
          ))}
        </select>
      </label>
      <button disabled={pending || workspaces.length === 0} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Granting…" : "Grant configured trial"}</button>
      {state.message ? <p role="status" className={`text-sm sm:col-span-2 ${state.success ? "text-success" : "text-danger"}`}>{state.message}</p> : null}
    </form>
  );
}
