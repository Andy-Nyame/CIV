import type { Metadata } from "next";
import Link from "next/link";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PlanSwitchCard } from "@/components/ui/plan-switch-card";
import { RecurringCancellationControl } from "@/components/ui/recurring-subscription-controls";
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
  const trialDaysRemaining = data.activeTrial
    ? Math.max(
        1,
        Math.ceil(
          (data.activeTrial.endsAt.getTime() - data.resolvedAt.getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : null;

  return (
    <div>
      <PageHeading
        title="Plan & Storage"
        description={`Review limits and recurring Test Mode options for ${data.workspace.name}.`}
      />

      <p className="mt-7 rounded-xl border border-civ-blue bg-active px-4 py-3 text-sm leading-6 text-text">
        Paystack recurring checkout is in Test Mode. Free plans require no payment; configured paid plans use card-only monthly billing. No live money is processed.
      </p>

      <div className="mt-4 flex justify-end">
        <Link
          href="/app/settings/credits"
          className="min-h-11 rounded-lg border border-civ-blue px-4 py-3 text-sm font-semibold text-link hover:bg-hover"
        >
          View Document Credits
        </Link>
      </div>

      {data.activeTrial ? (
        <section className="mt-8 rounded-xl border border-civ-blue bg-active p-5 sm:p-6" aria-labelledby="trial-status-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-link">Active free trial</p>
              <h2 id="trial-status-title" className="mt-1 text-2xl font-bold text-text">{data.activeTrial.trialPlanNameSnapshot} Trial</h2>
              <p className="mt-2 text-sm leading-6 text-text">
                {trialDaysRemaining === 1 ? "1 day remaining" : `${trialDaysRemaining} days remaining`} · Ends <LocalDateTime value={data.activeTrial.endsAt.toISOString()} />
              </p>
            </div>
            <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-link">Trial active</span>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted">
            Your normal plan is {data.currentPlan.name}. After the trial, {data.currentPlan.name} limits apply automatically. Members, data, purchased credits, and stored assets remain in place.
          </p>
        </section>
      ) : data.latestTrial ? (
        <p className="mt-8 rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
          Your latest {data.latestTrial.trialPlanNameSnapshot} trial is {data.latestTrial.status.toLowerCase()}. The normal {data.currentPlan.name} plan is active.
        </p>
      ) : null}

      <section className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="current-plan-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-link">{data.activeTrial ? "Normal plan" : "Current plan"}</p>
            <h2 id="current-plan-title" className="mt-1 text-2xl font-bold text-text">
              {data.currentPlan.name}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {data.currentPlan.billingMode === "RECURRING"
                ? `${formatBetaPrice(data.currentPlan.monthlyPrice, data.currentPlan.currency)} monthly`
                : data.currentPlan.billingMode === "CUSTOM"
                  ? "Custom terms"
                  : "No recurring payment"} · {data.subscriptionStatus}
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
              {formatUsage(data.usage.activeMembers, data.effectivePlan.memberLimit)}
            </dd>
            <p className="mt-1 text-xs text-muted">
              {data.usage.pendingInvitations.toLocaleString("en-GH")} valid pending invitation{data.usage.pendingInvitations === 1 ? "" : "s"} reserve capacity.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-page p-4">
            <dt className="text-sm text-muted">Reserved member capacity</dt>
            <dd className="mt-1 text-xl font-bold text-text">
              {formatUsage(data.usage.reservedMemberCapacity, data.effectivePlan.memberLimit)}
            </dd>
            <p className="mt-1 text-xs text-muted">Active members plus valid pending invitations.</p>
          </div>
          <div className="rounded-lg border border-border bg-page p-4">
            <dt className="text-sm text-muted">Monthly document usage</dt>
            <dd className="mt-1 text-xl font-bold text-text">
              {formatUsage(data.usage.issuedDocuments, data.effectivePlan.documentLimit)}
            </dd>
            <p className="mt-1 text-xs text-muted">The allowance renews by subscription period. Purchased credits are managed separately.</p>
          </div>
        </dl>
      </section>

      {data.recurringBilling.connected && data.recurringBilling.currentPeriodEnd ? (
        <section className="mt-6" aria-label="Recurring subscription controls">
          {data.recurringBilling.cancelAtPeriodEnd ? (
            <p className="rounded-xl border border-border bg-surface p-5 text-sm leading-6 text-muted">
              Renewal is cancelled. {data.currentPlan.name} access continues until <LocalDateTime value={data.recurringBilling.currentPeriodEnd.toISOString()} />, then {data.recurringBilling.fallbackPlan?.name ?? "the fallback plan"} applies.
            </p>
          ) : data.canManageSubscription ? (
            <RecurringCancellationControl planName={data.currentPlan.name} periodEnd={data.recurringBilling.currentPeriodEnd.toISOString()} />
          ) : null}
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="beta-plans-title">
        <div className="max-w-2xl">
          <h2 id="beta-plans-title" className="text-xl font-bold text-text">Available plans</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            A paid plan activates only after verified Paystack payment. CIV does not apply unsupported mid-cycle proration; cancel the current renewal before starting another recurring plan.
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
