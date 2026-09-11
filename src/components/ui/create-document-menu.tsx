"use client";

import Link from "next/link";

const documentTypes = [
  { label: "Invoice", type: "INVOICE" },
  { label: "Receipt", type: "RECEIPT" },
  { label: "VAT Invoice", type: "VAT_INVOICE" },
  { label: "Credit Note", type: "CREDIT_NOTE" },
  { label: "Debit Note", type: "DEBIT_NOTE" },
] as const;

type CreateDocumentMenuProps = {
  compact?: boolean;
  label?: "Create" | "Create Document";
  readiness?: {
    ready: boolean;
    vatReady: boolean;
    isTestWorkspace: boolean;
    issues: string[];
  };
};

export function CreateDocumentMenu({
  compact = false,
  label = "Create",
  readiness,
}: CreateDocumentMenuProps) {
  if (readiness && !readiness.ready) {
    return <div className="rounded-lg border border-civ-blue bg-active p-3"><p className="text-sm font-bold text-text">Complete workspace setup</p><p className="mt-1 text-xs leading-5 text-muted">{readiness.issues[0]}</p><Link href="/app/settings#taxpayer-details" className="mt-2 inline-block text-xs font-semibold text-link underline">Open settings</Link></div>;
  }
  return (
    <details className="group relative">
      <summary
        className={`flex min-h-11 list-none items-center justify-center gap-2 rounded-lg bg-civ-blue font-semibold text-white hover:bg-civ-blue-hover [&::-webkit-details-marker]:hidden ${
          compact ? "px-3 text-sm" : "w-full px-4"
        }`}
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        {label}
      </summary>
      <div
        className={`z-40 rounded-xl border border-border bg-surface p-2 shadow-lg ${
          compact
            ? "fixed top-16 right-4 left-4 mt-2"
            : "absolute left-0 mt-2 w-72 max-w-[calc(100vw-2rem)]"
        }`}
      >
        <p className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          New document
        </p>
        <div className="grid gap-1">
          {readiness?.isTestWorkspace ? <p className="rounded-md bg-danger px-3 py-2 text-xs font-bold text-white">TEST WORKSPACE · NOT VALID</p> : null}
          {documentTypes.map((documentType) => (
            documentType.type === "VAT_INVOICE" && readiness && !readiness.vatReady
              ? <div key={documentType.type} className="rounded-lg px-3 py-2 text-sm text-muted"><span className="font-semibold">VAT Invoice</span><span className="block text-xs">VAT registration is required.</span></div>
              : <Link key={documentType.type} href={`/app/documents/new?type=${documentType.type}`} className="min-h-11 rounded-lg px-3 text-left text-sm font-semibold text-text hover:bg-hover">{documentType.label}</Link>
          ))}
        </div>
      </div>
    </details>
  );
}
