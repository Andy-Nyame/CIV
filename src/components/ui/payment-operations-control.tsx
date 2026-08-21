"use client";

import { useActionState, useState } from "react";

import {
  reconcilePaymentAction,
  requestPaymentRefundAction,
} from "@/features/payments/operations-actions";
import { initialPaymentActionState } from "@/features/payments/types";

export function PaymentOperationsControl({
  paymentId,
  paymentReference,
  amount,
  currency,
  remainingRefundableAmount,
  purpose,
  activeRefundId,
  canRefund,
  canReconcile,
}: {
  paymentId: string;
  paymentReference: string;
  amount: string;
  currency: string;
  remainingRefundableAmount: string;
  purpose: string;
  activeRefundId: string | null;
  canRefund: boolean;
  canReconcile: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [refundState, refundAction, refundPending] = useActionState(
    requestPaymentRefundAction,
    initialPaymentActionState,
  );
  const [reconcileState, reconcileAction, reconcilePending] = useActionState(
    reconcilePaymentAction,
    initialPaymentActionState,
  );
  const fullCreditRefund = purpose === "DOCUMENT_CREDITS";
  const refundable = Number(remainingRefundableAmount) > 0;

  return (
    <div className="min-w-64 space-y-2">
      {canRefund && refundable && !activeRefundId ? (
        confirming ? (
          <form action={refundAction} className="space-y-2 rounded-lg border border-danger/30 bg-surface-muted p-3">
            <input type="hidden" name="paymentId" value={paymentId} />
            <p className="text-xs leading-5 text-text">
              Refund {currency} {fullCreditRefund ? amount : `up to ${remainingRefundableAmount}`} from {paymentReference}? Refunds do not cancel subscriptions.
            </p>
            {fullCreditRefund ? (
              <input type="hidden" name="amount" value={remainingRefundableAmount} />
            ) : (
              <label className="block text-xs font-semibold text-text">
                Amount
                <input required name="amount" inputMode="decimal" defaultValue={remainingRefundableAmount} className="mt-1 min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm" />
              </label>
            )}
            <label className="block text-xs font-semibold text-text">
              Reason
              <textarea required name="reason" minLength={10} maxLength={500} rows={2} className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={refundPending} className="min-h-10 rounded-md bg-danger px-3 text-xs font-bold text-white disabled:opacity-60">
                {refundPending ? "Submitting…" : "Confirm refund"}
              </button>
              <button type="button" disabled={refundPending} onClick={() => setConfirming(false)} className="min-h-10 rounded-md border border-border px-3 text-xs font-bold text-text">Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="min-h-10 rounded-md border border-danger px-3 text-xs font-bold text-danger">Refund payment</button>
        )
      ) : null}
      {canReconcile ? (
        <form action={reconcileAction}>
          <input type="hidden" name="paymentId" value={paymentId} />
          {activeRefundId ? <input type="hidden" name="refundId" value={activeRefundId} /> : null}
          <button disabled={reconcilePending} className="min-h-10 rounded-md border border-border px-3 text-xs font-bold text-text disabled:opacity-60">
            {reconcilePending ? "Checking…" : "Reconcile with Paystack"}
          </button>
        </form>
      ) : null}
      {refundState.message ? <p role="status" className={`text-xs ${refundState.success ? "text-success" : "text-danger"}`}>{refundState.message}</p> : null}
      {reconcileState.message ? <p role="status" className={`text-xs ${reconcileState.success ? "text-success" : "text-danger"}`}>{reconcileState.message}</p> : null}
    </div>
  );
}
