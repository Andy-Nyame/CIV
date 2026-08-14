import type { Metadata } from "next";
import Link from "next/link";

import { PageHeading } from "@/components/ui/page-heading";
import { CAPABILITIES, hasCapability } from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const context = await requirePageCapability(CAPABILITIES.VIEW_WORKSPACE);
  const canViewSubscription = hasCapability(
    context.membership,
    CAPABILITIES.VIEW_SUBSCRIPTION,
  );

  return (
    <div>
      <PageHeading
        title="Settings"
        description="Manage your workspace and CIV preferences."
      />
      <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Workspace settings">
        {canViewSubscription ? (
          <Link
            href="/app/settings/plan"
            className="rounded-xl border border-border bg-surface p-5 hover:bg-hover"
          >
            <h2 className="font-semibold text-text">Plan & Storage</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Review the current beta plan, member capacity, and issued-document storage limits.
            </p>
          </Link>
        ) : null}
        <div className="rounded-xl border border-dashed border-border bg-surface p-5">
          <h2 className="font-semibold text-text">Workspace preferences</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Additional workspace preferences will be added in a later phase.
          </p>
        </div>
      </section>
    </div>
  );
}
