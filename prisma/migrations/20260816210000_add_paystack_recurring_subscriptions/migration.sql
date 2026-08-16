-- CreateEnum
CREATE TYPE "PlanBillingMode" AS ENUM ('FREE', 'RECURRING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SubscriptionChangeStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionBillingPeriodStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Plan"
ADD COLUMN "monthlyPrice" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN "billingMode" "PlanBillingMode" NOT NULL DEFAULT 'FREE',
ADD COLUMN "paystackPlanCode" VARCHAR(100);

-- AlterTable
ALTER TABLE "Subscription"
ADD COLUMN "fallbackPlanId" UUID,
ADD COLUMN "pendingPlanId" UUID,
ADD COLUMN "provider" "PaymentProvider",
ADD COLUMN "providerCustomerCode" VARCHAR(100),
ADD COLUMN "providerSubscriptionCode" VARCHAR(100),
ADD COLUMN "currentPeriodStart" TIMESTAMPTZ(3),
ADD COLUMN "currentPeriodEnd" TIMESTAMPTZ(3),
ADD COLUMN "nextPaymentAt" TIMESTAMPTZ(3),
ADD COLUMN "lastPaymentAt" TIMESTAMPTZ(3),
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment"
ADD COLUMN "subscriptionChangeId" UUID,
ADD COLUMN "subscriptionBillingPeriodId" UUID,
ALTER COLUMN "initiatedByUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SubscriptionChange" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "targetPlanId" UUID NOT NULL,
    "actorUserId" UUID,
    "status" "SubscriptionChangeStatus" NOT NULL DEFAULT 'PENDING',
    "fromPlanCodeSnapshot" VARCHAR(50) NOT NULL,
    "targetPlanCodeSnapshot" VARCHAR(50) NOT NULL,
    "targetPlanNameSnapshot" VARCHAR(100) NOT NULL,
    "priceSnapshot" DECIMAL(19,4) NOT NULL,
    "currencySnapshot" CHAR(3) NOT NULL,
    "providerPlanCodeSnapshot" VARCHAR(100) NOT NULL,
    "providerCustomerCode" VARCHAR(100),
    "providerSubscriptionCode" VARCHAR(100),
    "providerNextPaymentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionBillingPeriod" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionBillingPeriodStatus" NOT NULL DEFAULT 'PENDING',
    "providerInvoiceCode" VARCHAR(100),
    "providerTransactionReference" VARCHAR(100),
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    CONSTRAINT "SubscriptionBillingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_paystackPlanCode_key" ON "Plan"("paystackPlanCode");
CREATE UNIQUE INDEX "Subscription_providerSubscriptionCode_key" ON "Subscription"("providerSubscriptionCode");
CREATE INDEX "Subscription_fallbackPlanId_idx" ON "Subscription"("fallbackPlanId");
CREATE INDEX "Subscription_pendingPlanId_idx" ON "Subscription"("pendingPlanId");
CREATE INDEX "Subscription_provider_providerCustomerCode_idx" ON "Subscription"("provider", "providerCustomerCode");
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

CREATE UNIQUE INDEX "SubscriptionChange_providerSubscriptionCode_key" ON "SubscriptionChange"("providerSubscriptionCode");
CREATE UNIQUE INDEX "SubscriptionChange_one_pending_per_subscription_key" ON "SubscriptionChange"("subscriptionId") WHERE "status" = 'PENDING';
CREATE INDEX "SubscriptionChange_workspaceId_createdAt_idx" ON "SubscriptionChange"("workspaceId", "createdAt");
CREATE INDEX "SubscriptionChange_targetPlanId_status_idx" ON "SubscriptionChange"("targetPlanId", "status");
CREATE INDEX "SubscriptionChange_providerCustomerCode_idx" ON "SubscriptionChange"("providerCustomerCode");
CREATE INDEX "SubscriptionChange_actorUserId_idx" ON "SubscriptionChange"("actorUserId");

CREATE UNIQUE INDEX "SubscriptionBillingPeriod_providerInvoiceCode_key" ON "SubscriptionBillingPeriod"("providerInvoiceCode");
CREATE UNIQUE INDEX "SubscriptionBillingPeriod_providerTransactionReference_key" ON "SubscriptionBillingPeriod"("providerTransactionReference");
CREATE UNIQUE INDEX "SubscriptionBillingPeriod_subscriptionId_periodStart_key" ON "SubscriptionBillingPeriod"("subscriptionId", "periodStart");
CREATE INDEX "SubscriptionBillingPeriod_subscriptionId_periodEnd_idx" ON "SubscriptionBillingPeriod"("subscriptionId", "periodEnd");
CREATE INDEX "SubscriptionBillingPeriod_planId_status_idx" ON "SubscriptionBillingPeriod"("planId", "status");
CREATE INDEX "SubscriptionBillingPeriod_status_periodEnd_idx" ON "SubscriptionBillingPeriod"("status", "periodEnd");

CREATE UNIQUE INDEX "Payment_subscriptionBillingPeriodId_key" ON "Payment"("subscriptionBillingPeriodId");
CREATE INDEX "Payment_subscriptionChangeId_status_idx" ON "Payment"("subscriptionChangeId", "status");

-- Change the actor relation to preserve automated recurring-payment history.
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_initiatedByUserId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_fallbackPlanId_fkey" FOREIGN KEY ("fallbackPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_targetPlanId_fkey" FOREIGN KEY ("targetPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionBillingPeriod" ADD CONSTRAINT "SubscriptionBillingPeriod_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionBillingPeriod" ADD CONSTRAINT "SubscriptionBillingPeriod_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionChangeId_fkey" FOREIGN KEY ("subscriptionChangeId") REFERENCES "SubscriptionChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionBillingPeriodId_fkey" FOREIGN KEY ("subscriptionBillingPeriodId") REFERENCES "SubscriptionBillingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
