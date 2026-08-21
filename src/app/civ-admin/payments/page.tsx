import type { Metadata } from "next";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PaymentOperationsControl } from "@/components/ui/payment-operations-control";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { getPlatformPaymentsPageData } from "@/features/payments/queries";

export const metadata: Metadata = { title: "Payments" };

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function money(amount: string, currency: string) {
  return currency === "GHS" ? `GH₵${amount}` : `${currency} ${amount}`;
}

export default async function PlatformPaymentsPage() {
  const data = await getPlatformPaymentsPageData();
  return (
    <div>
      <PlatformPageHeading title="Payments" description="Investigate CIV-owned payments, provider state, refunds, and reconciliation without exposing payment credentials." />
      <p className="mt-6 rounded-xl border border-civ-blue bg-active p-4 text-sm leading-6 text-text">
        Paystack {label(data.mode)} Mode · Refund submission and reconciliation are server-authoritative. A refund does not cancel recurring renewal, and Test totals are not production revenue.
      </p>
      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.statusCounts.map((entry) => <div key={entry.status} className="rounded-xl border border-border bg-surface p-4"><dt className="text-sm text-muted">{label(entry.status)}</dt><dd className="mt-1 text-2xl font-bold text-text">{entry.count.toLocaleString("en-GH")}</dd></div>)}
      </dl>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.subscriptionStatusCounts.map((entry) => <div key={entry.status} className="rounded-xl border border-border bg-surface p-4"><dt className="text-sm text-muted">Subscriptions · {label(entry.status)}</dt><dd className="mt-1 text-2xl font-bold text-text">{entry.count.toLocaleString("en-GH")}</dd></div>)}
        <div className="rounded-xl border border-border bg-surface p-4"><dt className="text-sm text-muted">Trial conversions</dt><dd className="mt-1 text-2xl font-bold text-text">{data.trialConversions.toLocaleString("en-GH")}</dd></div>
      </dl>
      <section className="mt-7 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="platform-payments-title">
        <div className="border-b border-border px-5 py-4"><h2 id="platform-payments-title" className="font-bold text-text">Recent payments</h2><p className="mt-1 text-sm text-muted">Latest 100 records. Card details, provider payloads, checkout codes, and secrets are excluded.</p></div>
        {data.payments.length ? (
          <div className="divide-y divide-border">
            {data.payments.map((payment) => {
              const activeRefund = payment.refunds.find((refund) => refund.active) ?? null;
              return (
                <article key={payment.id} className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="break-all font-mono text-xs text-text">{payment.internalReference}</p><p className="mt-1 text-sm text-muted">{payment.workspace.name} · {label(payment.purpose)} · <LocalDateTime value={payment.createdAt.toISOString()} /></p></div><span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold text-muted">{label(payment.status)}</span></div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                      <div><dt className="text-muted">Original</dt><dd className="font-semibold text-text">{money(payment.amount, payment.currency)}</dd></div>
                      <div><dt className="text-muted">Refunded</dt><dd className="font-semibold text-text">{money(payment.refundedAmount, payment.currency)}</dd></div>
                      <div><dt className="text-muted">Refundable</dt><dd className="font-semibold text-text">{money(payment.remainingRefundableAmount, payment.currency)}</dd></div>
                      <div><dt className="text-muted">Reconciliation</dt><dd className="font-semibold text-text">{label(payment.reconciliationStatus)}</dd></div>
                      <div><dt className="text-muted">Provider attempt</dt><dd className="font-semibold text-text">{payment.latestProviderState ? label(payment.latestProviderState) : "Unavailable"}</dd></div>
                    </dl>
                    {payment.reconciliationNote ? <p className="mt-2 text-xs font-semibold text-danger">Review reason: {label(payment.reconciliationNote)}</p> : null}
                    <p className="mt-3 text-sm text-muted">{payment.documentCreditPurchase ? `${label(payment.documentCreditPurchase.status)} · ${payment.documentCreditPurchase.pack.code}` : payment.subscriptionChange ? `${label(payment.subscriptionChange.status)} · ${payment.subscriptionChange.targetPlanCodeSnapshot}` : payment.subscriptionBillingPeriod ? `${label(payment.subscriptionBillingPeriod.status)} renewal` : "Payment infrastructure"}</p>
                    {payment.refunds.length ? <div className="mt-4 border-l-2 border-border pl-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">Refund history</p>{payment.refunds.map((refund) => <div key={refund.id} className="mt-2 text-sm text-text"><p>{refund.internalReference} · {money(refund.amount, refund.currency)} · {label(refund.status)}{refund.creditAmount ? ` · ${refund.creditAmount.toLocaleString("en-GH")} credits` : ""}{refund.safeFailureCode ? <span className="text-danger"> · {label(refund.safeFailureCode)}</span> : null} · <LocalDateTime value={refund.createdAt.toISOString()} /></p><p className="mt-1 text-xs text-muted">Reason: {refund.reason}</p></div>)}</div> : null}
                  </div>
                  <PaymentOperationsControl paymentId={payment.id} paymentReference={payment.internalReference} amount={payment.amount} currency={payment.currency} remainingRefundableAmount={payment.remainingRefundableAmount} purpose={payment.purpose} activeRefundId={activeRefund?.id ?? null} canRefund={data.canRefund} canReconcile={data.canReconcile} />
                </article>
              );
            })}
          </div>
        ) : <p className="px-5 py-12 text-center text-muted">No CIV payment records.</p>}
      </section>
    </div>
  );
}
