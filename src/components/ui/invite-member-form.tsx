"use client";

import { useActionState } from "react";

import { inviteMemberAction } from "@/features/team/actions";
import { initialTeamFormState } from "@/features/team/types";

import { CopyInvitationLink } from "./copy-invitation-link";

export function InviteMemberForm() {
  const [state, action, pending] = useActionState(
    inviteMemberAction,
    initialTeamFormState,
  );

  return (
    <form action={action} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <label className="grid gap-1.5 text-sm font-semibold text-text">
          Email
          <input
            className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal text-text"
            name="email"
            type="email"
            required
            maxLength={320}
            aria-invalid={Boolean(state.fieldErrors?.email)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">
          Role
          <select
            className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal text-text"
            name="role"
            defaultValue="STAFF"
          >
            <option value="ADMIN">Admin</option>
            <option value="MANAGER">Manager</option>
            <option value="STAFF">Staff</option>
          </select>
        </label>
        <button
          className="min-h-11 rounded-lg bg-civ-blue px-4 font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70"
          disabled={pending}
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>
      {state.fieldErrors?.email ? (
        <p className="text-sm text-danger" role="alert">
          {state.fieldErrors.email[0]}
        </p>
      ) : null}
      {state.fieldErrors?.role ? (
        <p className="text-sm text-danger" role="alert">
          {state.fieldErrors.role[0]}
        </p>
      ) : null}
      {state.message ? (
        <p
          className={`text-sm ${state.success ? "text-success" : "text-danger"}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      {state.invitationUrl ? (
        <CopyInvitationLink url={state.invitationUrl} />
      ) : null}
    </form>
  );
}
