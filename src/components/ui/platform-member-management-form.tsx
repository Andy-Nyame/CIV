"use client";

import { useActionState } from "react";

import { managePlatformMemberAction } from "@/features/platform-team/actions";
import type { PlatformTeamFormState } from "@/features/platform-team/types";
import type { RecruitablePlatformRole } from "@/features/platform-team/validation";

const initialState: PlatformTeamFormState = {};

function label(role: string) {
  return role.toLowerCase().split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function PlatformMemberManagementForm({
  membershipId,
  role,
  roleOptions,
  status,
}: {
  membershipId: string;
  role: RecruitablePlatformRole;
  roleOptions: readonly RecruitablePlatformRole[];
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
}) {
  const [state, action, pending] = useActionState(managePlatformMemberAction, initialState);
  return (
    <form action={action} className="grid gap-2 sm:justify-items-end">
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex flex-wrap gap-2">
        <select aria-label="Platform member role" name="role" defaultValue={role} className="min-h-10 rounded-lg border border-border bg-surface px-2 text-sm text-text">
          {roleOptions.map((option) => <option key={option} value={option}>{label(option)}</option>)}
        </select>
        <button name="intent" value="role" disabled={pending} className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover">Save role</button>
        {status === "SUSPENDED" ? (
          <button name="intent" value="reactivate" disabled={pending} className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover">Reactivate</button>
        ) : status === "ACTIVE" ? (
          <button name="intent" value="suspend" disabled={pending} className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover">Suspend</button>
        ) : null}
        {status !== "REMOVED" ? <button name="intent" value="remove" disabled={pending} className="min-h-10 rounded-lg border border-danger px-3 text-sm font-semibold text-danger hover:bg-hover">Remove</button> : null}
      </div>
      {state.message ? <p className={`text-xs ${state.success ? "text-success" : "text-danger"}`} role="status">{state.message}</p> : null}
    </form>
  );
}
