"use client";

import { useActionState } from "react";

import { updateDisplayNameAction } from "@/features/profile/actions";
import { initialProfileFormState } from "@/features/profile/types";

export function ProfileNameForm({ name }: { name: string | null }) {
  const [state, action, pending] = useActionState(
    updateDisplayNameAction,
    initialProfileFormState,
  );

  return (
    <form action={action} className="grid gap-4" noValidate>
      <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="profile-name">
        Display name
        <input
          id="profile-name"
          className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text"
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={name ?? ""}
          required
          minLength={2}
          maxLength={200}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={state.fieldErrors?.name ? "profile-name-error" : undefined}
        />
      </label>
      {state.fieldErrors?.name ? (
        <p id="profile-name-error" className="text-sm text-danger" role="alert">
          {state.fieldErrors.name[0]}
        </p>
      ) : null}
      {state.message ? (
        <p
          className={`text-sm ${state.success ? "text-success" : "text-danger"}`}
          role="status"
          aria-live="polite"
        >
          {state.message}
        </p>
      ) : null}
      <button
        className="min-h-11 rounded-lg bg-civ-blue px-4 font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70 sm:justify-self-start"
        disabled={pending}
      >
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}
