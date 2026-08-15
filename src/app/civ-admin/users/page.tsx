import type { Metadata } from "next";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { platformRoleLabel } from "@/features/platform-admin/presentation";
import { listPlatformUsers } from "@/features/platform-admin/queries";

export const metadata: Metadata = { title: "Users" };

export default async function PlatformUsersPage() {
  await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_USERS);
  const users = await listPlatformUsers();

  return (
    <div>
      <PlatformPageHeading title="Users" description="Read-only account identity and sign-in-method indicators for platform operations." />
      <section className="mt-8 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="platform-users-heading">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 id="platform-users-heading" className="font-semibold text-text">Newest CIV accounts</h2>
          <p className="mt-1 text-sm text-muted">Showing up to 50 accounts. Sensitive authentication fields are excluded.</p>
        </div>
        {users.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Methods</th>
                  <th className="px-5 py-3 font-semibold">Workspaces</th>
                  <th className="px-5 py-3 font-semibold">Platform access</th>
                  <th className="px-5 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-text">{user.name?.trim() || "Unnamed user"}</p>
                      <p className="mt-0.5 text-muted">{user.email || "No email"}</p>
                    </td>
                    <td className="px-5 py-4 text-muted">
                      {[user.hasPassword ? "Password" : null, user.hasGoogle ? "Google" : null].filter(Boolean).join(" · ") || "No connected method"}
                    </td>
                    <td className="px-5 py-4 text-muted">{user.workspaceMemberships}</td>
                    <td className="px-5 py-4 text-muted">
                      {user.platformMembership
                        ? `${platformRoleLabel(user.platformMembership.role)} · ${platformRoleLabel(user.platformMembership.status)}`
                        : "None"}
                    </td>
                    <td className="px-5 py-4 text-muted"><LocalDateTime value={user.createdAt.toISOString()} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-12 text-center text-muted">No users found.</p>
        )}
      </section>
    </div>
  );
}
