import type { Metadata } from "next";

import { PageHeading } from "@/components/ui/page-heading";
import { getTeamPageData } from "@/features/team/queries";

export const metadata: Metadata = { title: "Team" };

function formatEnumLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default async function TeamPage() {
  const { workspace, currentMembership, members } = await getTeamPageData();

  return (
    <div>
      <PageHeading
        title="Team"
        description={`People with access to ${workspace.name}.`}
      />

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
              className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-6"
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
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
