"use client";

import Link from "next/link";

import { switchWorkspaceAction } from "@/features/workspaces/actions";
import type { WorkspaceContext } from "@/features/workspaces/types";

export function WorkspaceSwitcher({
  workspaceContext,
}: {
  workspaceContext: WorkspaceContext;
}) {
  const { current, available } = workspaceContext;

  if (!current) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <form action={switchWorkspaceAction}>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-muted">Workspace</span>
          <select
            aria-label="Current workspace"
            className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-text hover:bg-hover"
            name="workspaceId"
            value={current.id}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {available.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="sr-only">
          Switch workspace
        </button>
      </form>
      <p className="px-1 text-xs text-muted">
        Role: {current.role.charAt(0) + current.role.slice(1).toLowerCase()}
      </p>
      <Link
        href="/app/workspaces/new"
        className="rounded-md px-1 text-xs font-semibold text-link underline-offset-4 hover:underline"
      >
        Create another workspace
      </Link>
    </div>
  );
}
