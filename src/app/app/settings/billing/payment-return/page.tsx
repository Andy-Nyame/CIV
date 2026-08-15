import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeading } from "@/components/ui/page-heading";
import { PaymentVerificationControl } from "@/components/ui/payment-verification-control";
import { getWorkspacePaymentReturnData } from "@/features/payments/queries";

export const metadata: Metadata = { title: "Payment Return" };

export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const reference = typeof query.reference === "string" ? query.reference : null;
  if (!reference) notFound();
  let payment;
  try {
    payment = await getWorkspacePaymentReturnData(reference);
  } catch {
    notFound();
  }
  if (!payment) notFound();

  return (
    <div>
      <PageHeading title="Payment Return" description="Paystack has returned your browser to CIV. This return alone does not prove payment success." />
      <section className="mt-7 max-w-2xl rounded-xl border border-border bg-surface p-5 sm:p-6">
        <p className="text-sm font-semibold text-link">CIV payment status</p>
        <h2 className="mt-1 text-2xl font-bold text-text">{payment.status}</h2>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Reference</dt><dd className="mt-1 break-all font-mono text-xs font-semibold text-text">{payment.internalReference}</dd></div>
          <div><dt className="text-muted">Amount</dt><dd className="mt-1 font-semibold text-text">{payment.currency === "GHS" ? "GH₵" : `${payment.currency} `}{payment.amount}</dd></div>
        </dl>
        <p className="mt-5 text-sm leading-6 text-muted">Use server-side verification to refresh the status from Paystack. D.1 never grants an entitlement, even after a successful test payment.</p>
        <PaymentVerificationControl reference={payment.internalReference} />
        <Link href="/app/settings/billing" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-link hover:underline">Return to Billing</Link>
      </section>
    </div>
  );
}
