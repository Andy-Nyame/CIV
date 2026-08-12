"use client";

import { useState } from "react";

export function CopyInvitationLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-2">
      <label className="grid gap-1.5 text-sm font-semibold text-text">
        Invitation link
        <input
          className="min-h-11 rounded-lg border border-border bg-page px-3 font-normal text-text"
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <button
        type="button"
        className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover sm:justify-self-start"
        onClick={copyLink}
      >
        {copied ? "Copied" : "Copy Invitation Link"}
      </button>
    </div>
  );
}
