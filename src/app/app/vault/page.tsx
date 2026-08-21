import type { Metadata } from "next";
import Link from "next/link";

import { PageHeading } from "@/components/ui/page-heading";
import { getVaultIssuedRecords } from "@/features/documents/queries";

export const metadata: Metadata = { title: "Vault" };

export default async function VaultPage() {
  const { context, records } = await getVaultIssuedRecords();
  return <div><PageHeading title="CIV Vault" description={`Immutable issued records for ${context.workspace.name}. Files and PDFs will be added in a later phase.`}/>{records.length?<div className="mt-8 divide-y divide-border border-y border-border">{records.map(record=><article key={record.id} className="flex flex-wrap items-center justify-between gap-4 py-5"><div><Link className="font-bold text-link" href={`/app/documents/${record.id}`}>{record.documentNumber}</Link><p className="mt-1 text-sm text-muted">{record.type.replaceAll("_", " ")} · {record.customer?.name ?? "Walk-in customer"}</p></div><div className="text-right"><p className="font-semibold text-text">{record.currency} {record.grandTotal.toFixed(2)}</p><p className="mt-1 text-sm text-muted">{record.issuedAt?.toLocaleDateString("en-GH")}</p></div></article>)}</div>:<div className="mt-8 border border-dashed border-border p-12 text-center"><h2 className="font-bold text-text">Your Vault is empty</h2><p className="mt-2 text-sm text-muted">Issued documents will appear here as retained workspace records.</p></div>}</div>;
}
