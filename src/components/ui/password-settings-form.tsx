"use client";

import { useActionState } from "react";

import { updatePasswordAction } from "@/features/profile/actions";
import { initialProfileFormState } from "@/features/profile/types";

function PasswordField({
  autoComplete,
  error,
  id,
  label,
  name,
}: {
  autoComplete: string;
  error?: string[];
  id: string;
  label: string;
  name: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-text" htmlFor={id}>
      {label}
      <input
        id={id}
        className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text"
        name={name}
        type="password"
        autoComplete={autoComplete}
        required
        minLength={8}
        maxLength={128}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <span id={`${id}-error`} className="font-normal text-danger" role="alert">
          {error[0]}
        </span>
      ) : null}
    </label>
  );
}

export function PasswordSettingsForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState(
    updatePasswordAction,
    initialProfileFormState,
  );

  return (
    <form action={action} className="grid gap-4" noValidate>
      {hasPassword ? (
        <PasswordField
          autoComplete="current-password"
          error={state.fieldErrors?.currentPassword}
          id="current-password"
          label="Current password"
          name="currentPassword"
        />
      ) : null}
      <PasswordField
        autoComplete="new-password"
        error={state.fieldErrors?.newPassword}
        id="new-password"
        label="New password"
        name="newPassword"
      />
      <PasswordField
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
        id="confirm-password"
        label="Confirm new password"
        name="confirmPassword"
      />
      <p className="text-sm leading-6 text-muted">
        Use 8–128 characters. Passwords are not trimmed or subject to arbitrary composition rules.
      </p>
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
        disabled={pending}
        className="min-h-11 rounded-lg bg-civ-blue px-4 font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70 sm:justify-self-start"
      >
        {pending
          ? hasPassword
            ? "Changing…"
            : "Setting…"
          : hasPassword
            ? "Change Password"
            : "Set Password"}
      </button>
    </form>
  );
}
