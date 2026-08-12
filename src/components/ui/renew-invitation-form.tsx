"use client";

import { useActionState } from "react";

import { renewInvitationAction } from "@/features/team/actions";
import { initialTeamFormState } from "@/features/team/types";

import { CopyInvitationLink } from "./copy-invitation-link";

export function RenewInvitationForm({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState(
    renewInvitationAction,
    initialTeamFormState,
  );

  return (
    <div className="grid gap-3">
      <form action={action}>
        <input type="hidden" name="invitationId" value={invitationId} />
        <button
          disabled={pending}
          className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover"
        >
          {pending ? "Generating…" : "Generate New Link"}
        </button>
      </form>
      {state.message ? (
        <p className={`text-xs ${state.success ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      ) : null}
      {state.invitationUrl ? <CopyInvitationLink url={state.invitationUrl} /> : null}
    </div>
  );
}
