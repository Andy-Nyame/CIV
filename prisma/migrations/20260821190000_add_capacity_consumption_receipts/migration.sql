-- CreateTable
CREATE TABLE "DocumentCapacityConsumption" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "allowancePeriodId" UUID NOT NULL,
    "sourceReference" VARCHAR(255) NOT NULL,
    "amount" INTEGER NOT NULL,
    "monthlyUsed" INTEGER NOT NULL,
    "purchasedUsed" INTEGER NOT NULL,
    "allowanceUsedAfter" INTEGER NOT NULL,
    "purchasedBalanceAfter" INTEGER NOT NULL,
    "actorUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentCapacityConsumption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DocumentCapacityConsumption_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "DocumentCapacityConsumption_monthly_used_check" CHECK ("monthlyUsed" >= 0),
    CONSTRAINT "DocumentCapacityConsumption_purchased_used_check" CHECK ("purchasedUsed" >= 0),
    CONSTRAINT "DocumentCapacityConsumption_split_check" CHECK ("amount" = "monthlyUsed" + "purchasedUsed"),
    CONSTRAINT "DocumentCapacityConsumption_allowance_after_check" CHECK ("allowanceUsedAfter" >= 0),
    CONSTRAINT "DocumentCapacityConsumption_balance_after_check" CHECK ("purchasedBalanceAfter" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCapacityConsumption_sourceReference_key" ON "DocumentCapacityConsumption"("sourceReference");
CREATE INDEX "DocumentCapacityConsumption_workspaceId_createdAt_idx" ON "DocumentCapacityConsumption"("workspaceId", "createdAt");
CREATE INDEX "DocumentCapacityConsumption_allowancePeriodId_idx" ON "DocumentCapacityConsumption"("allowancePeriodId");
CREATE INDEX "DocumentCapacityConsumption_actorUserId_idx" ON "DocumentCapacityConsumption"("actorUserId");

-- AddForeignKey
ALTER TABLE "DocumentCapacityConsumption" ADD CONSTRAINT "DocumentCapacityConsumption_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentCapacityConsumption" ADD CONSTRAINT "DocumentCapacityConsumption_allowancePeriodId_fkey" FOREIGN KEY ("allowancePeriodId") REFERENCES "WorkspaceDocumentAllowancePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentCapacityConsumption" ADD CONSTRAINT "DocumentCapacityConsumption_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
