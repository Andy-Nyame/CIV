"use client";

import { useState } from "react";

const documentTypes = ["Invoice", "Receipt", "Quotation", "VAT/Tax Invoice"];

type CreateDocumentMenuProps = {
  compact?: boolean;
  label?: "Create" | "Create Document";
};

export function CreateDocumentMenu({
  compact = false,
  label = "Create",
}: CreateDocumentMenuProps) {
  const [message, setMessage] = useState<string | null>(null);

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
            <button
              key={documentType}
              type="button"
              className="min-h-11 rounded-lg px-3 text-left text-sm font-semibold text-text hover:bg-hover"
              onClick={() =>
                setMessage(
                  `${documentType} creation will be enabled in a later phase.`,
                )
              }
            >
              {documentType}
            </button>
          ))}
        </div>
        {message ? (
          <p
            className="mt-2 rounded-lg bg-surface-muted px-3 py-2 text-xs leading-5 text-muted"
            role="status"
          >
            {message}
          </p>
        ) : null}
      </div>
    </details>
  );
}
