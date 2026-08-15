import type { Metadata } from "next";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PlatformInviteMemberForm } from "@/components/ui/platform-invite-member-form";
import { PlatformMemberManagementForm } from "@/components/ui/platform-member-management-form";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PlatformRenewInvitationForm } from "@/components/ui/platform-renew-invitation-form";
import { platformRoleLabel } from "@/features/platform-admin/presentation";
import { cancelPlatformInvitationAction } from "@/features/platform-team/actions";
import { getPlatformTeamPageData } from "@/features/platform-team/queries";
import type { RecruitablePlatformRole } from "@/features/platform-team/validation";

export const metadata: Metadata = { title: "Platform Team" };

export default async function PlatformTeamPage() {
  const data = await getPlatformTeamPageData();
  const pending = data.invitations.filter(
    (invitation) => invitation.effectiveStatus === "PENDING",
  );
  const history = data.invitations.filter(
    (invitation) => invitation.effectiveStatus !== "PENDING",
  );

  return (
    <div>
      <PlatformPageHeading
        title="Platform Team"
        description="Recruit and manage trusted people who help operate CIV. Platform access is separate from customer workspace roles."
      />

      <section className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="font-semibold text-text">Invite platform staff</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Links expire after seven days. Platform ownership cannot be granted through invitations.
          </p>
        </div>
        <PlatformInviteMemberForm roles={data.roleOptions} />
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold text-text">Team members</h2>
          <p className="mt-1 text-sm text-muted">
            Your role: {platformRoleLabel(data.currentMembership.role)}
          </p>
        </div>
        <ul className="divide-y divide-border">
          {data.members.map((member) => (
            <li key={member.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <p className="truncate font-semibold text-text">{member.user.name?.trim() || "CIV operator"}</p>
                <p className="mt-1 truncate text-sm text-muted">{member.user.email ?? "No email available"}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
                  <span className="text-link">{platformRoleLabel(member.role)}</span>
                  <span className="text-muted">{platformRoleLabel(member.status)}</span>
                  <span className="text-muted">Joined <LocalDateTime value={member.createdAt.toISOString()} /></span>
                </div>
              </div>
              {member.manageable && member.role !== "PLATFORM_OWNER" ? (
                <PlatformMemberManagementForm
                  membershipId={member.id}
                  role={member.role as RecruitablePlatformRole}
                  roleOptions={data.roleOptions}
                  status={member.status}
                />
              ) : (
                <p className="text-sm text-muted">Protected platform role</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold text-text">Pending invitations</h2>
          <p className="mt-1 text-sm text-muted">Only hashes are stored. A new shareable link is shown once when generated.</p>
        </div>
        {pending.length ? (
          <ul className="divide-y divide-border">
            {pending.map((invitation) => (
              <li key={invitation.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div>
                  <p className="font-semibold text-text">{invitation.email}</p>
                  <p className="mt-1 text-sm text-muted">{platformRoleLabel(invitation.role)} · expires <LocalDateTime value={invitation.expiresAt.toISOString()} /></p>
                </div>
                {invitation.manageable ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <PlatformRenewInvitationForm invitationId={invitation.id} />
                    <form action={cancelPlatformInvitationAction}>
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <button className="min-h-10 rounded-lg border border-danger px-3 text-sm font-semibold text-danger hover:bg-hover">Cancel</button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-10 text-center text-muted">No pending platform invitations.</p>}
      </section>

      {history.length ? (
        <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-text">Invitation history</h2></div>
          <ul className="divide-y divide-border">
            {history.map((invitation) => (
              <li key={invitation.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-semibold text-text">{invitation.email}</p><p className="text-sm text-muted">{platformRoleLabel(invitation.role)}</p></div>
                <p className="text-sm font-semibold text-muted">{platformRoleLabel(invitation.effectiveStatus)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
