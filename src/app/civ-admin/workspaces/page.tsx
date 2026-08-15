import type { Metadata } from "next";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { platformRoleLabel } from "@/features/platform-admin/presentation";
import { listPlatformWorkspaces } from "@/features/platform-admin/queries";

export const metadata: Metadata = { title: "Workspaces" };

export default async function PlatformWorkspacesPage() {
  await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_WORKSPACES);
  const workspaces = await listPlatformWorkspaces();

  return (
    <div>
      <PlatformPageHeading title="Workspaces" description="Operational workspace identity, lifecycle, ownership, and plan metadata only." />
      <section className="mt-8 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 className="font-semibold text-text">Newest workspaces</h2>
          <p className="mt-1 text-sm text-muted">Showing up to 50 workspaces without customer document or private-file contents.</p>
        </div>
        {workspaces.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[70rem] text-left text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
                <tr>
                  {['Workspace', 'State', 'Owner', 'Plan', 'Members', 'Pending invites', 'Created'].map((heading) => (
                    <th key={heading} className="px-5 py-3 font-semibold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {workspaces.map((workspace) => {
                  const owner = workspace.memberships[0]?.user;
                  return (
                    <tr key={workspace.id}>
                      <td className="px-5 py-4"><p className="font-semibold text-text">{workspace.name}</p><p className="mt-0.5 text-muted">{platformRoleLabel(workspace.type)}</p></td>
                      <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${workspace.archivedAt ? "bg-surface-muted text-muted" : "bg-success-soft text-verification"}`}>{workspace.archivedAt ? "Archived" : "Active"}</span></td>
                      <td className="px-5 py-4 text-muted">{owner?.name?.trim() || owner?.email || "Owner unavailable"}</td>
                      <td className="px-5 py-4 text-muted">{workspace.subscription?.plan.name || "No plan"}</td>
                      <td className="px-5 py-4 text-muted">{workspace._count.memberships}</td>
                      <td className="px-5 py-4 text-muted">{workspace._count.invitations}</td>
                      <td className="px-5 py-4 text-muted"><LocalDateTime value={workspace.createdAt.toISOString()} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 py-12 text-center text-muted">No workspaces found.</p>}
      </section>
    </div>
  );
}
