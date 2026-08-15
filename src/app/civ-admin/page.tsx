import type { Metadata } from "next";

import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PlatformStatCard } from "@/components/ui/platform-stat-card";
import {
  PLATFORM_CAPABILITIES,
  hasPlatformCapability,
} from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { getPlatformOverview } from "@/features/platform-admin/queries";

export const metadata: Metadata = { title: "Overview" };

export default async function PlatformOverviewPage() {
  const context = await requirePlatformPageCapability(
    PLATFORM_CAPABILITIES.VIEW_PLATFORM_DASHBOARD,
  );
  const includeAuthAnalytics = hasPlatformCapability(
    context.membership,
    PLATFORM_CAPABILITIES.VIEW_AUTH_ANALYTICS,
  );
  const includeStorageAnalytics = hasPlatformCapability(
    context.membership,
    PLATFORM_CAPABILITIES.VIEW_STORAGE_ANALYTICS,
  );
  const overview = await getPlatformOverview({
    includeAuthAnalytics,
    includeStorageAnalytics,
  });

  return (
    <div>
      <PlatformPageHeading
        title="Platform Overview"
        description="A real-time operational summary of CIV accounts, workspaces, plans, and retained metadata."
      />

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Platform statistics">
        <PlatformStatCard label="Total users" value={overview.totalUsers.toLocaleString()} />
        <PlatformStatCard label="Total workspaces" value={overview.totalWorkspaces.toLocaleString()} />
        <PlatformStatCard label="Active workspaces" value={overview.activeWorkspaces.toLocaleString()} />
        <PlatformStatCard label="Archived workspaces" value={overview.archivedWorkspaces.toLocaleString()} />
        <PlatformStatCard label="Workspace memberships" value={overview.totalMemberships.toLocaleString()} />
        <PlatformStatCard label="Pending invitations" value={overview.pendingInvitations.toLocaleString()} detail="Valid, unexpired invitations" />
        <PlatformStatCard label="Workspace audit events" value={overview.totalAuditEvents.toLocaleString()} />
        {overview.storage ? (
          <PlatformStatCard label="Private asset records" value={overview.storage.total.toLocaleString()} detail="Metadata only" />
        ) : null}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="plan-distribution-heading">
          <div className="border-b border-border px-5 py-4">
            <h2 id="plan-distribution-heading" className="font-semibold text-text">Plan distribution</h2>
            <p className="mt-1 text-sm text-muted">Current workspace subscriptions by plan.</p>
          </div>
          <ul className="divide-y divide-border">
            {overview.planDistribution.map((plan) => (
              <li key={plan.code} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="font-semibold text-text">{plan.name}</span>
                <span className="text-sm text-muted">{plan.workspaces.toLocaleString()} workspaces</span>
              </li>
            ))}
          </ul>
        </section>

        {overview.authentication ? (
          <section className="rounded-xl border border-border bg-surface p-5" aria-labelledby="auth-summary-heading">
            <h2 id="auth-summary-heading" className="font-semibold text-text">Authentication methods</h2>
            <p className="mt-1 text-sm text-muted">Safe account-method totals; no tokens or credentials are loaded.</p>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-muted p-4">
                <dt className="text-sm font-semibold text-muted">Password-enabled users</dt>
                <dd className="mt-2 text-2xl font-bold text-text">{overview.authentication.passwordUsers.toLocaleString()}</dd>
              </div>
              <div className="rounded-lg bg-surface-muted p-4">
                <dt className="text-sm font-semibold text-muted">Google account links</dt>
                <dd className="mt-2 text-2xl font-bold text-text">{overview.authentication.googleAccountLinks.toLocaleString()}</dd>
              </div>
            </dl>
          </section>
        ) : (
          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="font-semibold text-text">Restricted analytics</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Authentication and storage details are only shown to platform roles with the corresponding capability.</p>
          </section>
        )}
      </div>
    </div>
  );
}
