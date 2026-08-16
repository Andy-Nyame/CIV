-- AlterEnum
ALTER TYPE "DocumentCreditPurchaseStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "documentCreditPurchaseId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCreditPurchase_pending_paid_workspace_pack_key"
ON "DocumentCreditPurchase"("workspaceId", "packId")
WHERE ("status" = 'PENDING' AND "betaAcquisition" = false);

-- CreateIndex
CREATE INDEX "Payment_documentCreditPurchaseId_status_idx"
ON "Payment"("documentCreditPurchaseId", "status");

-- AddForeignKey
ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_documentCreditPurchaseId_fkey"
FOREIGN KEY ("documentCreditPurchaseId")
REFERENCES "DocumentCreditPurchase"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
