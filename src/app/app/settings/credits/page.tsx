import type { Metadata } from "next";

import { DocumentCreditPackCard } from "@/components/ui/document-credit-pack-card";
import { DocumentCreditPurchaseRetry } from "@/components/ui/document-credit-purchase-retry";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { PageHeading } from "@/components/ui/page-heading";
import { getDocumentCreditsPageData } from "@/features/commercial/queries";

export const metadata: Metadata = { title: "Document Credits" };

function amount(value: number | null) {
  return value === null ? "Unlimited / custom" : value.toLocaleString("en-GH");
}

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export default async function DocumentCreditsPage() {
  const data = await getDocumentCreditsPageData();

  return (
    <div>
      <PageHeading
        title="Document Credits"
        description={`Review monthly and carry-forward document capacity for ${data.workspace.name}.`}
      />
      <p className="mt-7 rounded-xl border border-civ-blue bg-active px-4 py-3 text-sm leading-6 text-text">
        Monthly plan allowance renews each period and does not carry forward. Purchased credits carry forward and are used only after the monthly allowance.
      </p>
      <p className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
        Paystack Test Mode is active. Priced packs open Paystack-hosted checkout, where available methods may include Card and Mobile Money. Credits are added only after CIV verifies a successful payment.
      </p>

      <section className="mt-7 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="capacity-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-link">Effective allowance</p>
            <h2 id="capacity-heading" className="mt-1 text-2xl font-bold text-text">{data.effectivePlan.name}</h2>
            <p className="mt-1 text-sm text-muted">{data.activeTrial ? `${data.activeTrial.trialPlanNameSnapshot} trial · normal plan ${data.currentPlan.name}` : `${data.subscriptionStatus} subscription`}</p>
          </div>
          <p className="text-sm text-muted">
            Period <LocalDateTime value={data.period.periodStart.toISOString()} dateOnly /> – <LocalDateTime value={data.period.periodEnd.toISOString()} dateOnly />
          </p>
        </div>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-page p-4"><dt className="text-sm text-muted">Monthly allowance</dt><dd className="mt-1 text-xl font-bold text-text">{amount(data.period.allowance)}</dd></div>
          <div className="rounded-lg bg-page p-4"><dt className="text-sm text-muted">Monthly used</dt><dd className="mt-1 text-xl font-bold text-text">{data.period.used.toLocaleString("en-GH")}</dd></div>
          <div className="rounded-lg bg-page p-4"><dt className="text-sm text-muted">Purchased balance</dt><dd className="mt-1 text-xl font-bold text-text">{data.purchasedBalance.toLocaleString("en-GH")}</dd></div>
          <div className="rounded-lg bg-page p-4"><dt className="text-sm text-muted">Total available</dt><dd className="mt-1 text-xl font-bold text-text">{amount(data.totalCapacity)}</dd></div>
        </dl>
      </section>

      <section className="mt-9" aria-labelledby="packs-heading">
        <h2 id="packs-heading" className="text-xl font-bold text-text">Available credit packs</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          GH₵0 beta packs require no checkout. Priced Test Mode packs require server-confirmed Paystack payment; the quantity and price always come from CIV’s pack configuration.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.packs.map((pack) => (
            <DocumentCreditPackCard key={pack.code} pack={pack} canAcquire={data.canAcquire} />
          ))}
        </div>
      </section>

      <section className="mt-9 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="purchase-history-heading">
        <div className="border-b border-border px-5 py-4">
          <h2 id="purchase-history-heading" className="font-bold text-text">Recent credit purchases</h2>
          <p className="mt-1 text-sm text-muted">Purchase snapshots remain fixed if a pack is edited later.</p>
        </div>
        {data.purchases.length ? <div className="overflow-x-auto"><table className="w-full min-w-[58rem] text-left text-sm"><thead className="bg-surface-muted text-muted"><tr><th className="px-4 py-3 font-semibold">Pack</th><th className="px-4 py-3 font-semibold">Credits</th><th className="px-4 py-3 font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Purchase</th><th className="px-4 py-3 font-semibold">Payment</th><th className="px-4 py-3 font-semibold">Created</th><th className="px-4 py-3 font-semibold">Action</th></tr></thead><tbody className="divide-y divide-border">{data.purchases.map((purchase) => <tr key={purchase.id}><td className="px-4 py-4 text-text"><p className="font-semibold">{purchase.pack.name}</p><p className="mt-0.5 text-xs text-muted">{purchase.pack.code}</p></td><td className="px-4 py-4 text-text">{purchase.creditAmountSnapshot.toLocaleString("en-GH")}</td><td className="px-4 py-4 text-text">{purchase.currencySnapshot === "GHS" ? "GH₵" : `${purchase.currencySnapshot} `}{purchase.priceSnapshot}</td><td className="px-4 py-4 text-text">{label(purchase.status)}</td><td className="px-4 py-4 text-text">{purchase.betaAcquisition ? "No payment · Beta" : purchase.latestPayment ? label(purchase.latestPayment.status) : "Not initialized"}</td><td className="px-4 py-4 text-muted"><LocalDateTime value={purchase.createdAt.toISOString()} /></td><td className="px-4 py-4">{data.canAcquire && !purchase.betaAcquisition && ["PENDING", "FAILED", "CANCELLED"].includes(purchase.status) ? <DocumentCreditPurchaseRetry purchaseId={purchase.id} /> : <span className="text-xs text-muted">—</span>}</td></tr>)}</tbody></table></div> : <p className="px-5 py-10 text-center text-muted">No credit purchases yet.</p>}
      </section>
    </div>
  );
}
