import "server-only";

import { db } from "@/lib/db";

import {
  CommercialValidationError,
  InsufficientDocumentCapacityError,
} from "./errors";
import { getPurchasedCreditBalance } from "./ledger";
import {
  commercialTransactionOptions,
  lockWorkspaceCommercialAccount,
} from "./locking";
import { ensureCurrentAllowancePeriod } from "./periods";
import { consumeDocumentCapacitySchema } from "./validation";

export async function consumeDocumentCapacity(input: unknown) {
  const parsed = consumeDocumentCapacitySchema.safeParse(input);
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
    const monthlyUsed =
      monthlyRemaining === null
        ? parsed.data.amount
        : Math.min(monthlyRemaining, parsed.data.amount);
    const purchasedUsed = parsed.data.amount - monthlyUsed;
    if (purchasedUsed > purchasedBalance) {
      throw new InsufficientDocumentCapacityError();
    }

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

    return {
      monthlyUsed,
      purchasedUsed,
      allowanceUsed: period.used + monthlyUsed,
      purchasedBalance: purchasedBalance - purchasedUsed,
    };
  }, commercialTransactionOptions);
}
