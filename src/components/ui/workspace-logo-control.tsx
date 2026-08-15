"use client";

import Image from "next/image";
import { useActionState } from "react";

import {
  removeWorkspaceLogoAction,
  uploadWorkspaceLogoAction,
} from "@/features/workspaces/settings-actions";
import { initialWorkspaceSettingsFormState } from "@/features/workspaces/types";

export function WorkspaceLogoControl({
  workspaceName,
  logoUrl,
  canManage,
}: {
  workspaceName: string;
  logoUrl: string | null;
  canManage: boolean;
}) {
  const [uploadState, uploadAction, uploadPending] = useActionState(
    uploadWorkspaceLogoAction,
    initialWorkspaceSettingsFormState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeWorkspaceLogoAction,
    initialWorkspaceSettingsFormState,
  );
  const initial = workspaceName.trim().charAt(0).toUpperCase() || "C";

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-4">
        {logoUrl ? (
          <Image
            src={logoUrl}
            alt={`${workspaceName} logo`}
            width={88}
            height={88}
            unoptimized
            className="size-22 rounded-xl border border-border bg-white object-contain p-2"
          />
        ) : (
          <span className="grid size-22 place-items-center rounded-xl bg-civ-navy text-2xl font-bold text-white" aria-label="Workspace logo placeholder">
            {initial}
          </span>
        )}
        <div>
          <p className="font-semibold text-text">{workspaceName}</p>
          <p className="mt-1 max-w-md text-sm leading-6 text-muted">
            Private workspace branding for CIV. Future document templates and artwork are not enabled yet.
          </p>
        </div>
      </div>

      {canManage ? (
        <form action={uploadAction} className="grid gap-3" noValidate>
          <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="workspace-logo">
            Upload workspace logo
            <input
              id="workspace-logo"
              className="min-h-12 rounded-lg border border-border bg-surface px-3 py-2 font-normal text-text file:mr-3 file:rounded-md file:border-0 file:bg-active file:px-3 file:py-2 file:font-semibold file:text-link"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
            />
          </label>
          <p className="text-sm leading-6 text-muted">PNG, JPEG, or WebP up to 5 MB. CIV stores a private optimized copy.</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={uploadPending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white hover:bg-civ-blue-hover disabled:opacity-70">
              {uploadPending ? "Saving…" : logoUrl ? "Replace logo" : "Save logo"}
            </button>
            {logoUrl ? (
              <button formAction={removeAction} formNoValidate disabled={removePending} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover disabled:opacity-70">
                {removePending ? "Removing…" : "Remove logo"}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {[uploadState, removeState].map((state, index) =>
        state.message ? (
          <p key={index} className={`text-sm ${state.success ? "text-verification" : "text-danger"}`} role="status" aria-live="polite">
            {state.message}
          </p>
        ) : null,
      )}
    </div>
  );
}
