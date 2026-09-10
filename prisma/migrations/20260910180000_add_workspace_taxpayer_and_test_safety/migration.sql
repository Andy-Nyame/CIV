-- Additive workspace compliance and test-safety state. New fields remain
-- nullable/defaulted so populated databases require no destructive backfill.
CREATE TYPE "WorkspaceEnvironment" AS ENUM ('NORMAL', 'TEST');
CREATE TYPE "TaxpayerIdType" AS ENUM ('GHANA_CARD_PIN', 'GRA_TIN');
CREATE TYPE "TaxpayerVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

ALTER TABLE "Workspace"
ADD COLUMN "environment" "WorkspaceEnvironment" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN "legalName" VARCHAR(200),
ADD COLUMN "tradingName" VARCHAR(200),
ADD COLUMN "taxpayerIdType" "TaxpayerIdType",
ADD COLUMN "taxpayerId" VARCHAR(100),
ADD COLUMN "taxpayerVerificationStatus" "TaxpayerVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "vatRegistered" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Document"
ADD COLUMN "isTestDocument" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Workspace_environment_idx" ON "Workspace"("environment");
