import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/features/audit/service";
import { requireSubscriptionManagerInTransaction } from "@/features/subscriptions/authorization";
import { db } from "@/lib/db";

import {
  CommercialValidationError,
  CreditAcquisitionUnavailableError,
} from "./errors";
import { getPurchasedCreditBalance } from "./ledger";
import {
  commercialTransactionOptions,
  lockWorkspaceCommercialAccount,
} from "./locking";
import { betaCreditAcquisitionSchema } from "./validation";

export async function acquireBetaDocumentCredits(input: {
  actorUserId: string;
  workspaceId: string;
  packCode: unknown;
}) {
  const parsed = betaCreditAcquisitionSchema.safeParse({
    packCode: input.packCode,
  });
  if (!parsed.success) {
    throw new CommercialValidationError(parsed.error.flatten().fieldErrors);
  }

  try {
    return await db.$transaction(async (transaction) => {
      await lockWorkspaceCommercialAccount(transaction, input.workspaceId);
      await requireSubscriptionManagerInTransaction(
        transaction,
        input.actorUserId,
        input.workspaceId,
      );
      const pack = await transaction.documentCreditPack.findUnique({
        where: { code: parsed.data.packCode },
      });
      if (!pack?.isActive || !pack.isPublic) {
        throw new CreditAcquisitionUnavailableError("PACK");
      }
      if (!pack.price.equals(0)) {
        throw new CreditAcquisitionUnavailableError("PAID");
      }

      const existing = await transaction.documentCreditPurchase.findFirst({
        where: {
          workspaceId: input.workspaceId,
          packId: pack.id,
          betaAcquisition: true,
        },
        select: { id: true },
      });
      if (existing) {
        throw new CreditAcquisitionUnavailableError("ALREADY_ACQUIRED");
      }

      const now = new Date();
      const purchase = await transaction.documentCreditPurchase.create({
        data: {
          workspaceId: input.workspaceId,
          packId: pack.id,
          actorUserId: input.actorUserId,
          status: "COMPLETED",
          betaAcquisition: true,
          creditAmountSnapshot: pack.creditAmount,
          priceSnapshot: pack.price,
          currencySnapshot: pack.currency,
          completedAt: now,
        },
      });
      await transaction.documentCreditTransaction.create({
        data: {
          workspaceId: input.workspaceId,
          type: "PURCHASE",
          amount: pack.creditAmount,
          source: "BETA_CREDIT_PACK",
          sourceReference: `beta-purchase:${purchase.id}`,
          packId: pack.id,
          purchaseId: purchase.id,
          actorUserId: input.actorUserId,
          metadata: { packCode: pack.code },
        },
      });
      await recordAuditEvent(transaction, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "DOCUMENT_CREDITS_ACQUIRED",
        resourceType: "CREDIT_ACCOUNT",
        resourceId: purchase.id,
        metadata: {
          packCode: pack.code,
          credits: pack.creditAmount,
          betaPrice: pack.price.toFixed(4),
          currency: pack.currency,
        },
      });
      const balance = await getPurchasedCreditBalance(
        transaction,
        input.workspaceId,
      );
      return {
        purchaseId: purchase.id,
        packCode: pack.code,
        credits: pack.creditAmount,
        balance,
      };
    }, commercialTransactionOptions);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new CreditAcquisitionUnavailableError("ALREADY_ACQUIRED");
    }
    throw error;
  }
}
