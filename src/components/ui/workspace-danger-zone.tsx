"use client";

import { useActionState, useState } from "react";

import {
  archiveWorkspaceAction,
  leaveWorkspaceAction,
  transferWorkspaceOwnershipAction,
} from "@/features/workspaces/settings-actions";
import { initialWorkspaceSettingsFormState } from "@/features/workspaces/types";

type TransferCandidate = {
  id: string;
  role: "OWNER" | "ADMIN" | "MANAGER" | "STAFF";
  user: { name: string | null; email: string | null };
};

export function WorkspaceDangerZone({
  workspaceName,
  isOwner,
  transferCandidates,
}: {
  workspaceName: string;
  isOwner: boolean;
  transferCandidates: TransferCandidate[];
}) {
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [transferConfirm, setTransferConfirm] = useState(false);
  const [targetMembershipId, setTargetMembershipId] = useState("");
  const [archiveState, archiveAction, archivePending] = useActionState(
    archiveWorkspaceAction,
    initialWorkspaceSettingsFormState,
  );
  const [leaveState, leaveAction, leavePending] = useActionState(
    leaveWorkspaceAction,
    initialWorkspaceSettingsFormState,
  );
  const [transferState, transferAction, transferPending] = useActionState(
    transferWorkspaceOwnershipAction,
    initialWorkspaceSettingsFormState,
  );

  return (
    <div className="grid gap-6">
      {isOwner ? (
        <div className="grid gap-3 border-b border-border pb-6">
          <div>
            <h3 className="font-semibold text-text">Archive workspace</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Archive preserves people, subscription, assets, documents, and activity history while stopping normal workspace access.
            </p>
          </div>
          {archiveConfirm ? (
            <form action={archiveAction} className="rounded-lg border border-danger/40 bg-surface-muted p-4">
              <input type="hidden" name="confirmation" value="ARCHIVE" />
              <p className="text-sm font-semibold text-text">Archive {workspaceName}?</p>
              <p className="mt-1 text-sm text-muted">You can restore it later from onboarding.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={archivePending} className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-70">
                  {archivePending ? "Archiving…" : "Archive workspace"}
                </button>
                <button type="button" onClick={() => setArchiveConfirm(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover">Cancel</button>
              </div>
              {archiveState.message ? (
                <p className="mt-3 text-sm text-danger" role="status" aria-live="polite">{archiveState.message}</p>
              ) : null}
            </form>
          ) : (
            <button type="button" onClick={() => setArchiveConfirm(true)} className="min-h-11 justify-self-start rounded-lg border border-danger px-4 text-sm font-semibold text-danger hover:bg-hover">
              Archive Workspace
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 border-b border-border pb-6">
          <div>
            <h3 className="font-semibold text-text">Leave workspace</h3>
            <p className="mt-1 text-sm leading-6 text-muted">Your account and historical business records remain intact, but your workspace access is revoked.</p>
          </div>
          {leaveConfirm ? (
            <form action={leaveAction} className="rounded-lg border border-danger/40 bg-surface-muted p-4">
              <input type="hidden" name="confirmation" value="LEAVE" />
              <p className="text-sm font-semibold text-text">Leave {workspaceName}?</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={leavePending} className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-70">
                  {leavePending ? "Leaving…" : "Leave workspace"}
                </button>
                <button type="button" onClick={() => setLeaveConfirm(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover">Cancel</button>
              </div>
              {leaveState.message ? (
                <p className="mt-3 text-sm text-danger" role="status" aria-live="polite">{leaveState.message}</p>
              ) : null}
            </form>
          ) : (
            <button type="button" onClick={() => setLeaveConfirm(true)} className="min-h-11 justify-self-start rounded-lg border border-danger px-4 text-sm font-semibold text-danger hover:bg-hover">
              Leave Workspace
            </button>
          )}
        </div>
      )}

      {isOwner ? (
        <div className="grid gap-3 border-b border-border pb-6">
          <div>
            <h3 className="font-semibold text-text">Transfer ownership</h3>
            <p className="mt-1 text-sm leading-6 text-muted">The selected active member becomes Owner and your role becomes Admin. Both changes are atomic.</p>
          </div>
          {transferCandidates.length ? (
            <form action={transferAction} className="grid gap-3 sm:max-w-xl">
              <label className="grid gap-2 text-sm font-semibold text-text">
                New Owner
                <select
                  name="targetMembershipId"
                  value={targetMembershipId}
                  onChange={(event) => {
                    setTargetMembershipId(event.target.value);
                    setTransferConfirm(false);
                  }}
                  className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text"
                  required
                >
                  <option value="">Choose an active member</option>
                  {transferCandidates.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.user.name?.trim() || member.user.email || "Workspace member"} · {member.role}
                    </option>
                  ))}
                </select>
              </label>
              {transferConfirm ? (
                <div className="rounded-lg border border-danger/40 bg-surface-muted p-4">
                  <input type="hidden" name="confirmation" value="TRANSFER" />
                  <p className="text-sm font-semibold text-text">
                    Transfer ownership to {transferCandidates.find(({ id }) => id === targetMembershipId)?.user.name?.trim() || transferCandidates.find(({ id }) => id === targetMembershipId)?.user.email || "this member"}?
                  </p>
                  <p className="mt-1 text-sm text-muted">This changes your role to Admin immediately.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={transferPending} className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-70">
                      {transferPending ? "Transferring…" : "Transfer ownership"}
                    </button>
                    <button type="button" onClick={() => setTransferConfirm(false)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={!targetMembershipId} onClick={() => setTransferConfirm(true)} className="min-h-11 justify-self-start rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60">Review transfer</button>
              )}
              {transferState.message ? (
                <p className={`text-sm ${transferState.success ? "text-verification" : "text-danger"}`} role="status">{transferState.message}</p>
              ) : null}
            </form>
          ) : (
            <p className="text-sm text-muted">Add an eligible active member before transferring ownership.</p>
          )}
        </div>
      ) : null}

      <div>
        <h3 className="font-semibold text-text">Permanently delete workspace</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Permanent deletion is unavailable in CIV V1. Issued or voided documents, audit history, memberships, and private business assets require retention-safe handling. Archive is the supported lifecycle action.
        </p>
        <button disabled className="mt-3 min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-muted opacity-70">Permanent deletion unavailable</button>
      </div>
    </div>
  );
}
