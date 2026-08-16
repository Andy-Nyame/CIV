import type { Metadata } from "next";
import Link from "next/link";

import { CreateDocumentMenu } from "@/components/ui/create-document-menu";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { PageHeading } from "@/components/ui/page-heading";
import { requireUser } from "@/features/auth/session";
import {
  getWorkspaceCommercialSummary,
  getWorkspaceCommercialSummaryPermissions,
} from "@/features/commercial/workspace-summary";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";

export const metadata: Metadata = {
  title: "Home",
};

function label(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function quantity(value: number | null) {
  return value === null ? "Unlimited" : value.toLocaleString("en-GH");
}

export default async function DashboardPage() {
  const user = await requireUser();
  const workspaceContext = await getWorkspaceContextForUser(user.id);
  const currentWorkspace = workspaceContext.current;
  const workspaceName = currentWorkspace?.name ?? "your workspace";
  const commercialSummary = currentWorkspace
    ? await getWorkspaceCommercialSummary(currentWorkspace.id)
    : null;
  const permissions = currentWorkspace
    ? getWorkspaceCommercialSummaryPermissions(currentWorkspace.role)
    : null;
  const trialDaysRemaining = commercialSummary?.activeTrial
    ? Math.max(
        1,
        Math.ceil(
          (commercialSummary.activeTrial.endsAt.getTime() -
            commercialSummary.resolvedAt.getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : null;
  const allowanceUsedPercent =
    commercialSummary?.allowance.monthlyAllowance &&
    commercialSummary.allowance.monthlyAllowance > 0
      ? Math.min(
          100,
          Math.round(
            (commercialSummary.allowance.monthlyUsed /
              commercialSummary.allowance.monthlyAllowance) *
              100,
          ),
        )
      : 0;

  return (
    <div>
      <PageHeading
        title="Welcome to CIV"
        description={`Create, issue and manage professional business documents for ${workspaceName}.`}
        action={<CreateDocumentMenu label="Create Document" />}
      />

      {commercialSummary && permissions ? (
        <section
          className="mt-8 overflow-hidden rounded-xl border border-border bg-surface"
          aria-labelledby="workspace-plan-usage-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-5 sm:px-6">
            <div>
              <p className="text-sm font-semibold text-link">Active workspace</p>
              <h2 id="workspace-plan-usage-title" className="mt-1 text-2xl font-bold text-text">
                Workspace Plan &amp; Usage
              </h2>
              <p className="mt-1 text-sm text-muted">{commercialSummary.workspace.name}</p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Workspace and subscription status">
              <span className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-bold text-text">
                Workspace {label(commercialSummary.workspace.lifecycleStatus)}
              </span>
              <span className="rounded-full bg-active px-3 py-1.5 text-xs font-bold text-link">
                Subscription {label(commercialSummary.subscription.status)}
              </span>
            </div>
          </div>

          {commercialSummary.activeTrial ? (
            <div className="border-b border-civ-blue bg-active px-5 py-5 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div>
                  <p className="text-xs font-bold tracking-wide text-link uppercase">Current access</p>
                  <p className="mt-1 text-xl font-bold text-text">
                    {commercialSummary.effectivePlan.name} Trial
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Normal plan: <span className="font-semibold text-text">{commercialSummary.subscription.plan.name}</span>. After the trial ends, normal-plan limits apply.
                  </p>
                </div>
                <p className="text-sm leading-6 text-text sm:text-right">
                  <span className="block font-semibold">{trialDaysRemaining === 1 ? "1 day remaining" : `${trialDaysRemaining} days remaining`}</span>
                  Trial ends <LocalDateTime value={commercialSummary.activeTrial.endsAt.toISOString()} />
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
            <div className="px-5 py-6 sm:px-6 lg:border-r lg:border-border">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-muted">
                    {commercialSummary.activeTrial ? "Effective trial plan" : "Effective current plan"}
                  </p>
                  <p className="mt-1 text-3xl font-bold text-text">{commercialSummary.effectivePlan.name}</p>
                </div>
                {!commercialSummary.activeTrial && commercialSummary.latestTrial ? (
                  <p className="text-sm text-muted">
                    Latest trial: {label(commercialSummary.latestTrial.status)}
                  </p>
                ) : null}
              </div>

              <dl className="mt-7 grid gap-6 sm:grid-cols-3 sm:divide-x sm:divide-border">
                <div className="sm:pr-5">
                  <dt className="text-sm font-semibold text-muted">Monthly allowance</dt>
                  <dd className="mt-2 text-2xl font-bold text-text">
                    {commercialSummary.allowance.monthlyRemaining === null
                      ? "Unlimited"
                      : `${quantity(commercialSummary.allowance.monthlyRemaining)} / ${quantity(commercialSummary.allowance.monthlyAllowance)}`}
                  </dd>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {commercialSummary.allowance.monthlyRemaining === null
                      ? `${quantity(commercialSummary.allowance.monthlyUsed)} used this period`
                      : "remaining this period"}
                  </p>
                  {commercialSummary.allowance.monthlyAllowance !== null ? (
                    <div
                      className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"
                      role="progressbar"
                      aria-label="Monthly document allowance used"
                      aria-valuemin={0}
                      aria-valuemax={commercialSummary.allowance.monthlyAllowance}
                      aria-valuenow={Math.min(
                        commercialSummary.allowance.monthlyUsed,
                        commercialSummary.allowance.monthlyAllowance,
                      )}
                    >
                      <div className="h-full bg-civ-blue" style={{ width: `${allowanceUsedPercent}%` }} />
                    </div>
                  ) : null}
                </div>
                <div className="sm:px-5">
                  <dt className="text-sm font-semibold text-muted">Purchased credits</dt>
                  <dd className="mt-2 text-2xl font-bold text-text">
                    {quantity(commercialSummary.purchasedCredits)}
                  </dd>
                  <p className="mt-1 text-xs leading-5 text-muted">Owned by this workspace · carry forward</p>
                </div>
                <div className="sm:pl-5">
                  <dt className="text-sm font-semibold text-muted">Total available</dt>
                  <dd className="mt-2 text-2xl font-bold text-text">
                    {quantity(commercialSummary.totalAvailable)}
                  </dd>
                  <p className="mt-1 text-xs leading-5 text-muted">documents currently available</p>
                </div>
              </dl>

              <p className="mt-6 border-t border-border pt-4 text-sm leading-6 text-muted">
                Monthly allowance renews each billing period. Purchased credits belong to this workspace and carry forward.
              </p>
            </div>

            <div className="border-t border-border px-5 py-6 sm:px-6 lg:border-t-0">
              <h3 className="font-bold text-text">Period details</h3>
              <dl className="mt-4 grid gap-4 text-sm">
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Monthly used</dt><dd className="font-semibold text-text">{quantity(commercialSummary.allowance.monthlyUsed)}</dd></div>
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Allowance period</dt><dd className="text-right font-semibold text-text"><LocalDateTime value={commercialSummary.allowance.periodStart.toISOString()} dateOnly /> – <LocalDateTime value={commercialSummary.allowance.periodEnd.toISOString()} dateOnly /></dd></div>
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Next renewal</dt><dd className="text-right font-semibold text-text"><LocalDateTime value={commercialSummary.allowance.periodEnd.toISOString()} /></dd></div>
                {commercialSummary.activeTrial ? <div className="flex items-start justify-between gap-4"><dt className="text-muted">Normal plan</dt><dd className="font-semibold text-text">{commercialSummary.subscription.plan.name}</dd></div> : null}
                <div className="flex items-start justify-between gap-4"><dt className="text-muted">Trial status</dt><dd className="font-semibold text-text">{commercialSummary.activeTrial ? "Active" : commercialSummary.latestTrial ? label(commercialSummary.latestTrial.status) : "No trial"}</dd></div>
              </dl>
            </div>
          </div>

          {permissions.canViewCommercialSettings ? (
            <div className="flex flex-wrap gap-3 border-t border-border px-5 py-4 sm:px-6">
              <Link href="/app/settings/plan" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover">View Plan</Link>
              {permissions.canManageCommercialSettings ? <Link href="/app/settings/credits" className="inline-flex min-h-11 items-center rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link hover:bg-hover">Get More Credits</Link> : null}
              <Link href="/app/settings/billing" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover">Billing</Link>
            </div>
          ) : null}
        </section>
      ) : null}

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
