-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'NEEDS_ATTENTION', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentReconciliationStatus" AS ENUM ('NOT_REQUIRED', 'REQUIRED', 'RESOLVED');

-- AlterTable
ALTER TABLE "DocumentCreditTransaction" ADD COLUMN "refundId" UUID;

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "reconciledAt" TIMESTAMPTZ(3),
ADD COLUMN "reconciliationNote" VARCHAR(255),
ADD COLUMN "reconciliationStatus" "PaymentReconciliationStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "initiatedByUserId" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "internalReference" VARCHAR(100) NOT NULL,
    "providerRefundId" VARCHAR(100),
    "providerRefundReference" VARCHAR(100),
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "creditAmount" INTEGER,
    "reason" VARCHAR(500) NOT NULL,
    "safeFailureCode" VARCHAR(100),
    "expectedAt" TIMESTAMPTZ(3),
    "refundedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentRefund_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "PaymentRefund_credit_amount_positive_check" CHECK ("creditAmount" IS NULL OR "creditAmount" > 0),
    CONSTRAINT "PaymentRefund_active_status_check" CHECK (
      "active" = ("status" IN ('REQUESTED', 'PROCESSING', 'NEEDS_ATTENTION'))
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_internalReference_key" ON "PaymentRefund"("internalReference");
CREATE UNIQUE INDEX "PaymentRefund_providerRefundId_key" ON "PaymentRefund"("providerRefundId");
CREATE UNIQUE INDEX "PaymentRefund_providerRefundReference_key" ON "PaymentRefund"("providerRefundReference");
CREATE INDEX "PaymentRefund_paymentId_status_createdAt_idx" ON "PaymentRefund"("paymentId", "status", "createdAt");
CREATE INDEX "PaymentRefund_workspaceId_createdAt_idx" ON "PaymentRefund"("workspaceId", "createdAt");
CREATE INDEX "PaymentRefund_initiatedByUserId_createdAt_idx" ON "PaymentRefund"("initiatedByUserId", "createdAt");
CREATE INDEX "PaymentRefund_status_createdAt_idx" ON "PaymentRefund"("status", "createdAt");
CREATE UNIQUE INDEX "PaymentRefund_one_active_per_payment_key" ON "PaymentRefund"("paymentId") WHERE ("active" = true);
CREATE UNIQUE INDEX "DocumentCreditTransaction_refundId_key" ON "DocumentCreditTransaction"("refundId");

-- AddForeignKey
ALTER TABLE "DocumentCreditTransaction" ADD CONSTRAINT "DocumentCreditTransaction_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PaymentRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
