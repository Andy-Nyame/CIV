"use client";

import { useActionState, useState } from "react";
import { issueDocumentAction, type IssueDocumentState } from "@/features/documents/actions";

export function IssueDocumentPanel({ documentId, documentType, customerName, currency, grandTotal, readiness, capacity }: {
  documentId: string;
  documentType: string;
  customerName: string | null;
  currency: string;
  grandTotal: string;
  readiness: string[];
  capacity: { canConsume: boolean; monthlyRemaining: number | null; purchasedBalance: number; totalAvailable: number | null };
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(issueDocumentAction.bind(null, documentId), {} as IssueDocumentState);
  const uses = capacity.monthlyRemaining === null ? "your unlimited monthly allowance" : capacity.monthlyRemaining > 0 ? "1 monthly document" : "1 purchased credit";
  return <section className="mt-8 border-l-4 border-civ-blue bg-soft-blue p-5 dark:bg-surface-muted" aria-labelledby="issue-title">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="issue-title" className="text-lg font-bold text-text">Issue Document</h2><p className="mt-1 max-w-2xl text-sm text-muted">CIV will recalculate and validate this draft again before assigning its official document number.</p></div>{!confirming?<button type="button" disabled={readiness.length > 0 || !capacity.canConsume} onClick={()=>setConfirming(true)} className="min-h-11 rounded-lg bg-civ-blue px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Issue Document</button>:null}</div>
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-muted">Monthly remaining</dt><dd className="font-semibold text-text">{capacity.monthlyRemaining === null ? "Unlimited" : capacity.monthlyRemaining.toLocaleString("en-GH")}</dd></div><div><dt className="text-muted">Purchased credits</dt><dd className="font-semibold text-text">{capacity.purchasedBalance.toLocaleString("en-GH")}</dd></div><div><dt className="text-muted">This issuance uses</dt><dd className="font-semibold text-text">{uses}</dd></div></dl>
    {readiness.length || !capacity.canConsume?<div className="mt-4" role="status"><p className="font-semibold text-danger">Resolve these items before issuing:</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">{readiness.map(item=><li key={item}>{item}</li>)}{!capacity.canConsume?<li>Insufficient document capacity.</li>:null}</ul></div>:null}
    {confirming?<form action={action} className="mt-5 border-t border-border pt-5"><input type="hidden" name="confirmation" value="ISSUE"/><p className="font-bold text-text">Issue this {documentType.toLowerCase().replaceAll("_", " ")}{customerName ? ` for ${customerName}` : ""}?</p><p className="mt-2 text-sm text-text">Total: <strong>{currency} {grandTotal}</strong></p><p className="mt-2 max-w-2xl text-sm text-muted">Once issued, this document becomes read-only and consumes one document from your workspace allowance or purchased credits.</p><div className="mt-4 flex flex-wrap gap-2"><button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Issuing…" : "Confirm Issue"}</button><button type="button" disabled={pending} onClick={()=>setConfirming(false)} className="min-h-11 rounded-lg border border-border px-5 text-sm font-semibold text-text">Keep as Draft</button></div></form>:null}
    {state.message?<div className="mt-4" role="alert"><p className="text-sm font-semibold text-danger">{state.message}</p>{state.readiness?.length?<ul className="mt-2 list-disc pl-5 text-sm text-danger">{state.readiness.map(item=><li key={item}>{item}</li>)}</ul>:null}</div>:null}
  </section>;
}
