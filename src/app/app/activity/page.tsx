import type { Metadata } from "next";
import Link from "next/link";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PageHeading } from "@/components/ui/page-heading";
import { presentAuditEvent } from "@/features/audit/presentation";
import { getActivityPageData } from "@/features/audit/queries";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const { cursor } = await searchParams;
  const { events, hasMore, hasPreviousPage, nextCursor } =
    await getActivityPageData(cursor);

  return (
    <div>
      <PageHeading
        title="Activity"
        description="See important actions that have taken place in this workspace."
      />

      <section
        className="mt-8 overflow-hidden rounded-xl border border-border bg-surface"
        aria-labelledby="activity-feed-title"
      >
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h2 id="activity-feed-title" className="text-base font-semibold text-text">
            Workspace activity
          </h2>
          <p className="mt-1 text-sm text-muted">Newest actions appear first.</p>
        </div>

        {events.length ? (
          <ol className="divide-y divide-border">
            {events.map((event) => {
              const presentation = presentAuditEvent(event);

              return (
                <li key={event.id} className="px-5 py-4 sm:px-6 sm:py-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <p className="text-sm leading-6 text-text">
                        {presentation.summary}
                      </p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                        {presentation.label}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm text-muted">
                      <LocalDateTime value={event.createdAt.toISOString()} />
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="px-5 py-12 text-center sm:px-6">
            <p className="font-semibold text-text">No activity yet</p>
            <p className="mt-2 text-sm text-muted">
              Important workspace actions will appear here.
            </p>
          </div>
        )}
      </section>

      {hasPreviousPage || hasMore ? (
        <nav className="mt-5 flex flex-wrap items-center justify-between gap-3" aria-label="Activity pagination">
          {hasPreviousPage ? (
            <Link className="min-h-11 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text hover:bg-hover" href="/app/activity">
              Newest activity
            </Link>
          ) : (
            <span />
          )}
          {hasMore && nextCursor ? (
            <Link className="min-h-11 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text hover:bg-hover" href={`/app/activity?cursor=${nextCursor}`}>
              Older activity
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
