import type { Metadata } from "next";

import {
  PlatformCreditPackCreateForm,
  PlatformCreditPackEditor,
} from "@/components/ui/platform-credit-pack-editor";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { getPlatformCreditPackManagementData } from "@/features/commercial/queries";

export const metadata: Metadata = { title: "Document Credit Packs" };

export default async function PlatformCreditPacksPage() {
  const data = await getPlatformCreditPackManagementData();

  return (
    <div>
      <PlatformPageHeading
        title="Document Credit Packs"
        description="Manage carry-forward credit packs and review real acquisition totals."
      />
      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Outstanding purchased credits</p>
          <p className="mt-1 text-3xl font-bold text-text">
            {data.outstandingPurchasedCredits.toLocaleString("en-GH")}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            Derived from the append-only ledger. Beta revenue is not reported because no payment processing exists.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Configured packs</p>
          <p className="mt-1 text-3xl font-bold text-text">{data.packs.length}</p>
          <p className="mt-2 text-xs leading-5 text-muted">
            Historical purchase snapshots remain unchanged when a pack is edited.
          </p>
        </div>
      </section>

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
                <div className="flex justify-between gap-4"><dt className="text-muted">Beta price</dt><dd className="font-semibold text-text">{pack.currency === "GHS" ? "GH₵" : pack.currency} {Number(pack.price).toLocaleString("en-GH")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">Acquisitions</dt><dd className="font-semibold text-text">{pack.purchases.toLocaleString("en-GH")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">State</dt><dd className="font-semibold text-text">{pack.isActive ? "Active" : "Inactive"} · {pack.isPublic ? "Public" : "Hidden"}</dd></div>
              </dl>
            </article>
          ),
        )}
      </section>
    </div>
  );
}
