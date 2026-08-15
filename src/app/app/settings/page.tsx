import type { Metadata } from "next";
import Link from "next/link";

import { ArchivedWorkspaceRestore } from "@/components/ui/archived-workspace-restore";
import { PageHeading } from "@/components/ui/page-heading";
import { WorkspaceDangerZone } from "@/components/ui/workspace-danger-zone";
import { WorkspaceLogoControl } from "@/components/ui/workspace-logo-control";
import { WorkspaceSettingsForm } from "@/components/ui/workspace-settings-form";
import { getWorkspaceSettingsPageData } from "@/features/workspaces/queries";

export const metadata: Metadata = { title: "Workspace Settings" };

export default async function SettingsPage() {
  const data = await getWorkspaceSettingsPageData();

  return (
    <div>
      <PageHeading
        title="Workspace Settings"
        description={`Manage ${data.workspace.name} separately from your personal CIV profile.`}
      />

      <nav className="mt-7 flex gap-2 overflow-x-auto pb-1" aria-label="Settings sections">
        {["General", "Business Details", "Branding", "Plan & Storage", "Security", "Danger Zone"].map((label) => (
          <a key={label} href={`#${label.toLowerCase().replaceAll(" ", "-").replace("&-", "")}`} className="min-h-10 shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted hover:bg-hover hover:text-text">
            {label}
          </a>
        ))}
      </nav>

      <div id="general" className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-7">
        <WorkspaceSettingsForm
          workspace={data.workspace}
          canManage={data.canManageSettings}
        />
      </div>

      <section id="branding" className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-7" aria-labelledby="branding-heading">
        <h2 id="branding-heading" className="text-xl font-bold text-text">Branding</h2>
        <p className="mt-1 text-sm leading-6 text-muted">Manage the private logo and display identity for this workspace.</p>
        <div className="mt-5">
          <WorkspaceLogoControl
            workspaceName={data.workspace.name}
            logoUrl={data.logoUrl}
            canManage={data.canManageSettings}
          />
        </div>
      </section>

      <section id="plan-storage" className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-7" aria-labelledby="plan-storage-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="plan-storage-heading" className="text-xl font-bold text-text">Plan & Storage</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Review the beta plan, member capacity, and issued-document storage limits.</p>
          </div>
          {data.canViewSubscription ? (
            <Link href="/app/settings/plan" className="min-h-11 shrink-0 rounded-lg bg-civ-blue px-4 py-3 text-center text-sm font-semibold text-white hover:bg-civ-blue-hover">Open Plan & Storage</Link>
          ) : (
            <span className="text-sm text-muted">Available to Owners and Admins.</span>
          )}
        </div>
      </section>

      <section id="security" className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-7" aria-labelledby="security-heading">
        <h2 id="security-heading" className="text-xl font-bold text-text">Security</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-surface-muted p-4">
            <h3 className="font-semibold text-text">Capability-based access</h3>
            <p className="mt-1 text-sm leading-6 text-muted">Your current role is {data.membership.role}. Workspace permissions are revalidated on the server.</p>
          </div>
          <div className="rounded-lg bg-surface-muted p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-text">Workspace Security Lock</h3>
              <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted">Not enabled</span>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">Future re-authentication protection will not use an insecure shared workspace password.</p>
          </div>
        </div>
      </section>

      {data.archivedOwnedWorkspaces.length ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-7" aria-labelledby="archived-workspaces-heading">
          <h2 id="archived-workspaces-heading" className="text-xl font-bold text-text">Archived Workspaces</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Restore an archived workspace you own without creating a duplicate.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {data.archivedOwnedWorkspaces.map((workspace) => (
              <ArchivedWorkspaceRestore key={workspace.id} workspace={workspace} />
            ))}
          </div>
        </section>
      ) : null}

      <section id="danger-zone" className="mt-6 rounded-xl border border-danger/50 bg-surface p-5 sm:p-7" aria-labelledby="danger-zone-heading">
        <h2 id="danger-zone-heading" className="text-xl font-bold text-danger">Danger Zone</h2>
        <p className="mt-1 text-sm leading-6 text-muted">Lifecycle changes require explicit confirmation and preserve retained CIV history.</p>
        <div className="mt-6">
          <WorkspaceDangerZone
            workspaceName={data.workspace.name}
            isOwner={data.isOwner}
            transferCandidates={data.workspace.memberships}
          />
        </div>
      </section>
    </div>
  );
}
