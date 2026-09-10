"use client";

import { useActionState } from "react";

import { enableWorkspaceTestModeAction } from "@/features/workspaces/settings-actions";
import { initialWorkspaceSettingsFormState } from "@/features/workspaces/types";

export function WorkspaceTestModeControl() {
  const [state, action, pending] = useActionState(
    enableWorkspaceTestModeAction,
    initialWorkspaceSettingsFormState,
  );
  return (
    <form action={action} className="mt-4">
      <button disabled={pending} className="min-h-11 rounded-lg border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-60">
        {pending ? "Enabling TEST mode…" : "Enable TEST mode"}
      </button>
      <p className="mt-2 text-sm text-muted">This is one-way and is allowed only before the workspace has documents.</p>
      {state.message ? <p className={`mt-2 text-sm ${state.success ? "text-verification" : "text-danger"}`} role="status">{state.message}</p> : null}
    </form>
  );
}
