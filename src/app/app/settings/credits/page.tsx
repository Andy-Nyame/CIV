import type { Metadata } from "next";

import { DocumentCreditPackCard } from "@/components/ui/document-credit-pack-card";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { PageHeading } from "@/components/ui/page-heading";
import { getDocumentCreditsPageData } from "@/features/commercial/queries";

export const metadata: Metadata = { title: "Document Credits" };

function amount(value: number | null) {
  return value === null ? "Unlimited / custom" : value.toLocaleString("en-GH");
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

      <section className="mt-7 rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="capacity-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-link">Current plan</p>
            <h2 id="capacity-heading" className="mt-1 text-2xl font-bold text-text">{data.currentPlan.name}</h2>
            <p className="mt-1 text-sm text-muted">{data.subscriptionStatus} subscription</p>
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
        <h2 id="packs-heading" className="text-xl font-bold text-text">Available beta credit packs</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Beta packs are GH₵0. Each workspace may acquire each pack once during beta; future paid purchases will require server-confirmed payment.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.packs.map((pack) => (
            <DocumentCreditPackCard key={pack.code} pack={pack} canAcquire={data.canAcquire} />
          ))}
        </div>
      </section>
    </div>
  );
}
