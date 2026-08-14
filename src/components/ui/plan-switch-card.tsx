"use client";

import { useActionState, useState } from "react";

import { changeWorkspacePlanAction } from "@/features/subscriptions/actions";
import {
  initialPlanFormState,
  type PlanOption,
} from "@/features/subscriptions/types";

function formatLimit(limit: number | null) {
  return limit === null ? "Custom" : limit.toLocaleString("en-GH");
}

function formatBetaPrice(plan: Pick<PlanOption, "betaPrice" | "currency">) {
  const amount = Number(plan.betaPrice).toLocaleString("en-GH", {
    maximumFractionDigits: 2,
  });
  return plan.currency === "GHS" ? `GH₵${amount}` : `${plan.currency} ${amount}`;
}

export function PlanSwitchCard({
  plan,
  currentPlanCode,
  canManage,
}: {
  plan: PlanOption;
  currentPlanCode: string;
  canManage: boolean;
}) {
  const current = plan.code === currentPlanCode;
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    changeWorkspacePlanAction,
    initialPlanFormState,
  );

  return (
    <article
      className={`flex min-w-0 flex-col rounded-xl border p-5 ${
        current ? "border-civ-blue bg-active" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text">{plan.name}</h2>
          <p className="mt-1 text-sm font-semibold text-link">
            {formatBetaPrice(plan)} during beta
          </p>
        </div>
        {current ? (
          <span className="rounded-full bg-civ-blue px-2.5 py-1 text-xs font-semibold text-white">
            Current Plan
          </span>
        ) : null}
      </div>

      {plan.description ? (
        <p className="mt-4 text-sm leading-6 text-muted">{plan.description}</p>
      ) : null}

      <dl className="mt-5 grid gap-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Members</dt>
          <dd className="font-semibold text-text">{formatLimit(plan.memberLimit)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Issued documents</dt>
          <dd className="font-semibold text-text">{formatLimit(plan.documentLimit)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Beta price</dt>
          <dd className="font-semibold text-text">{formatBetaPrice(plan)}</dd>
        </div>
      </dl>

      <div className="mt-auto pt-5">
        {!current && canManage ? (
          confirming ? (
            <form action={action} className="grid gap-3">
              <input type="hidden" name="planCode" value={plan.code} />
              <p className="text-sm leading-6 text-text">
                Switch this workspace from {currentPlanCode.charAt(0) + currentPlanCode.slice(1).toLowerCase()} to {plan.name}? New limits: {formatLimit(plan.memberLimit)} members and {formatLimit(plan.documentLimit)} issued documents.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={pending}
                  className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70"
                >
                  {pending ? "Switching…" : "Confirm switch"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                  className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="min-h-11 w-full rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link hover:bg-hover"
            >
              Switch to {plan.name}
            </button>
          )
        ) : current ? (
          <p className="text-sm font-semibold text-link">Active for this workspace</p>
        ) : (
          <p className="text-sm text-muted">Only the Workspace Owner can switch plans.</p>
        )}
        {state.message ? (
          <p
            className={`mt-3 text-sm ${state.success ? "text-success" : "text-danger"}`}
            role="status"
            aria-live="polite"
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
