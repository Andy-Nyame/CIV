import type { Metadata } from "next";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { getPlatformPaymentsPageData } from "@/features/payments/queries";

export const metadata: Metadata = { title: "Payments" };

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export default async function PlatformPaymentsPage() {
  const data = await getPlatformPaymentsPageData();
  return (
    <div>
      <PlatformPageHeading title="Payments" description="Read-only operational visibility into CIV-owned payment records and provider attempts." />
      <p className="mt-6 rounded-xl border border-civ-blue bg-active p-4 text-sm leading-6 text-text">Paystack {label(data.mode)} Mode · No entitlement fulfillment, refunds, recurring subscriptions, or live payment controls are enabled.</p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.statusCounts.map((entry) => <div key={entry.status} className="rounded-xl border border-border bg-surface p-4"><dt className="text-sm text-muted">{label(entry.status)}</dt><dd className="mt-1 text-2xl font-bold text-text">{entry.count.toLocaleString("en-GH")}</dd></div>)}
      </dl>

      <section className="mt-7 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="platform-payments-title">
        <div className="border-b border-border px-5 py-4"><h2 id="platform-payments-title" className="font-bold text-text">Recent payments</h2><p className="mt-1 text-sm text-muted">Latest 100 records. Secret keys, provider payloads, access codes, and payment method data are excluded.</p></div>
        {data.payments.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[68rem] text-left text-sm"><thead className="bg-surface-muted text-muted"><tr><th className="px-4 py-3 font-semibold">Reference</th><th className="px-4 py-3 font-semibold">Workspace</th><th className="px-4 py-3 font-semibold">Initiated by</th><th className="px-4 py-3 font-semibold">Purpose</th><th className="px-4 py-3 font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Attempts</th><th className="px-4 py-3 font-semibold">Created</th></tr></thead><tbody className="divide-y divide-border">{data.payments.map((payment) => <tr key={payment.id}><td className="px-4 py-4 font-mono text-xs text-text">{payment.internalReference}</td><td className="px-4 py-4 text-text">{payment.workspace.name}</td><td className="px-4 py-4"><p className="text-text">{payment.initiatedBy.name || "CIV user"}</p><p className="mt-0.5 text-xs text-muted">{payment.initiatedBy.email}</p></td><td className="px-4 py-4 text-text">{label(payment.purpose)}</td><td className="px-4 py-4 text-text">{payment.currency === "GHS" ? "GH₵" : `${payment.currency} `}{payment.amount}</td><td className="px-4 py-4 text-text">{label(payment.status)}</td><td className="px-4 py-4 text-text">{payment.attempts}</td><td className="px-4 py-4 text-muted"><LocalDateTime value={payment.createdAt.toISOString()} /></td></tr>)}</tbody></table></div>
        ) : <p className="px-5 py-12 text-center text-muted">No CIV payment records.</p>}
      </section>
    </div>
  );
}
