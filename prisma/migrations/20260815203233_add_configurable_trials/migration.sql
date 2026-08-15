-- CreateEnum
CREATE TYPE "WorkspaceTrialStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "TrialGrantSource" AS ENUM ('AUTO_NEW_WORKSPACE', 'PLATFORM_MANUAL', 'PAYMENT_CONVERSION');

-- CreateTable
CREATE TABLE "TrialConfiguration" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'GLOBAL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trialPlanId" UUID NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 14,
    "fallbackPlanId" UUID NOT NULL,
    "newWorkspacesOnly" BOOLEAN NOT NULL DEFAULT true,
    "oneTrialPerWorkspace" BOOLEAN NOT NULL DEFAULT true,
    "paymentMethodRequired" BOOLEAN NOT NULL DEFAULT false,
    "allowManualGrant" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrialConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceTrial" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "trialPlanId" UUID NOT NULL,
    "fallbackPlanId" UUID NOT NULL,
    "status" "WorkspaceTrialStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "grantedByUserId" UUID,
    "grantSource" "TrialGrantSource" NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "expiredAt" TIMESTAMPTZ(3),
    "convertedAt" TIMESTAMPTZ(3),
    "trialPlanCodeSnapshot" VARCHAR(50) NOT NULL,
    "trialPlanNameSnapshot" VARCHAR(100) NOT NULL,
    "trialMemberLimitSnapshot" INTEGER,
    "trialDocumentLimitSnapshot" INTEGER,
    "trialFeaturesSnapshot" JSONB NOT NULL DEFAULT '{}',
    "fallbackPlanCodeSnapshot" VARCHAR(50) NOT NULL,
    "fallbackPlanNameSnapshot" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkspaceTrial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrialConfiguration_trialPlanId_idx" ON "TrialConfiguration"("trialPlanId");

-- CreateIndex
CREATE INDEX "TrialConfiguration_fallbackPlanId_idx" ON "TrialConfiguration"("fallbackPlanId");

-- CreateIndex
CREATE INDEX "WorkspaceTrial_workspaceId_createdAt_idx" ON "WorkspaceTrial"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceTrial_status_endsAt_idx" ON "WorkspaceTrial"("status", "endsAt");

-- CreateIndex
CREATE INDEX "WorkspaceTrial_trialPlanId_status_idx" ON "WorkspaceTrial"("trialPlanId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceTrial_fallbackPlanId_idx" ON "WorkspaceTrial"("fallbackPlanId");

-- CreateIndex
CREATE INDEX "WorkspaceTrial_grantedByUserId_idx" ON "WorkspaceTrial"("grantedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceTrial_one_active_per_workspace_key" ON "WorkspaceTrial"("workspaceId") WHERE ("status" = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "TrialConfiguration" ADD CONSTRAINT "TrialConfiguration_trialPlanId_fkey" FOREIGN KEY ("trialPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialConfiguration" ADD CONSTRAINT "TrialConfiguration_fallbackPlanId_fkey" FOREIGN KEY ("fallbackPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTrial" ADD CONSTRAINT "WorkspaceTrial_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTrial" ADD CONSTRAINT "WorkspaceTrial_trialPlanId_fkey" FOREIGN KEY ("trialPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTrial" ADD CONSTRAINT "WorkspaceTrial_fallbackPlanId_fkey" FOREIGN KEY ("fallbackPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTrial" ADD CONSTRAINT "WorkspaceTrial_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
