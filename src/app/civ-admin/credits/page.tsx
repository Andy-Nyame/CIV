import type { Metadata } from "next";

import {
  PlatformCreditPackCreateForm,
  PlatformCreditPackEditor,
} from "@/components/ui/platform-credit-pack-editor";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { getPlatformCreditPackManagementData } from "@/features/commercial/queries";

export const metadata: Metadata = { title: "Document Credit Packs" };

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export default async function PlatformCreditPacksPage() {
  const data = await getPlatformCreditPackManagementData();

  return (
    <div>
      <PlatformPageHeading
        title="Document Credit Packs"
        description="Manage carry-forward credit packs and review real acquisition totals."
      />
      <p className="mt-6 rounded-xl border border-civ-blue bg-active p-4 text-sm leading-6 text-text">Payment metrics on this page are Paystack Test Mode operational data, not real revenue.</p>
      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Outstanding purchased credits</p>
          <p className="mt-1 text-3xl font-bold text-text">
            {data.outstandingPurchasedCredits.toLocaleString("en-GH")}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            Derived from the append-only ledger across beta and verified Test Mode acquisitions.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Configured packs</p>
          <p className="mt-1 text-3xl font-bold text-text">{data.packs.length}</p>
          <p className="mt-2 text-xs leading-5 text-muted">
            Historical purchase snapshots remain unchanged when a pack is edited.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Completed paid test purchases</p>
          <p className="mt-1 text-3xl font-bold text-text">{data.paidTestPurchases.toLocaleString("en-GH")}</p>
          <p className="mt-2 text-xs leading-5 text-muted">Successful purchase records only; not revenue.</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Paid test credits granted</p>
          <p className="mt-1 text-3xl font-bold text-text">{data.paidTestCreditsGranted.toLocaleString("en-GH")}</p>
          <p className="mt-2 text-xs leading-5 text-muted">Credit quantity from completed paid purchase snapshots.</p>
        </div>
      </section>

      {data.paidPurchaseStatuses.length ? <section className="mt-4 flex flex-wrap gap-2" aria-label="Paid test purchase statuses">{data.paidPurchaseStatuses.map((entry) => <span key={entry.status} className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-muted">{label(entry.status)}: {entry.count.toLocaleString("en-GH")}</span>)}</section> : null}

      {data.canManage ? (
        <details className="mt-6 rounded-xl border border-border bg-surface p-5">
          <summary className="cursor-pointer font-bold text-text">Create credit pack</summary>
          <div className="mt-5 max-w-2xl">
            <PlatformCreditPackCreateForm />
          </div>
        </details>
      ) : (
        <p className="mt-5 text-sm text-muted">Your platform role has read-only credit-pack access.</p>
      )}

      <section className="mt-6 grid gap-5 lg:grid-cols-2" aria-label="Credit-pack configuration">
        {data.packs.map((pack) =>
          data.canManage ? (
            <PlatformCreditPackEditor key={pack.id} pack={pack} />
          ) : (
            <article key={pack.id} className="rounded-xl border border-border bg-surface p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-link">{pack.code}</p>
              <h2 className="mt-1 text-xl font-bold text-text">{pack.name}</h2>
              <dl className="mt-5 grid gap-2 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted">Credits</dt><dd className="font-semibold text-text">{pack.creditAmount.toLocaleString("en-GH")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">Price</dt><dd className="font-semibold text-text">{pack.currency === "GHS" ? "GH₵" : pack.currency} {Number(pack.price).toLocaleString("en-GH")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">Acquisitions</dt><dd className="font-semibold text-text">{pack.purchases.toLocaleString("en-GH")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">Completed</dt><dd className="font-semibold text-text">{pack.completedPurchases.toLocaleString("en-GH")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">State</dt><dd className="font-semibold text-text">{pack.isActive ? "Active" : "Inactive"} · {pack.isPublic ? "Public" : "Hidden"}</dd></div>
              </dl>
            </article>
          ),
        )}
      </section>
    </div>
  );
}
