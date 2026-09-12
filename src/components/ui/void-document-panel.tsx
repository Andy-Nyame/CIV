"use client";

import { useActionState } from "react";

import { voidDocumentAction, type VoidDocumentState } from "@/features/documents/actions";

export function VoidDocumentPanel({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(voidDocumentAction.bind(null, documentId), {} as VoidDocumentState);
  return <form action={action} className="mt-8 rounded-xl border border-danger/40 bg-surface p-5 sm:p-6">
    <h2 className="font-bold text-text">Void issued document</h2>
    <p className="mt-1 text-sm leading-6 text-muted">Use this only to cancel the issued record itself. Financial corrections to a real supply should use a Credit Note or Debit Note.</p>
    <label className="mt-4 grid gap-2 text-sm font-semibold text-text">Reason<input className="min-h-11 rounded-lg border border-border bg-page px-3 font-normal" name="reason" minLength={8} maxLength={1000} required /></label>
    <button className="mt-4 min-h-11 rounded-lg border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-60" disabled={pending}>{pending ? "Voiding…" : "Void Document"}</button>
    {state.message ? <p className={`mt-3 text-sm ${state.success ? "text-verification" : "text-danger"}`} role="status">{state.message}</p> : null}
  </form>;
}
