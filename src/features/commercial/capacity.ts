import "server-only";

import { db } from "@/lib/db";

import {
  CommercialValidationError,
  DocumentCapacityConsumptionConflictError,
  InsufficientDocumentCapacityError,
} from "./errors";
import { getPurchasedCreditBalance } from "./ledger";
import {
  commercialTransactionOptions,
  lockWorkspaceCommercialAccount,
} from "./locking";
import { ensureCurrentAllowancePeriod } from "./periods";
import { consumeDocumentCapacitySchema } from "./validation";

export async function getDocumentCapacityAvailability(
  workspaceId: string,
  amount = 1,
) {
  const parsed = consumeDocumentCapacitySchema.pick({ workspaceId: true, amount: true }).safeParse({
    workspaceId,
    amount,
  });
  if (!parsed.success) {
    throw new CommercialValidationError(parsed.error.flatten().fieldErrors);
  }

  return db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, parsed.data.workspaceId);
    const period = await ensureCurrentAllowancePeriod(
      transaction,
      parsed.data.workspaceId,
    );
    const purchasedBalance = await getPurchasedCreditBalance(
      transaction,
      parsed.data.workspaceId,
    );
    if (purchasedBalance < 0) throw new InsufficientDocumentCapacityError();
    const monthlyRemaining =
      period.allowance === null
        ? null
        : Math.max(0, period.allowance - period.used);
    const totalAvailable =
      monthlyRemaining === null ? null : monthlyRemaining + purchasedBalance;
    return {
      canConsume:
        totalAvailable === null || totalAvailable >= parsed.data.amount,
      requestedAmount: parsed.data.amount,
      monthlyRemaining,
      purchasedBalance,
      totalAvailable,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      consumptionOrder: ["MONTHLY_ALLOWANCE", "PURCHASED_CREDITS"] as const,
    };
  }, commercialTransactionOptions);
}

export async function consumeDocumentCapacity(input: unknown) {
  const parsed = consumeDocumentCapacitySchema.safeParse(input);
  if (!parsed.success) {
    throw new CommercialValidationError(parsed.error.flatten().fieldErrors);
  }

  return db.$transaction(async (transaction) => {
    await lockWorkspaceCommercialAccount(transaction, parsed.data.workspaceId);
    const existing = await transaction.documentCapacityConsumption.findUnique({
      where: { sourceReference: parsed.data.sourceReference },
    });
    if (existing) {
      if (
        existing.workspaceId !== parsed.data.workspaceId ||
        existing.amount !== parsed.data.amount
      ) {
        throw new DocumentCapacityConsumptionConflictError();
      }
      return {
        consumptionId: existing.id,
        monthlyUsed: existing.monthlyUsed,
        purchasedUsed: existing.purchasedUsed,
        allowanceUsed: existing.allowanceUsedAfter,
        purchasedBalance: existing.purchasedBalanceAfter,
        idempotent: true,
      };
    }
    const period = await ensureCurrentAllowancePeriod(
      transaction,
      parsed.data.workspaceId,
    );
    const purchasedBalance = await getPurchasedCreditBalance(
      transaction,
      parsed.data.workspaceId,
    );
    if (purchasedBalance < 0) throw new InsufficientDocumentCapacityError();

    const monthlyRemaining =
      period.allowance === null
        ? null
        : Math.max(0, period.allowance - period.used);
    const monthlyUsed =
      monthlyRemaining === null
        ? parsed.data.amount
        : Math.min(monthlyRemaining, parsed.data.amount);
    const purchasedUsed = parsed.data.amount - monthlyUsed;
    if (purchasedUsed > purchasedBalance) {
      throw new InsufficientDocumentCapacityError();
    }

    const allowanceUsedAfter = period.used + monthlyUsed;
    const purchasedBalanceAfter = purchasedBalance - purchasedUsed;
    await transaction.workspaceDocumentAllowancePeriod.update({
      where: { id: period.id },
      data: { used: { increment: monthlyUsed } },
    });
    if (purchasedUsed > 0) {
      await transaction.documentCreditTransaction.create({
        data: {
          workspaceId: parsed.data.workspaceId,
          type: "USAGE",
          amount: -purchasedUsed,
          source: "DOCUMENT_CAPACITY",
          sourceReference: parsed.data.sourceReference,
          actorUserId: parsed.data.actorUserId,
          metadata: { monthlyUsed, purchasedUsed },
        },
      });
    }

    const consumption = await transaction.documentCapacityConsumption.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        allowancePeriodId: period.id,
        sourceReference: parsed.data.sourceReference,
        amount: parsed.data.amount,
        monthlyUsed,
        purchasedUsed,
        allowanceUsedAfter,
        purchasedBalanceAfter,
        actorUserId: parsed.data.actorUserId,
      },
      select: { id: true },
    });

    return {
      consumptionId: consumption.id,
      monthlyUsed,
      purchasedUsed,
      allowanceUsed: allowanceUsedAfter,
      purchasedBalance: purchasedBalanceAfter,
      idempotent: false,
    };
  }, commercialTransactionOptions);
}
