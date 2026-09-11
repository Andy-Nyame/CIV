"use client";

import { useActionState, useState } from "react";

import { updateWorkspaceSettingsAction } from "@/features/workspaces/settings-actions";
import { initialWorkspaceSettingsFormState } from "@/features/workspaces/types";

type WorkspaceValues = {
  name: string;
  type: "INDIVIDUAL" | "BUSINESS" | "ORGANIZATION";
  environment: "NORMAL" | "TEST";
  legalName: string | null;
  tradingName: string | null;
  country: string;
  currency: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  registrationNumber: string | null;
  businessTin: string | null;
  taxpayerId: string | null;
  taxpayerIdType: "GHANA_CARD_PIN" | "GRA_TIN" | null;
  taxpayerVerificationStatus: "UNVERIFIED" | "VERIFIED";
  businessActivity: "GOODS" | "SERVICES" | "BOTH";
  vatRegistrationStatus: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED";
  vatRegistrationEffectiveDate: Date | string | null;
  vatDeregistrationEffectiveDate: Date | string | null;
  vatRegistered: boolean;
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
  const [workspaceType, setWorkspaceType] = useState(workspace.type);
  const [businessActivity, setBusinessActivity] = useState(workspace.businessActivity);
  const [vatStatus, setVatStatus] = useState(workspace.vatRegistrationStatus);
  const dateValue = (value: Date | string | null) => value
    ? (typeof value === "string" ? value : value.toISOString()).slice(0, 10)
    : "";
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
            <select className={inputClass} name="type" value={workspaceType} onChange={(event) => setWorkspaceType(event.target.value as WorkspaceValues["type"])} disabled={!canManage}>
              {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
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
            Business address
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

      <section id="taxpayer-details" className="border-t border-border pt-8" aria-labelledby="taxpayer-details-heading">
        <div className="max-w-2xl">
          <h2 id="taxpayer-details-heading" className="text-xl font-bold text-text">
            Taxpayer information
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Required for document creation in a normal workspace. Saving a valid format does not constitute official GRA verification.
          </p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-text sm:col-span-2">
              Legal / registered name
              <input className={inputClass} name="legalName" defaultValue={workspace.legalName ?? ""} maxLength={200} disabled={!canManage} aria-invalid={Boolean(state.fieldErrors?.legalName)} />
              <FieldError errors={state.fieldErrors?.legalName} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-text">
              Trading name <span className="font-normal text-muted">(optional)</span>
              <input className={inputClass} name="tradingName" defaultValue={workspace.tradingName ?? ""} maxLength={200} disabled={!canManage} aria-invalid={Boolean(state.fieldErrors?.tradingName)} />
              <FieldError errors={state.fieldErrors?.tradingName} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-text">
              Registration number <span className="font-normal text-muted">(optional)</span>
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
              {workspaceType === "INDIVIDUAL" ? "Ghana Card PIN" : "GRA TIN"}
              <input
                className={inputClass}
                name="taxpayerId"
                defaultValue={workspace.taxpayerId ?? (workspaceType === "INDIVIDUAL" ? "" : workspace.businessTin ?? "")}
                maxLength={100}
                disabled={!canManage}
                aria-invalid={Boolean(state.fieldErrors?.taxpayerId)}
              />
              <span className="text-sm font-normal text-muted">Status: {workspace.taxpayerVerificationStatus === "VERIFIED" ? "Verified" : "Unverified"}</span>
              <FieldError errors={state.fieldErrors?.taxpayerId} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-text">
              Business activity
              <select className={inputClass} name="businessActivity" value={businessActivity} onChange={(event) => setBusinessActivity(event.target.value as WorkspaceValues["businessActivity"])} disabled={!canManage}>
                <option value="GOODS">Goods</option>
                <option value="SERVICES">Services</option>
                <option value="BOTH">Goods and services</option>
              </select>
              <span className="text-sm font-normal text-muted">Used for compliance guidance; CIV does not determine legal registration liability.</span>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-text">
              VAT registration status
              <select className={inputClass} name="vatRegistrationStatus" value={vatStatus} onChange={(event) => setVatStatus(event.target.value as WorkspaceValues["vatRegistrationStatus"])} disabled={!canManage}>
                <option value="NOT_REGISTERED">Not registered</option>
                <option value="PENDING">Pending</option>
                <option value="REGISTERED">Registered</option>
                <option value="DEREGISTERED">Deregistered</option>
              </select>
              <span className="text-sm font-normal text-muted">A taxpayer ID alone does not make this workspace VAT eligible.</span>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-text">
              VAT registration effective date
              <input className={inputClass} type="date" name="vatRegistrationEffectiveDate" defaultValue={dateValue(workspace.vatRegistrationEffectiveDate)} disabled={!canManage || !["REGISTERED", "DEREGISTERED"].includes(vatStatus)} />
              <FieldError errors={state.fieldErrors?.vatRegistrationEffectiveDate} />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-text">
              Deregistration effective date
              <input className={inputClass} type="date" name="vatDeregistrationEffectiveDate" defaultValue={dateValue(workspace.vatDeregistrationEffectiveDate)} disabled={!canManage || vatStatus !== "DEREGISTERED"} />
              <FieldError errors={state.fieldErrors?.vatDeregistrationEffectiveDate} />
            </label>
          </div>
          <div className="mt-5 rounded-lg bg-surface-muted p-4 text-sm leading-6 text-muted">
            {businessActivity === "GOODS" ? "2026 guidance: the applicable goods-supplier VAT registration threshold is currently GH₵750,000. GRA determines final liability." : businessActivity === "SERVICES" ? "2026 guidance: service providers have no general VAT registration threshold. Confirm your position with GRA." : "2026 guidance: goods may use the current GH₵750,000 threshold, while service providers have no general threshold. Confirm your position with GRA."}
          </div>
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
