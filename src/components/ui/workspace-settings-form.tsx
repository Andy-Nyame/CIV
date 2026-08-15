"use client";

import { useActionState } from "react";

import { updateWorkspaceSettingsAction } from "@/features/workspaces/settings-actions";
import { initialWorkspaceSettingsFormState } from "@/features/workspaces/types";

type WorkspaceValues = {
  name: string;
  type: "INDIVIDUAL" | "BUSINESS" | "ORGANIZATION";
  country: string;
  currency: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  registrationNumber: string | null;
  businessTin: string | null;
};

const typeLabels = {
  INDIVIDUAL: "Individual",
  BUSINESS: "Business",
  ORGANIZATION: "Organization",
} as const;

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.[0] ? (
    <span className="text-sm font-normal text-danger">{errors[0]}</span>
  ) : null;
}

export function WorkspaceSettingsForm({
  workspace,
  canManage,
}: {
  workspace: WorkspaceValues;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateWorkspaceSettingsAction,
    initialWorkspaceSettingsFormState,
  );
  const inputClass =
    "min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted";

  return (
    <form action={action} className="grid gap-8" noValidate>
      <section aria-labelledby="general-settings-heading">
        <div className="max-w-2xl">
          <h2 id="general-settings-heading" className="text-xl font-bold text-text">
            General
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Keep the workspace identity and everyday contact details accurate.
          </p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold text-text">
            Workspace name
            <input
              className={inputClass}
              name="name"
              defaultValue={workspace.name}
              maxLength={200}
              required
              disabled={!canManage}
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
            <FieldError errors={state.fieldErrors?.name} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-text">
            Workspace type
            <input className={inputClass} value={typeLabels[workspace.type]} disabled readOnly />
            <span className="text-sm font-normal text-muted">Workspace type is set when the workspace is created.</span>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-text">
            Country
            <input
              className={inputClass}
              name="country"
              defaultValue={workspace.country}
              maxLength={2}
              disabled={!canManage}
              aria-describedby="country-help"
              aria-invalid={Boolean(state.fieldErrors?.country)}
            />
            <span id="country-help" className="text-sm font-normal text-muted">Two-letter country code, such as GH.</span>
            <FieldError errors={state.fieldErrors?.country} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-text">
            Currency
            <input
              className={inputClass}
              name="currency"
              defaultValue={workspace.currency}
              maxLength={3}
              disabled={!canManage}
              aria-describedby="currency-help"
              aria-invalid={Boolean(state.fieldErrors?.currency)}
            />
            <span id="currency-help" className="text-sm font-normal text-muted">Three-letter currency code, such as GHS.</span>
            <FieldError errors={state.fieldErrors?.currency} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-text">
            Workspace email
            <input
              className={inputClass}
              name="email"
              type="email"
              defaultValue={workspace.email ?? ""}
              maxLength={320}
              disabled={!canManage}
              aria-invalid={Boolean(state.fieldErrors?.email)}
            />
            <FieldError errors={state.fieldErrors?.email} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-text">
            Phone
            <input
              className={inputClass}
              name="phone"
              type="tel"
              defaultValue={workspace.phone ?? ""}
              maxLength={50}
              disabled={!canManage}
              aria-invalid={Boolean(state.fieldErrors?.phone)}
            />
            <FieldError errors={state.fieldErrors?.phone} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-text sm:col-span-2">
            Address
            <textarea
              className="min-h-28 rounded-lg border border-border bg-surface px-3.5 py-3 font-normal text-text disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted"
              name="address"
              defaultValue={workspace.address ?? ""}
              maxLength={1000}
              disabled={!canManage}
              aria-invalid={Boolean(state.fieldErrors?.address)}
            />
            <FieldError errors={state.fieldErrors?.address} />
          </label>
        </div>
      </section>

      <section id="business-details" className="border-t border-border pt-8" aria-labelledby="business-details-heading">
        <div className="max-w-2xl">
          <h2 id="business-details-heading" className="text-xl font-bold text-text">
            Business Details
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {workspace.type === "INDIVIDUAL"
              ? "Registration and TIN details are not required for an Individual workspace."
              : "Optional official details for future business-document presentation."}
          </p>
        </div>
        {workspace.type !== "INDIVIDUAL" ? (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-text">
              Registration number
              <input
                className={inputClass}
                name="registrationNumber"
                defaultValue={workspace.registrationNumber ?? ""}
                maxLength={100}
                disabled={!canManage}
                aria-invalid={Boolean(state.fieldErrors?.registrationNumber)}
              />
              <FieldError errors={state.fieldErrors?.registrationNumber} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-text">
              Tax / TIN number
              <input
                className={inputClass}
                name="businessTin"
                defaultValue={workspace.businessTin ?? ""}
                maxLength={100}
                disabled={!canManage}
                aria-invalid={Boolean(state.fieldErrors?.businessTin)}
              />
              <FieldError errors={state.fieldErrors?.businessTin} />
            </label>
          </div>
        ) : (
          <input name="registrationNumber" type="hidden" value={workspace.registrationNumber ?? ""} />
        )}
        {workspace.type === "INDIVIDUAL" ? (
          <input name="businessTin" type="hidden" value={workspace.businessTin ?? ""} />
        ) : null}
      </section>

      {state.message ? (
        <p className={`text-sm ${state.success ? "text-verification" : "text-danger"}`} role="status" aria-live="polite">
          {state.message}
        </p>
      ) : null}
      {canManage ? (
        <button
          className="min-h-12 rounded-lg bg-civ-blue px-5 font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70 sm:justify-self-start"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save workspace settings"}
        </button>
      ) : (
        <p className="rounded-lg bg-surface-muted px-4 py-3 text-sm leading-6 text-muted">
          Your role can view these details. An Owner or Admin can edit them.
        </p>
      )}
    </form>
  );
}
