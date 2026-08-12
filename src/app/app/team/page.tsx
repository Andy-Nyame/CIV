import type { Metadata } from "next";

import { cancelInvitationAction } from "@/features/team/actions";
import { InviteMemberForm } from "@/components/ui/invite-member-form";
import { MemberManagementForm } from "@/components/ui/member-management-form";
import { PageHeading } from "@/components/ui/page-heading";
import { RenewInvitationForm } from "@/components/ui/renew-invitation-form";
import { getTeamPageData } from "@/features/team/queries";

export const metadata: Metadata = { title: "Team" };

function formatEnumLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default async function TeamPage() {
  const {
    workspace,
    currentMembership,
    members,
    invitations,
    canManageTeam,
  } = await getTeamPageData();

  return (
    <div>
      <PageHeading
        title="Team"
        description={`People with access to ${workspace.name}.`}
      />

      {canManageTeam ? (
        <section className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="text-base font-semibold text-text">Invite member</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Create a secure link to share manually. Invitations expire after seven days.
          </p>
          <div className="mt-5">
            <InviteMemberForm />
          </div>
        </section>
      ) : null}

      <section
        className="mt-8 overflow-hidden rounded-xl border border-border bg-surface"
        aria-labelledby="workspace-members-title"
      >
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="workspace-members-title"
              className="text-base font-semibold text-text"
            >
              Workspace members
            </h2>
            <p className="text-xs font-medium text-muted">
              Your role: {formatEnumLabel(currentMembership.role)}
            </p>
          </div>
        </div>

        <ul className="divide-y divide-border" aria-label="Workspace members">
          {members.map((member) => (
            <li
              key={member.id}
              className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,auto)] sm:items-center sm:px-6"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text">
                  {member.user.name?.trim() || "Unnamed member"}
                </p>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {member.user.email || "No email available"}
                </p>
              </div>
              <p className="text-sm text-muted">
                <span className="sr-only">Role: </span>
                {formatEnumLabel(member.role)}
              </p>
              <p
                className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
                  member.status === "ACTIVE"
                    ? "bg-success-soft text-success"
                    : "bg-hover text-muted"
                }`}
              >
                <span className="sr-only">Status: </span>
                {formatEnumLabel(member.status)}
              </p>
              {canManageTeam && member.role !== "OWNER" ? (
                <MemberManagementForm
                  membershipId={member.id}
                  role={member.role}
                  status={member.status}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {canManageTeam ? (
        <section className="mt-8 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4 sm:px-6">
            <h2 className="text-base font-semibold text-text">Invitations</h2>
            <p className="mt-1 text-sm text-muted">
              Pending and historical workspace invitations.
            </p>
          </div>
          {invitations.length ? (
            <ul className="divide-y divide-border">
              {invitations.map((invitation) => {
                const expired =
                  invitation.status === "PENDING" &&
                  invitation.expiresAt <= new Date();
                const status = expired ? "EXPIRED" : invitation.status;

                return (
                  <li key={invitation.id} className="grid gap-3 px-5 py-4 sm:px-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-text">
                          {invitation.email}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          {formatEnumLabel(invitation.role)} · {formatEnumLabel(status)} · Expires{" "}
                          <time dateTime={invitation.expiresAt.toISOString()}>
                            {invitation.expiresAt.toLocaleDateString("en-GH", {
                              dateStyle: "medium",
                              timeZone: "UTC",
                            })}
                          </time>
                        </p>
                      </div>
                      {invitation.status === "PENDING" ? (
                        <div className="flex flex-wrap gap-2">
                          <RenewInvitationForm invitationId={invitation.id} />
                          <form action={cancelInvitationAction}>
                            <input
                              type="hidden"
                              name="invitationId"
                              value={invitation.id}
                            />
                            <button className="min-h-10 rounded-lg border border-danger px-3 text-sm font-semibold text-danger hover:bg-hover">
                              Cancel
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-8 text-sm text-muted sm:px-6">
              No invitations have been created for this workspace.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
