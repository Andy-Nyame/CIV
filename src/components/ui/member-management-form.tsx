"use client";

import { useActionState } from "react";

import { manageMemberAction } from "@/features/team/actions";
import { initialTeamFormState } from "@/features/team/types";

export function MemberManagementForm({
  membershipId,
  role,
  status,
}: {
  membershipId: string;
  role: "ADMIN" | "MANAGER" | "STAFF";
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "REMOVED";
}) {
  const [state, action, pending] = useActionState(
    manageMemberAction,
    initialTeamFormState,
  );

  return (
    <form action={action} className="grid gap-2 sm:justify-items-end">
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Member role"
          name="role"
          defaultValue={role}
          className="min-h-10 rounded-lg border border-border bg-surface px-2 text-sm text-text"
        >
          <option value="ADMIN">Admin</option>
          <option value="MANAGER">Manager</option>
          <option value="STAFF">Staff</option>
        </select>
        <button
          name="intent"
          value="role"
          disabled={pending}
          className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover"
        >
          Save role
        </button>
        {status === "SUSPENDED" ? (
          <button
            name="intent"
            value="reactivate"
            disabled={pending}
            className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover"
          >
            Reactivate
          </button>
        ) : status === "ACTIVE" ? (
          <button
            name="intent"
            value="suspend"
            disabled={pending}
            className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover"
          >
            Suspend
          </button>
        ) : null}
        {status !== "REMOVED" ? (
          <button
            name="intent"
            value="remove"
            disabled={pending}
            className="min-h-10 rounded-lg border border-danger px-3 text-sm font-semibold text-danger hover:bg-hover"
          >
            Remove
          </button>
        ) : null}
      </div>
      {state.message ? (
        <p className={`text-xs ${state.success ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
