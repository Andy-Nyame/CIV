import type { Metadata } from "next";
import Link from "next/link";

import { PlanSwitchCard } from "@/components/ui/plan-switch-card";
import { PageHeading } from "@/components/ui/page-heading";
import { getPlanSettingsPageData } from "@/features/subscriptions/queries";

export const metadata: Metadata = { title: "Plan & Storage" };

function formatUsage(usage: number, limit: number | null) {
  return `${usage.toLocaleString("en-GH")} / ${
    limit === null ? "Custom" : limit.toLocaleString("en-GH")
  }`;
}

function formatBetaPrice(betaPrice: string, currency: string) {
  const amount = Number(betaPrice).toLocaleString("en-GH", {
    maximumFractionDigits: 2,
  });
  return currency === "GHS" ? `GH₵${amount}` : `${currency} ${amount}`;
}

export default async function PlanSettingsPage() {
  const data = await getPlanSettingsPageData();

  return (
    <div>
      <PageHeading
        title="Plan & Storage"
        description={`Review limits and choose the beta plan for ${data.workspace.name}.`}
      />

      <p className="mt-7 rounded-xl border border-civ-blue bg-active px-4 py-3 text-sm leading-6 text-text">
        All CIV plans are free during beta. Plan limits remain active so every tier can be tested.
      </p>

      <div className="mt-4 flex justify-end">
        <Link
          href="/app/settings/credits"
          className="min-h-11 rounded-lg border border-civ-blue px-4 py-3 text-sm font-semibold text-link hover:bg-hover"
        >
          View Document Credits
        </Link>
      </div>

      <section className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="current-plan-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-link">Current plan</p>
            <h2 id="current-plan-title" className="mt-1 text-2xl font-bold text-text">
              {data.currentPlan.name}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {formatBetaPrice(data.currentPlan.betaPrice, data.currentPlan.currency)} during beta · {data.subscriptionStatus}
            </p>
          </div>
          {!data.canManageSubscription ? (
            <p className="max-w-xs text-sm leading-6 text-muted">
              You can view this plan. Only the Workspace Owner can change it.
            </p>
          ) : null}
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-page p-4">
            <dt className="text-sm text-muted">Active members</dt>
            <dd className="mt-1 text-xl font-bold text-text">
              {formatUsage(data.usage.activeMembers, data.currentPlan.memberLimit)}
            </dd>
            <p className="mt-1 text-xs text-muted">
              {data.usage.pendingInvitations.toLocaleString("en-GH")} valid pending invitation{data.usage.pendingInvitations === 1 ? "" : "s"} reserve capacity.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-page p-4">
            <dt className="text-sm text-muted">Reserved member capacity</dt>
            <dd className="mt-1 text-xl font-bold text-text">
              {formatUsage(data.usage.reservedMemberCapacity, data.currentPlan.memberLimit)}
            </dd>
            <p className="mt-1 text-xs text-muted">Active members plus valid pending invitations.</p>
          </div>
          <div className="rounded-lg border border-border bg-page p-4">
            <dt className="text-sm text-muted">Monthly document usage</dt>
            <dd className="mt-1 text-xl font-bold text-text">
              {formatUsage(data.usage.issuedDocuments, data.currentPlan.documentLimit)}
            </dd>
            <p className="mt-1 text-xs text-muted">The allowance renews by subscription period. Purchased credits are managed separately.</p>
          </div>
        </dl>
      </section>

      <section className="mt-10" aria-labelledby="beta-plans-title">
        <div className="max-w-2xl">
          <h2 id="beta-plans-title" className="text-xl font-bold text-text">Beta plans</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Switching changes workspace entitlements immediately. It does not add billing or delete existing records.
          </p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.plans.map((plan) => (
            <PlanSwitchCard
              key={plan.code}
              plan={plan}
              currentPlanCode={data.currentPlan.code}
              canManage={data.canManageSubscription}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
