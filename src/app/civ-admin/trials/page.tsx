import type { Metadata } from "next";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { TrialCancelButton } from "@/components/ui/trial-cancel-button";
import { TrialConfigurationForm } from "@/components/ui/trial-configuration-form";
import { TrialGrantForm } from "@/components/ui/trial-grant-form";
import { getTrialManagementPageData } from "@/features/trials/queries";

export const metadata: Metadata = { title: "Trials" };

export default async function PlatformTrialsPage() {
  const data = await getTrialManagementPageData();
  return (
    <div>
      <PlatformPageHeading title="Trials" description="Configure free-trial policy, review real trial activity, and manage eligible workspace trials." />

      <dl className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total started", data.analytics.total],
          ["Active", data.analytics.active],
          ["Expired", data.analytics.expired],
          ["Cancelled", data.analytics.cancelled],
          ["Over fallback member limit", data.analytics.overFallbackMemberLimit],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-surface p-4"><dt className="text-sm text-muted">{label}</dt><dd className="mt-1 text-2xl font-bold text-text">{value}</dd></div>)}
      </dl>

      <section className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="trial-configuration-heading">
        <h2 id="trial-configuration-heading" className="text-xl font-bold text-text">Global trial configuration</h2>
        <p className="mt-1 text-sm leading-6 text-muted">Defaults govern future grants. Each granted trial keeps its own plan, fallback, limits, and dates.</p>
        {data.configuration ? data.canManage ? (
          <TrialConfigurationForm configuration={data.configuration} plans={data.plans} />
        ) : (
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-muted">Status</dt><dd className="font-semibold text-text">{data.configuration.enabled ? "Enabled" : "Disabled"}</dd></div>
            <div><dt className="text-muted">Trial plan</dt><dd className="font-semibold text-text">{data.configuration.trialPlan.name}</dd></div>
            <div><dt className="text-muted">Duration</dt><dd className="font-semibold text-text">{data.configuration.durationDays} days</dd></div>
            <div><dt className="text-muted">Fallback</dt><dd className="font-semibold text-text">{data.configuration.fallbackPlan.name}</dd></div>
          </dl>
        ) : <p className="mt-4 text-sm text-danger">Trial configuration has not been seeded.</p>}
      </section>

      {data.canManage && data.configuration?.allowManualGrant ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="manual-trial-heading">
          <h2 id="manual-trial-heading" className="text-xl font-bold text-text">Grant configured trial</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Eligibility is rechecked server-side. The workspace ID, plan, duration, and limits are never trusted from the browser.</p>
          <TrialGrantForm workspaces={data.candidates} />
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="trial-history-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="trial-history-heading" className="text-xl font-bold text-text">Trial history</h2><p className="mt-1 text-sm text-muted">Latest 50 immutable trial records.</p></div>
          <p className="text-xs text-muted">Converted: {data.analytics.converted} · {data.analytics.byPlan.map((item) => `${item.code} ${item.count}`).join(" · ") || "No plan data"}</p>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Workspace</th><th className="px-4 py-3">Trial / fallback</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Source</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-border">
              {data.trials.map((trial) => <tr key={trial.id}>
                <td className="px-4 py-3 font-semibold text-text">{trial.workspace.name}</td>
                <td className="px-4 py-3 text-text">{trial.trialPlanNameSnapshot}<span className="block text-xs text-muted">Fallback: {trial.fallbackPlanCodeSnapshot}</span></td>
                <td className="px-4 py-3 text-muted"><LocalDateTime value={trial.startsAt.toISOString()} dateOnly /> – <LocalDateTime value={trial.endsAt.toISOString()} dateOnly /></td>
                <td className="px-4 py-3"><span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-text">{trial.status}</span></td>
                <td className="px-4 py-3 text-muted">{trial.grantSource === "AUTO_NEW_WORKSPACE" ? "Automatic" : "Platform manual"}{trial.grantedBy ? <span className="block text-xs">by {trial.grantedBy.name ?? trial.grantedBy.email}</span> : null}</td>
                <td className="px-4 py-3">{data.canManage && trial.status === "ACTIVE" ? <TrialCancelButton trialId={trial.id} /> : null}</td>
              </tr>)}
              {!data.trials.length ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No workspace trials have started yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
