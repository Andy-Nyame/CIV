import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WorkspaceForm } from "@/components/ui/workspace-form";
import { requireUser } from "@/features/auth/session";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";

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

  return (
    <section className="w-full max-w-3xl rounded-2xl border border-border bg-surface p-6 sm:p-8">
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
      <WorkspaceForm defaultName={getSuggestedWorkspaceName(user.name)} />
    </section>
  );
}
