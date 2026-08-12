import type { Metadata } from "next";

import { WorkspaceForm } from "@/components/ui/workspace-form";
import { PageHeading } from "@/components/ui/page-heading";

export const metadata: Metadata = {
  title: "New Workspace",
};

export default function NewWorkspacePage() {
  return (
    <div>
      <PageHeading
        title="Create another workspace"
        description="Set up a separate CIV environment for another business or organization."
      />
      <section className="mt-8 max-w-3xl rounded-xl border border-border bg-surface p-5 sm:p-7">
        <WorkspaceForm />
      </section>
    </div>
  );
}
