import type { Metadata } from "next";

import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { formatLimit } from "@/features/platform-admin/presentation";
import { listPlatformPlans } from "@/features/platform-admin/queries";

export const metadata: Metadata = { title: "Plans" };

export default async function PlatformPlansPage() {
  await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_PLANS);
  const plans = await listPlatformPlans();
  return (
    <div>
      <PlatformPageHeading title="Plans" description="Seeded beta-plan limits and real workspace distribution. Pricing management is not enabled." />
      <p className="mt-6 rounded-xl border border-border bg-soft-blue p-4 text-sm leading-6 text-civ-navy dark:bg-surface-muted dark:text-text">All CIV plans are GH₵0 during beta. Limits remain active for product testing.</p>
      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="CIV beta plans">
        {plans.map((plan) => (
          <article key={plan.code} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-wide text-link">{plan.code}</p><h2 className="mt-1 text-xl font-bold text-text">{plan.name}</h2></div>
              <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-verification">GH₵{plan.betaPrice}</span>
            </div>
            <dl className="mt-5 grid gap-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted">Workspaces</dt><dd className="font-semibold text-text">{plan.workspaces.toLocaleString()}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Member limit</dt><dd className="font-semibold text-text">{formatLimit(plan.memberLimit)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Document limit</dt><dd className="font-semibold text-text">{formatLimit(plan.documentLimit)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Configuration</dt><dd className="font-semibold text-text">{plan.isActive && plan.isPublic ? "Active" : "Restricted"}</dd></div>
            </dl>
          </article>
        ))}
      </section>
    </div>
  );
}
