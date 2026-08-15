import type { Metadata } from "next";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { operationalActionLabel, platformRoleLabel } from "@/features/platform-admin/presentation";
import { getPlatformActivitySummary } from "@/features/platform-admin/queries";

export const metadata: Metadata = { title: "Activity" };

export default async function PlatformActivityPage() {
  await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_PLATFORM_ACTIVITY);
  const activity = await getPlatformActivitySummary();
  return (
    <div>
      <PlatformPageHeading title="Platform Activity" description="High-level workspace operational events without customer audit metadata, actor identity, or resource contents." />
      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-text">Recent operational events</h2><p className="mt-1 text-sm text-muted">Latest 25 events, privacy-filtered.</p></div>
          {activity.recentEvents.length ? (
            <ol className="divide-y divide-border">
              {activity.recentEvents.map((event) => (
                <li key={event.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-semibold text-text">{operationalActionLabel(event.action)}</p><p className="mt-1 text-sm text-muted">{platformRoleLabel(event.workspace.type)} workspace</p></div>
                  <p className="text-sm text-muted"><LocalDateTime value={event.createdAt.toISOString()} /></p>
                </li>
              ))}
            </ol>
          ) : <p className="px-5 py-12 text-center text-muted">No workspace activity recorded.</p>}
        </section>
        <aside className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold text-text">Event totals</h2>
          <ul className="mt-4 grid gap-3">
            {activity.actionCounts.slice(0, 12).map((entry) => (
              <li key={entry.action} className="flex justify-between gap-3 text-sm"><span className="text-muted">{operationalActionLabel(entry.action)}</span><span className="font-semibold text-text">{entry.count.toLocaleString()}</span></li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
