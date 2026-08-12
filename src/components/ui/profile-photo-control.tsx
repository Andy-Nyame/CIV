"use client";

import Image from "next/image";
import { useActionState } from "react";

import {
  removeProfilePhotoAction,
  uploadProfilePhotoAction,
} from "@/features/profile/actions";
import { chooseProfileImage, getTrustedProfileImage } from "@/features/profile/image";
import { initialProfileFormState } from "@/features/profile/types";

export function ProfilePhotoControl({
  image,
  privateImageUrl,
  name,
  email,
}: {
  image: string | null;
  privateImageUrl: string | null;
  name: string | null;
  email: string | null;
}) {
  const [uploadState, uploadAction, uploadPending] = useActionState(
    uploadProfilePhotoAction,
    initialProfileFormState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeProfilePhotoAction,
    initialProfileFormState,
  );
  const oauthImage = getTrustedProfileImage(image);
  const displayedImage = chooseProfileImage(privateImageUrl, image);
  const initial = (name?.trim() || email || "C").charAt(0).toUpperCase();

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-4">
        {displayedImage ? (
          <Image
            alt={`${name?.trim() || "CIV user"} profile photo`}
            className="size-20 rounded-full border border-border object-cover"
            height={80}
            src={displayedImage}
            width={80}
            unoptimized={Boolean(privateImageUrl)}
          />
        ) : (
          <span
            className="grid size-20 place-items-center rounded-full bg-civ-navy text-2xl font-bold text-white"
            aria-label="Profile photo placeholder"
          >
            {initial}
          </span>
        )}
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-text">Profile photo</p>
          <p className="max-w-md text-sm leading-6 text-muted">
            {privateImageUrl
              ? "Your private CIV photo is shown instead of your connected account photo."
              : oauthImage
                ? "Your connected Google photo is shown until you upload a CIV photo."
                : "Upload a private CIV profile photo, or keep the initials fallback."}
          </p>
        </div>
      </div>

      <form action={uploadAction} className="grid gap-3" noValidate>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="profile-photo">
          Upload custom photo
          <input
            id="profile-photo"
            className="min-h-12 rounded-lg border border-border bg-surface px-3 py-2 font-normal text-text file:mr-3 file:rounded-md file:border-0 file:bg-active file:px-3 file:py-2 file:font-semibold file:text-link"
            name="image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            aria-describedby="profile-photo-help"
            aria-invalid={Boolean(uploadState.fieldErrors?.image)}
          />
        </label>
        <p id="profile-photo-help" className="text-sm leading-6 text-muted">
          PNG, JPEG, or WebP up to 5 MB. CIV stores a private, optimized square copy.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={uploadPending}
            className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70"
          >
            {uploadPending ? "Saving…" : privateImageUrl ? "Replace photo" : "Save photo"}
          </button>
          {privateImageUrl ? (
            <button
              formAction={removeAction}
              formNoValidate
              disabled={removePending}
              className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover disabled:cursor-wait disabled:opacity-70"
            >
              {removePending ? "Removing…" : "Remove custom photo"}
            </button>
          ) : null}
        </div>
      </form>

      {[uploadState, removeState].map((state, index) =>
        state.message ? (
          <p
            key={index}
            className={`text-sm ${state.success ? "text-success" : "text-danger"}`}
            role="status"
            aria-live="polite"
          >
            {state.message}
          </p>
        ) : null,
      )}
    </div>
  );
}
