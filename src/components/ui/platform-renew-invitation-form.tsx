"use client";

import { useActionState } from "react";

import { renewPlatformInvitationAction } from "@/features/platform-team/actions";
import type { PlatformTeamFormState } from "@/features/platform-team/types";

import { CopyInvitationLink } from "./copy-invitation-link";

export function PlatformRenewInvitationForm({ invitationId }: { invitationId: string }) {
  const initialState: PlatformTeamFormState = {};
  const [state, action, pending] = useActionState(renewPlatformInvitationAction, initialState);
  return (
    <div className="grid gap-3">
      <form action={action}>
        <input type="hidden" name="invitationId" value={invitationId} />
        <button disabled={pending} className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover">{pending ? "Generating…" : "Generate New Link"}</button>
      </form>
      {state.message ? <p className={`text-xs ${state.success ? "text-success" : "text-danger"}`} role="status">{state.message}</p> : null}
      {state.invitationUrl ? <CopyInvitationLink url={state.invitationUrl} /> : null}
    </div>
  );
}
