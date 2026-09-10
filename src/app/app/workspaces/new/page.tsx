import type { Metadata } from "next";

import { WorkspaceForm } from "@/components/ui/workspace-form";
import { PageHeading } from "@/components/ui/page-heading";
import { requireUser } from "@/features/auth/session";
import { isSuperAdminUserId } from "@/features/platform-admin/super-admin";

export const metadata: Metadata = {
  title: "New Workspace",
};

export default async function NewWorkspacePage() {
  const user = await requireUser();
  const canCreateTestWorkspace = await isSuperAdminUserId(user.id);
  return (
    <div>
      <PageHeading
        title="Create another workspace"
        description="Set up a separate CIV environment for another business or organization."
      />
      <section className="mt-8 max-w-3xl rounded-xl border border-border bg-surface p-5 sm:p-7">
        <WorkspaceForm canCreateTestWorkspace={canCreateTestWorkspace} />
      </section>
    </div>
  );
}
