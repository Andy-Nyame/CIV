"use client";

import { useActionState, useState } from "react";

import { createWorkspaceAction } from "@/features/workspaces/actions";
import { initialWorkspaceFormState } from "@/features/workspaces/types";

const workspaceTypes = [
  {
    value: "INDIVIDUAL",
    label: "Individual",
    description: "For managing your own professional documents.",
  },
  {
    value: "BUSINESS",
    label: "Business",
    description: "For a business or small company.",
  },
  {
    value: "ORGANIZATION",
    label: "Organization",
    description: "For an organization or larger team.",
  },
] as const;

type WorkspaceFormProps = {
  defaultName?: string;
  submitLabel?: string;
};

export function WorkspaceForm({
  defaultName = "",
  submitLabel = "Create Workspace",
}: WorkspaceFormProps) {
  const [workspaceType, setWorkspaceType] =
    useState<(typeof workspaceTypes)[number]["value"]>("INDIVIDUAL");
  const [state, formAction, pending] = useActionState(
    createWorkspaceAction,
    initialWorkspaceFormState,
  );
  const selectedLabel = workspaceTypes.find(
    ({ value }) => value === workspaceType,
  )?.label;

  return (
    <form action={formAction} className="grid gap-7" noValidate>
      <fieldset>
        <legend className="text-base font-semibold text-text">
          How will you use CIV?
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {workspaceTypes.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${
                workspaceType === option.value
                  ? "border-civ-blue bg-active"
                  : "border-border bg-surface hover:bg-hover"
              }`}
            >
              <input
                className="mt-0.5 size-5 shrink-0 accent-civ-blue"
                type="radio"
                name="type"
                value={option.value}
                checked={workspaceType === option.value}
                onChange={() => setWorkspaceType(option.value)}
              />
              <span>
                <span className="block font-semibold text-text">
                  {option.label}
                </span>
                <span className="mt-1 block text-sm leading-5 text-muted">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
        {state.fieldErrors?.type ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {state.fieldErrors.type[0]}
          </p>
        ) : null}
      </fieldset>

      <label
        className="grid gap-2 text-sm font-semibold text-text"
        htmlFor="workspace-name"
      >
        {selectedLabel} name
        <input
          id="workspace-name"
          className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text placeholder:text-muted"
          name="name"
          type="text"
          defaultValue={defaultName}
          placeholder={`Enter your ${selectedLabel?.toLowerCase()} name`}
          required
          minLength={2}
          maxLength={200}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          aria-describedby={
            state.fieldErrors?.name ? "workspace-name-error" : undefined
          }
        />
        {state.fieldErrors?.name ? (
          <span
            id="workspace-name-error"
            className="text-sm font-normal text-danger"
          >
            {state.fieldErrors.name[0]}
          </span>
        ) : null}
      </label>

      {state.message ? (
        <p
          className="text-sm leading-6 text-danger"
          role="alert"
          aria-live="polite"
        >
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-lg bg-civ-blue px-5 font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70 sm:justify-self-start"
      >
        {pending ? "Creating workspace…" : submitLabel}
      </button>
    </form>
  );
}
