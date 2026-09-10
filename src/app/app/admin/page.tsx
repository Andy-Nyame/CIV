import type { Metadata } from "next";
import Link from "next/link";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PageHeading } from "@/components/ui/page-heading";
import { PlatformStatCard } from "@/components/ui/platform-stat-card";
import { requireUser } from "@/features/auth/session";
import { getSuperAdminDashboard } from "@/features/platform-admin/super-admin-dashboard";

export const metadata: Metadata = { title: "Overview" };

function workspaceTypeLabel(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default async function SuperAdminPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [user, query] = await Promise.all([requireUser(), searchParams]);
  const dashboard = await getSuperAdminDashboard({ actorUserId: user.id, page: query.page });
  const metrics = dashboard.metrics;

  return (
    <div>
      <PageHeading
        title="Super Admin"
        description="Platform visibility and safe CIV testing controls. Normal workspaces keep their taxpayer and VAT requirements."
        action={<Link className="inline-flex min-h-11 items-center rounded-lg bg-civ-blue px-4 text-sm font-bold text-white hover:bg-civ-blue-hover" href="/app/workspaces/new?environment=TEST">Create TEST workspace</Link>}
      />

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Platform overview">
        <PlatformStatCard label="Total users" value={metrics.totalUsers.toLocaleString()} />
        <PlatformStatCard label="Total workspaces" value={metrics.totalWorkspaces.toLocaleString()} />
        <PlatformStatCard label="Normal workspaces" value={metrics.normalWorkspaces.toLocaleString()} />
        <PlatformStatCard label="TEST workspaces" value={metrics.testWorkspaces.toLocaleString()} />
        <PlatformStatCard label="Total documents" value={metrics.totalDocuments.toLocaleString()} />
        <PlatformStatCard label="Issued documents" value={metrics.issuedDocuments.toLocaleString()} />
        <PlatformStatCard label="TEST documents" value={metrics.testDocuments.toLocaleString()} detail="Always marked not valid" />
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="system-status-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="system-status-heading" className="font-bold text-text">System information</h2>
            <p className="mt-1 text-sm text-muted">Safe operational labels only; credentials and configuration values are never rendered.</p>
          </div>
          <span className="rounded-full bg-success-soft px-3 py-1 text-xs font-bold text-verification">SUPER ADMIN</span>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="font-semibold text-muted">Environment</dt><dd className="mt-1 text-text">{dashboard.system.applicationEnvironment}</dd></div>
          <div><dt className="font-semibold text-muted">Database</dt><dd className="mt-1 text-text">{dashboard.system.databaseStatus}</dd></div>
          <div><dt className="font-semibold text-muted">Document types</dt><dd className="mt-1 text-text">{dashboard.system.documentTypes.map((type) => type.replaceAll("_", " ")).join(", ")}</dd></div>
        </dl>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="workspace-list-heading">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 id="workspace-list-heading" className="font-bold text-text">Workspace inspection</h2>
          <p className="mt-1 text-sm text-muted">Newest workspaces, {dashboard.pagination.pageSize} per page. Taxpayer identifiers are not loaded into this table response.</p>
        </div>
        {dashboard.workspaces.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[76rem] text-left text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
                <tr>{["Workspace", "Environment", "Owner", "Taxpayer readiness", "VAT", "Verification", "Documents", "Created"].map((heading) => <th className="px-5 py-3 font-semibold" key={heading}>{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dashboard.workspaces.map((workspace) => (
                  <tr key={workspace.id}>
                    <td className="px-5 py-4"><Link className="font-bold text-link hover:underline" href={`/app/admin/workspaces/${workspace.id}`}>{workspace.name}</Link><p className="mt-1 text-xs text-muted">{workspaceTypeLabel(workspace.type)}{workspace.archivedAt ? " · Archived" : ""}</p></td>
                    <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${workspace.environment === "TEST" ? "bg-danger text-white" : "bg-surface-muted text-text"}`}>{workspace.environment}</span></td>
                    <td className="px-5 py-4 text-muted">{workspace.owner?.name?.trim() || workspace.owner?.email || "Owner unavailable"}</td>
                    <td className="px-5 py-4"><span className={`font-semibold ${workspace.taxpayerReady ? "text-verification" : "text-warning"}`}>{workspace.environment === "TEST" ? "TEST bypass" : workspace.taxpayerReady ? "Ready" : "Incomplete"}</span>{workspace.environment === "NORMAL" && workspace.readinessIssues.length ? <p className="mt-1 text-xs text-muted">{workspace.readinessIssues.length} requirement{workspace.readinessIssues.length === 1 ? "" : "s"} missing</p> : null}</td>
                    <td className="px-5 py-4 text-muted">{workspace.vatRegistered ? "Registered" : "Not registered"}</td>
                    <td className="px-5 py-4 text-muted">{workspace.taxpayerVerificationStatus === "VERIFIED" ? "Verified" : "Unverified"}</td>
                    <td className="px-5 py-4 text-muted">{workspace.documentCount.toLocaleString()}</td>
                    <td className="px-5 py-4 text-muted"><LocalDateTime value={workspace.createdAt.toISOString()} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 py-12 text-center text-muted">No workspaces found on this page.</p>}
        <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-4 text-sm">
          <p className="text-muted">Page {dashboard.pagination.page} of {dashboard.pagination.totalPages}</p>
          <div className="flex gap-2">
            {dashboard.pagination.page > 1 ? <Link className="rounded-lg border border-border px-3 py-2 font-semibold text-text hover:bg-hover" href={`/app/admin?page=${dashboard.pagination.page - 1}`}>Previous</Link> : null}
            {dashboard.pagination.page < dashboard.pagination.totalPages ? <Link className="rounded-lg border border-border px-3 py-2 font-semibold text-text hover:bg-hover" href={`/app/admin?page=${dashboard.pagination.page + 1}`}>Next</Link> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
