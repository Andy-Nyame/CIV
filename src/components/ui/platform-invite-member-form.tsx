"use client";

import { useActionState } from "react";

import { invitePlatformMemberAction } from "@/features/platform-team/actions";
import type { PlatformTeamFormState } from "@/features/platform-team/types";
import type { RecruitablePlatformRole } from "@/features/platform-team/validation";

import { CopyInvitationLink } from "./copy-invitation-link";

const initialState: PlatformTeamFormState = {};

function label(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function PlatformInviteMemberForm({
  roles,
}: {
  roles: readonly RecruitablePlatformRole[];
}) {
  const [state, action, pending] = useActionState(
    invitePlatformMemberAction,
    initialState,
  );
  return (
    <form action={action} className="grid gap-4" noValidate>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem_auto] md:items-end">
        <label className="grid gap-1.5 text-sm font-semibold text-text">
          Email
          <input className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal text-text" name="email" type="email" required maxLength={320} aria-invalid={Boolean(state.fieldErrors?.email)} />
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">
          Platform role
          <select className="min-h-11 rounded-lg border border-border bg-surface px-3 font-normal text-text" name="role" defaultValue={roles[0]}>
            {roles.map((role) => <option key={role} value={role}>{label(role)}</option>)}
          </select>
        </label>
        <button className="min-h-11 rounded-lg bg-civ-blue px-4 font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70" disabled={pending || roles.length === 0}>
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>
      {state.fieldErrors?.email ? <p className="text-sm text-danger" role="alert">{state.fieldErrors.email[0]}</p> : null}
      {state.fieldErrors?.role ? <p className="text-sm text-danger" role="alert">{state.fieldErrors.role[0]}</p> : null}
      {state.message ? <p className={`text-sm ${state.success ? "text-success" : "text-danger"}`} role="status">{state.message}</p> : null}
      {state.invitationUrl ? <CopyInvitationLink url={state.invitationUrl} /> : null}
    </form>
  );
}
