import type { Metadata } from "next";
import Link from "next/link";

import { LocalDateTime } from "@/components/ui/local-date-time";
import { PageHeading } from "@/components/ui/page-heading";
import { RecurringCancellationControl } from "@/components/ui/recurring-subscription-controls";
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
        description={`Review subscription and payment history for ${data.workspace.name}.`}
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
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Recurring subscriptions use card-only checkout. Document Credit purchases retain their separate one-time channel policy. Live money remains disabled.</p>
          </div>
          <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-link">{data.paymentMode}</span>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-surface p-4"><dt className="text-sm text-muted">Normal plan</dt><dd className="mt-1 font-bold text-text">{data.normalPlan.name}</dd></div>
          <div className="rounded-lg bg-surface p-4"><dt className="text-sm text-muted">Effective plan</dt><dd className="mt-1 font-bold text-text">{data.effectivePlan.name}</dd></div>
          <div className="rounded-lg bg-surface p-4"><dt className="text-sm text-muted">Billing status</dt><dd className="mt-1 font-bold text-text">{label(data.subscriptionStatus)}</dd></div>
          <div className="rounded-lg bg-surface p-4"><dt className="text-sm text-muted">Trial</dt><dd className="mt-1 font-bold text-text">{data.activeTrial ? `${data.activeTrial.trialPlanNameSnapshot} until ${data.activeTrial.endsAt.toLocaleDateString("en-GH")}` : "No active trial"}</dd></div>
        </dl>
        {data.recurringBilling.currentPeriodStart && data.recurringBilling.currentPeriodEnd ? (
          <p className="mt-4 text-sm leading-6 text-muted">
            Current billing period: <LocalDateTime value={data.recurringBilling.currentPeriodStart.toISOString()} /> to <LocalDateTime value={data.recurringBilling.currentPeriodEnd.toISOString()} />. {data.recurringBilling.cancelAtPeriodEnd ? "Renewal is cancelled." : data.recurringBilling.nextPaymentAt ? <>Next renewal: <LocalDateTime value={data.recurringBilling.nextPaymentAt.toISOString()} />.</> : "The next provider renewal date is not yet available."}
          </p>
        ) : null}
      </section>

      {data.recurringBilling.connected && data.recurringBilling.currentPeriodEnd && data.canManageSubscription && !data.recurringBilling.cancelAtPeriodEnd ? (
        <div className="mt-7">
          <RecurringCancellationControl planName={data.normalPlan.name} periodEnd={data.recurringBilling.currentPeriodEnd.toISOString()} />
        </div>
      ) : null}

      <section className="mt-8 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="payment-history-title">
        <div className="border-b border-border px-5 py-4">
          <h2 id="payment-history-title" className="font-bold text-text">Recent CIV payments</h2>
          <p className="mt-1 text-sm text-muted">Operational status only; provider secrets and checkout access details are never displayed.</p>
        </div>
        {data.payments.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="bg-surface-muted text-muted"><tr><th className="px-5 py-3 font-semibold">Reference</th><th className="px-5 py-3 font-semibold">Purpose</th><th className="px-5 py-3 font-semibold">Amount</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Fulfillment</th><th className="px-5 py-3 font-semibold">Created</th></tr></thead>
              <tbody className="divide-y divide-border">
                {data.payments.map((payment) => (
                  <tr key={payment.id}><td className="px-5 py-4 font-mono text-xs text-text">{payment.internalReference}</td><td className="px-5 py-4 text-text">{label(payment.purpose)}</td><td className="px-5 py-4 text-text">{money(payment.amount, payment.currency)}</td><td className="px-5 py-4"><span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold text-muted">{label(payment.status)}</span></td><td className="px-5 py-4 text-text">{payment.documentCreditPurchase ? `${label(payment.documentCreditPurchase.status)} · ${payment.documentCreditPurchase.creditAmountSnapshot.toLocaleString("en-GH")} credits` : payment.subscriptionChange ? `${label(payment.subscriptionChange.status)} · ${payment.subscriptionChange.targetPlanNameSnapshot}` : payment.subscriptionBillingPeriod ? `${label(payment.subscriptionBillingPeriod.status)} renewal` : "Infrastructure only"}</td><td className="px-5 py-4 text-muted"><LocalDateTime value={payment.createdAt.toISOString()} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 py-12 text-center text-muted">No payment records for this workspace.</p>}
      </section>

      {data.billingPeriods.length ? (
        <section className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="billing-periods-title">
          <h2 id="billing-periods-title" className="font-bold text-text">Subscription periods</h2>
          <div className="mt-4 grid gap-3">
            {data.billingPeriods.map((period) => (
              <div key={period.id} className="flex flex-wrap justify-between gap-3 border-t border-border pt-3 text-sm first:border-0 first:pt-0">
                <span className="font-semibold text-text">{period.plan.name} · {label(period.status)}</span>
                <span className="text-muted"><LocalDateTime value={period.periodStart.toISOString()} /> – <LocalDateTime value={period.periodEnd.toISOString()} /> · {money(period.amount, period.currency)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
