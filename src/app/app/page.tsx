import type { Metadata } from "next";

import { CreateDocumentMenu } from "@/components/ui/create-document-menu";
import { PageHeading } from "@/components/ui/page-heading";
import { requireUser } from "@/features/auth/session";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";

export const metadata: Metadata = {
  title: "Home",
};

const summaries = [
  { label: "Documents", value: "0" },
  { label: "Outstanding", value: "—" },
  { label: "Vault Usage", value: "—" },
];

export default async function DashboardPage() {
  const user = await requireUser();
  const workspaceContext = await getWorkspaceContextForUser(user.id);
  const workspaceName = workspaceContext.current?.name ?? "your workspace";

  return (
    <div>
      <PageHeading
        title="Welcome to CIV"
        description={`Create, issue and manage professional business documents for ${workspaceName}.`}
        action={<CreateDocumentMenu label="Create Document" />}
      />

      <section className="mt-8 grid gap-4 sm:grid-cols-3" aria-label="Workspace summary">
        {summaries.map((summary) => (
          <article
            key={summary.label}
            className="rounded-xl border border-border bg-surface p-5"
          >
            <p className="text-sm font-medium text-muted">{summary.label}</p>
            <p className="mt-3 text-2xl font-bold text-text">{summary.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-xl border border-border bg-surface" aria-labelledby="recent-documents-title">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 id="recent-documents-title" className="text-lg font-semibold text-text">
            Recent Documents
          </h2>
        </div>
        <div className="grid min-h-56 place-items-center px-5 py-10 text-center sm:px-6">
          <div>
            <p className="font-semibold text-text">No documents yet</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted">
              Your recent drafts and issued documents will appear here once document
              creation is enabled.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
