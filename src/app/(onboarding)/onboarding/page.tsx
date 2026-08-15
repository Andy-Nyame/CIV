import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkspaceForm } from "@/components/ui/workspace-form";
import { ArchivedWorkspaceRestore } from "@/components/ui/archived-workspace-restore";
import { ActiveWorkspacePreferenceRepair } from "@/components/layout/active-workspace-preference-repair";
import { requireUser } from "@/features/auth/session";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";
import { getArchivedOwnedWorkspaces } from "@/features/workspaces/queries";

export const metadata: Metadata = {
  title: "Set Up Your Workspace",
};

function getSuggestedWorkspaceName(name: string | null | undefined) {
  const trimmedName = name?.trim();
  return trimmedName ? `${trimmedName}'s Workspace` : "My Workspace";
}

export default async function OnboardingPage() {
  const user = await requireUser();
  const workspaceContext = await getWorkspaceContextForUser(user.id);

  if (workspaceContext.current) {
    redirect("/app");
  }

  const archivedOwnedWorkspaces = await getArchivedOwnedWorkspaces(user.id);

  return (
    <section className="w-full max-w-3xl rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <ActiveWorkspacePreferenceRepair
        currentWorkspaceId={null}
        needed={workspaceContext.preferenceNeedsRepair}
      />
      <div className="mb-8 max-w-2xl">
        <p className="text-sm font-semibold text-link">Welcome to CIV</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-text sm:text-3xl">
          Create your first workspace
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted sm:text-base">
          Your workspace keeps its documents, people, and settings separate from
          your personal CIV account.
        </p>
      </div>
      {archivedOwnedWorkspaces.length ? (
        <section className="mb-8 rounded-xl border border-border bg-page p-4" aria-labelledby="restore-workspace-heading">
          <h2 id="restore-workspace-heading" className="font-semibold text-text">Restore an archived workspace</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Restore an existing workspace instead of creating a new one.</p>
          <div className="mt-4 grid gap-3">
            {archivedOwnedWorkspaces.map(({ workspace }) => (
              <ArchivedWorkspaceRestore key={workspace.id} workspace={workspace} />
            ))}
          </div>
        </section>
      ) : null}
      <WorkspaceForm defaultName={getSuggestedWorkspaceName(user.name)} />
    </section>
  );
}
