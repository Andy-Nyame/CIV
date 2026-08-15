"use client";

import { useActionState, useState } from "react";

import { restoreWorkspaceAction } from "@/features/workspaces/settings-actions";
import { initialWorkspaceSettingsFormState } from "@/features/workspaces/types";

export function ArchivedWorkspaceRestore({
  workspace,
}: {
  workspace: { id: string; name: string; type: string };
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    restoreWorkspaceAction,
    initialWorkspaceSettingsFormState,
  );
  return (
    <div className="rounded-xl border border-border bg-page p-4">
      <p className="font-semibold text-text">{workspace.name}</p>
      <p className="mt-1 text-sm text-muted">Archived {workspace.type.toLowerCase()} workspace</p>
      {confirming ? (
        <form action={action} className="mt-4">
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="confirmation" value="RESTORE" />
          <p className="text-sm text-text">Restore this workspace and make it active?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white disabled:opacity-70">
              {pending ? "Restoring…" : "Restore workspace"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">Cancel</button>
          </div>
          {state.message ? (
            <p className="mt-3 text-sm text-danger" role="status" aria-live="polite">{state.message}</p>
          ) : null}
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-4 min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover">Restore</button>
      )}
    </div>
  );
}
