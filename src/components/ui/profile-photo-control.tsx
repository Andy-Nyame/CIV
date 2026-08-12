"use client";

import Image from "next/image";
import { useActionState } from "react";

import { removeProfileImageAction } from "@/features/profile/actions";
import { getTrustedProfileImage } from "@/features/profile/image";
import { initialProfileFormState } from "@/features/profile/types";

export function ProfilePhotoControl({
  image,
  name,
  email,
}: {
  image: string | null;
  name: string | null;
  email: string | null;
}) {
  const [state, action, pending] = useActionState(
    removeProfileImageAction,
    initialProfileFormState,
  );
  const trustedImage = getTrustedProfileImage(image);
  const initial = (name?.trim() || email || "C").charAt(0).toUpperCase();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-4">
        {trustedImage ? (
          <Image
            alt={`${name?.trim() || "CIV user"} profile photo`}
            className="size-20 rounded-full border border-border object-cover"
            height={80}
            src={trustedImage}
            width={80}
          />
        ) : (
          <span
            className="grid size-20 place-items-center rounded-full bg-civ-navy text-2xl font-bold text-white"
            aria-label="Profile photo placeholder"
          >
            {initial}
          </span>
        )}
        <div className="grid gap-2">
          <p className="text-sm text-muted">
            {trustedImage
              ? "This photo comes from your connected Google account."
              : "No profile photo is currently saved."}
          </p>
          {trustedImage ? (
            <form action={action}>
              <button
                disabled={pending}
                className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover disabled:cursor-wait disabled:opacity-70"
              >
                {pending ? "Removing…" : "Remove photo"}
              </button>
            </form>
          ) : null}
        </div>
      </div>
      {state.message ? (
        <p className={`text-sm ${state.success ? "text-success" : "text-danger"}`} role="status">
          {state.message}
        </p>
      ) : null}
      <p className="rounded-lg border border-border bg-page px-4 py-3 text-sm leading-6 text-muted">
        Custom photo uploads require CIV&apos;s private media storage and are not available yet.
      </p>
    </div>
  );
}
