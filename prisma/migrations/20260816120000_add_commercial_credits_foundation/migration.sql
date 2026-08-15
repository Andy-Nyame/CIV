-- CreateEnum
CREATE TYPE "DocumentCreditPurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DocumentCreditTransactionType" AS ENUM ('PURCHASE', 'USAGE', 'ADMIN_ADJUSTMENT', 'REFUND', 'BONUS');

-- Replace the previous plan availability index with configurable availability.
DROP INDEX "Plan_isPublic_isActive_idx";

ALTER TABLE "Plan"
ADD COLUMN "isAvailableForNewWorkspaces" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "Plan"
SET "sortOrder" = CASE "code"
  WHEN 'FREE' THEN 10
  WHEN 'STARTER' THEN 20
  WHEN 'BUSINESS' THEN 30
  WHEN 'PRO' THEN 40
  WHEN 'ENTERPRISE' THEN 50
  ELSE 100
END;

-- CreateTable
CREATE TABLE "DocumentCreditPack" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "creditAmount" INTEGER NOT NULL,
    "price" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'GHS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DocumentCreditPack_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentCreditPack_creditAmount_check" CHECK ("creditAmount" > 0),
    CONSTRAINT "DocumentCreditPack_price_check" CHECK ("price" >= 0),
    CONSTRAINT "DocumentCreditPack_sortOrder_check" CHECK ("sortOrder" >= 0)
);

-- CreateTable
CREATE TABLE "DocumentCreditPurchase" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "actorUserId" UUID,
    "status" "DocumentCreditPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "betaAcquisition" BOOLEAN NOT NULL DEFAULT false,
    "creditAmountSnapshot" INTEGER NOT NULL,
    "priceSnapshot" DECIMAL(19,4) NOT NULL,
    "currencySnapshot" CHAR(3) NOT NULL,
    "externalPaymentReference" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DocumentCreditPurchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentCreditPurchase_creditAmountSnapshot_check" CHECK ("creditAmountSnapshot" > 0),
    CONSTRAINT "DocumentCreditPurchase_priceSnapshot_check" CHECK ("priceSnapshot" >= 0)
);

-- CreateTable
CREATE TABLE "DocumentCreditTransaction" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "type" "DocumentCreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "sourceReference" VARCHAR(255) NOT NULL,
    "packId" UUID,
    "purchaseId" UUID,
    "actorUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentCreditTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentCreditTransaction_amount_check" CHECK ("amount" <> 0)
);

-- CreateTable
CREATE TABLE "WorkspaceDocumentAllowancePeriod" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "allowance" INTEGER,
    "used" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkspaceDocumentAllowancePeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkspaceDocumentAllowancePeriod_allowance_check" CHECK ("allowance" IS NULL OR "allowance" > 0),
    CONSTRAINT "WorkspaceDocumentAllowancePeriod_used_check" CHECK ("used" >= 0),
    CONSTRAINT "WorkspaceDocumentAllowancePeriod_range_check" CHECK ("periodEnd" > "periodStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCreditPack_code_key" ON "DocumentCreditPack"("code");
CREATE INDEX "DocumentCreditPack_isPublic_isActive_sortOrder_idx" ON "DocumentCreditPack"("isPublic", "isActive", "sortOrder");
CREATE UNIQUE INDEX "DocumentCreditPurchase_externalPaymentReference_key" ON "DocumentCreditPurchase"("externalPaymentReference");
CREATE INDEX "DocumentCreditPurchase_workspaceId_status_createdAt_idx" ON "DocumentCreditPurchase"("workspaceId", "status", "createdAt");
CREATE INDEX "DocumentCreditPurchase_packId_status_idx" ON "DocumentCreditPurchase"("packId", "status");
CREATE INDEX "DocumentCreditPurchase_actorUserId_idx" ON "DocumentCreditPurchase"("actorUserId");
CREATE UNIQUE INDEX "DocumentCreditPurchase_beta_workspace_pack_key" ON "DocumentCreditPurchase"("workspaceId", "packId") WHERE ("betaAcquisition" = true);
CREATE UNIQUE INDEX "DocumentCreditTransaction_sourceReference_key" ON "DocumentCreditTransaction"("sourceReference");
CREATE UNIQUE INDEX "DocumentCreditTransaction_purchaseId_key" ON "DocumentCreditTransaction"("purchaseId");
CREATE INDEX "DocumentCreditTransaction_workspaceId_createdAt_idx" ON "DocumentCreditTransaction"("workspaceId", "createdAt");
CREATE INDEX "DocumentCreditTransaction_workspaceId_type_idx" ON "DocumentCreditTransaction"("workspaceId", "type");
CREATE INDEX "DocumentCreditTransaction_packId_idx" ON "DocumentCreditTransaction"("packId");
CREATE INDEX "DocumentCreditTransaction_actorUserId_idx" ON "DocumentCreditTransaction"("actorUserId");
CREATE INDEX "WorkspaceDocumentAllowancePeriod_workspaceId_periodEnd_idx" ON "WorkspaceDocumentAllowancePeriod"("workspaceId", "periodEnd");
CREATE INDEX "WorkspaceDocumentAllowancePeriod_planId_idx" ON "WorkspaceDocumentAllowancePeriod"("planId");
CREATE UNIQUE INDEX "WorkspaceDocumentAllowancePeriod_workspaceId_periodStart_key" ON "WorkspaceDocumentAllowancePeriod"("workspaceId", "periodStart");
CREATE INDEX "Plan_isPublic_isActive_isAvailableForNewWorkspaces_idx" ON "Plan"("isPublic", "isActive", "isAvailableForNewWorkspaces");
CREATE INDEX "Plan_sortOrder_code_idx" ON "Plan"("sortOrder", "code");

-- AddForeignKey
ALTER TABLE "DocumentCreditPurchase" ADD CONSTRAINT "DocumentCreditPurchase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentCreditPurchase" ADD CONSTRAINT "DocumentCreditPurchase_packId_fkey" FOREIGN KEY ("packId") REFERENCES "DocumentCreditPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentCreditPurchase" ADD CONSTRAINT "DocumentCreditPurchase_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentCreditTransaction" ADD CONSTRAINT "DocumentCreditTransaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentCreditTransaction" ADD CONSTRAINT "DocumentCreditTransaction_packId_fkey" FOREIGN KEY ("packId") REFERENCES "DocumentCreditPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentCreditTransaction" ADD CONSTRAINT "DocumentCreditTransaction_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "DocumentCreditPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentCreditTransaction" ADD CONSTRAINT "DocumentCreditTransaction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceDocumentAllowancePeriod" ADD CONSTRAINT "WorkspaceDocumentAllowancePeriod_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkspaceDocumentAllowancePeriod" ADD CONSTRAINT "WorkspaceDocumentAllowancePeriod_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
