"use client";

import Link from "next/link";

const documentTypes = [
  { label: "Invoice", type: "INVOICE" },
  { label: "Receipt", type: "RECEIPT" },
  { label: "VAT Invoice", type: "VAT_INVOICE" },
] as const;

type CreateDocumentMenuProps = {
  compact?: boolean;
  label?: "Create" | "Create Document";
};

export function CreateDocumentMenu({
  compact = false,
  label = "Create",
}: CreateDocumentMenuProps) {
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
          {documentTypes.map((documentType) => (
            <Link
              key={documentType.type}
              href={`/app/documents/new?type=${documentType.type}`}
              className="min-h-11 rounded-lg px-3 text-left text-sm font-semibold text-text hover:bg-hover"
            >
              {documentType.label}
            </Link>
          ))}
        </div>
      </div>
    </details>
  );
}
