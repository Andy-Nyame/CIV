import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PageHeading } from "@/components/ui/page-heading";
import { PlatformStatCard } from "@/components/ui/platform-stat-card";
import { requireUser } from "@/features/auth/session";
import { SuperAdminWorkspaceNotFoundError, getSuperAdminWorkspaceDetail } from "@/features/platform-admin/super-admin-dashboard";
import { switchWorkspaceAction } from "@/features/workspaces/actions";

export const metadata: Metadata = { title: "Workspace inspection" };

function label(value: string | null) {
  return value ? value.replaceAll("_", " ").toLowerCase().replace(/^./, (character) => character.toUpperCase()) : "Not set";
}

export default async function SuperAdminWorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const [user, { workspaceId }] = await Promise.all([requireUser(), params]);
  let data: Awaited<ReturnType<typeof getSuperAdminWorkspaceDetail>>;
  try {
    data = await getSuperAdminWorkspaceDetail({ actorUserId: user.id, workspaceId });
  } catch (error) {
    if (error instanceof SuperAdminWorkspaceNotFoundError) notFound();
    throw error;
  }
  const workspace = data.workspace;
  const action = workspace.viewerCanOpen ? (
    <form action={switchWorkspaceAction}>
      <input type="hidden" name="workspaceId" value={workspace.id} />
      <button className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-bold text-white hover:bg-civ-blue-hover">Open in CIV</button>
    </form>
  ) : null;

  return (
    <div>
      <Link className="text-sm font-semibold text-link hover:underline" href="/app/admin">← Back to Super Admin</Link>
      <div className="mt-5"><PageHeading title={workspace.name} description="Read-only platform inspection. Normal-workspace compliance remains enforced." action={action} /></div>
      {workspace.environment === "TEST" ? <div className="mt-6 rounded-xl border-2 border-danger bg-danger px-5 py-4 text-center font-black tracking-wide text-white">TEST WORKSPACE — DOCUMENTS ARE NOT VALID</div> : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace summary">
        <PlatformStatCard label="Environment" value={workspace.environment} detail={workspace.environment === "TEST" ? "Taxpayer setup bypass for Super Admin testing" : "Normal compliance rules apply"} />
        <PlatformStatCard label="Taxpayer readiness" value={workspace.environment === "TEST" ? "TEST bypass" : workspace.taxpayerReady ? "Ready" : "Incomplete"} />
        <PlatformStatCard label="VAT registration" value={workspace.vatRegistered ? "Registered" : "Not registered"} />
        <PlatformStatCard label="Documents" value={workspace.documentCount.toLocaleString()} detail={`${data.documentSummary.issued.toLocaleString()} issued`} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="workspace-identity-heading">
          <h2 id="workspace-identity-heading" className="font-bold text-text">Workspace and taxpayer status</h2>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold text-muted">Workspace type</dt><dd className="mt-1 text-text">{label(workspace.type)}</dd></div>
            <div><dt className="font-semibold text-muted">Lifecycle</dt><dd className="mt-1 text-text">{workspace.archivedAt ? "Archived" : "Active"}</dd></div>
            <div><dt className="font-semibold text-muted">Legal name</dt><dd className="mt-1 text-text">{workspace.legalName || "Not set"}</dd></div>
            <div><dt className="font-semibold text-muted">Trading name</dt><dd className="mt-1 text-text">{workspace.tradingName || "Not set"}</dd></div>
            <div className="sm:col-span-2"><dt className="font-semibold text-muted">Business address</dt><dd className="mt-1 whitespace-pre-wrap text-text">{workspace.address || "Not set"}</dd></div>
            <div><dt className="font-semibold text-muted">Taxpayer ID type</dt><dd className="mt-1 text-text">{label(workspace.taxpayerIdType)}</dd></div>
            <div><dt className="font-semibold text-muted">Taxpayer ID</dt><dd className="mt-1 font-mono text-text">{workspace.maskedTaxpayerId || "Not set"}</dd></div>
            <div><dt className="font-semibold text-muted">Verification status</dt><dd className="mt-1 text-text">{label(workspace.taxpayerVerificationStatus)}</dd></div>
            <div><dt className="font-semibold text-muted">VAT registered</dt><dd className="mt-1 text-text">{workspace.vatRegistered ? "Yes" : "No"}</dd></div>
            <div><dt className="font-semibold text-muted">Created</dt><dd className="mt-1 text-text"><LocalDateTime value={workspace.createdAt.toISOString()} /></dd></div>
            <div><dt className="font-semibold text-muted">Updated</dt><dd className="mt-1 text-text"><LocalDateTime value={workspace.updatedAt.toISOString()} /></dd></div>
          </dl>
          {workspace.environment === "NORMAL" && workspace.readinessIssues.length ? <div className="mt-5 rounded-lg border border-warning bg-surface-muted p-4"><p className="font-semibold text-text">Missing setup</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{workspace.readinessIssues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></div> : null}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="document-summary-heading">
          <h2 id="document-summary-heading" className="font-bold text-text">Document summary</h2>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="font-semibold text-muted">Total</dt><dd className="mt-1 text-2xl font-bold text-text">{data.documentSummary.total.toLocaleString()}</dd></div>
            <div><dt className="font-semibold text-muted">Drafts</dt><dd className="mt-1 text-2xl font-bold text-text">{data.documentSummary.drafts.toLocaleString()}</dd></div>
            <div><dt className="font-semibold text-muted">Issued</dt><dd className="mt-1 text-2xl font-bold text-text">{data.documentSummary.issued.toLocaleString()}</dd></div>
            <div><dt className="font-semibold text-muted">Voided</dt><dd className="mt-1 text-2xl font-bold text-text">{data.documentSummary.voided.toLocaleString()}</dd></div>
            <div><dt className="font-semibold text-muted">TEST documents</dt><dd className="mt-1 text-2xl font-bold text-danger">{data.documentSummary.test.toLocaleString()}</dd></div>
          </dl>
          {!workspace.viewerCanOpen ? <p className="mt-5 rounded-lg bg-surface-muted p-4 text-sm leading-6 text-muted">Inspection does not grant workspace membership or impersonation. This workspace can only be opened in CIV if the Super Admin already has an active membership.</p> : null}
        </section>
      </div>

      <section className="mt-6 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="membership-heading">
        <div className="border-b border-border px-5 py-4 sm:px-6"><h2 id="membership-heading" className="font-bold text-text">Membership summary</h2><p className="mt-1 text-sm text-muted">{workspace.membershipCount.toLocaleString()} records · {(data.membershipSummary.ACTIVE ?? 0).toLocaleString()} active · {(data.membershipSummary.INVITED ?? 0).toLocaleString()} invited. Showing up to 50 without credentials or authentication data.</p></div>
        {workspace.memberships.length ? <div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-left text-sm"><thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted"><tr>{["Member", "Role", "Status", "Joined"].map((heading) => <th className="px-5 py-3 font-semibold" key={heading}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-border">{workspace.memberships.map((membership) => <tr key={membership.id}><td className="px-5 py-4"><p className="font-semibold text-text">{membership.user.name?.trim() || "Unnamed user"}</p><p className="mt-1 text-xs text-muted">{membership.user.email || "No email"}</p></td><td className="px-5 py-4 text-muted">{label(membership.role)}</td><td className="px-5 py-4 text-muted">{label(membership.status)}</td><td className="px-5 py-4 text-muted"><LocalDateTime value={membership.createdAt.toISOString()} /></td></tr>)}</tbody></table></div> : <p className="px-5 py-12 text-center text-muted">No membership records.</p>}
      </section>
    </div>
  );
}
