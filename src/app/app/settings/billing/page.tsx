import type { Metadata } from "next";
import Link from "next/link";

import { BillingTestControl } from "@/components/ui/billing-test-control";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { PageHeading } from "@/components/ui/page-heading";
import { getWorkspaceBillingPageData } from "@/features/payments/queries";

export const metadata: Metadata = { title: "Billing" };

function money(amount: string, currency: string) {
  return currency === "GHS" ? `GH₵${amount}` : `${currency} ${amount}`;
}

function label(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function BillingPage() {
  const data = await getWorkspaceBillingPageData();
  return (
    <div>
      <PageHeading
        title="Billing"
        description={`Review the test-mode payment foundation for ${data.workspace.name}.`}
        action={
          <Link href="/app/settings/plan" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover">
            Plan & Storage
          </Link>
        }
      />

      <section className="mt-7 rounded-xl border border-civ-blue bg-active p-5 sm:p-6" aria-labelledby="billing-mode-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-link">Payment system</p>
            <h2 id="billing-mode-title" className="mt-1 text-xl font-bold text-text">Paystack Test Mode</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">D.1 records and verifies test payments only. It cannot grant document credits, change plans, or process live money.</p>
          </div>
          <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-link">{data.paymentMode}</span>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-surface p-4"><dt className="text-sm text-muted">Normal plan</dt><dd className="mt-1 font-bold text-text">{data.normalPlan.name}</dd></div>
          <div className="rounded-lg bg-surface p-4"><dt className="text-sm text-muted">Trial</dt><dd className="mt-1 font-bold text-text">{data.activeTrial ? `${data.activeTrial.trialPlanNameSnapshot} until ${data.activeTrial.endsAt.toLocaleDateString("en-GH")}` : "No active trial"}</dd></div>
        </dl>
      </section>

      {data.canInitializeTest ? (
        <div className="mt-7"><BillingTestControl /></div>
      ) : (
        <p className="mt-7 rounded-xl border border-border bg-surface p-5 text-sm text-muted">You can review billing history. Only the Workspace Owner can initialize the development test checkout.</p>
      )}

      <section className="mt-8 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="payment-history-title">
        <div className="border-b border-border px-5 py-4">
          <h2 id="payment-history-title" className="font-bold text-text">Recent CIV payments</h2>
          <p className="mt-1 text-sm text-muted">Operational status only; provider secrets and checkout access details are never displayed.</p>
        </div>
        {data.payments.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="bg-surface-muted text-muted"><tr><th className="px-5 py-3 font-semibold">Reference</th><th className="px-5 py-3 font-semibold">Purpose</th><th className="px-5 py-3 font-semibold">Amount</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Created</th></tr></thead>
              <tbody className="divide-y divide-border">
                {data.payments.map((payment) => (
                  <tr key={payment.id}><td className="px-5 py-4 font-mono text-xs text-text">{payment.internalReference}</td><td className="px-5 py-4 text-text">{label(payment.purpose)}</td><td className="px-5 py-4 text-text">{money(payment.amount, payment.currency)}</td><td className="px-5 py-4"><span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold text-muted">{label(payment.status)}</span></td><td className="px-5 py-4 text-muted"><LocalDateTime value={payment.createdAt.toISOString()} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 py-12 text-center text-muted">No payment records for this workspace.</p>}
      </section>
    </div>
  );
}
