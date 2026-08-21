CREATE TYPE "TaxCalculationBase" AS ENUM ('ORIGINAL_BASE', 'BASE_PLUS_APPLICABLE_LEVIES');

ALTER TABLE "TaxComponent"
  ADD COLUMN "baseStrategy" "TaxCalculationBase" NOT NULL DEFAULT 'ORIGINAL_BASE',
  ADD COLUMN "contributesToTaxableValue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contributesToTotal" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Document"
  ADD COLUMN "taxableValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxCalculation" JSONB;

CREATE TABLE "DocumentNumberSequence" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "documentType" "DocumentType" NOT NULL,
  "currentValue" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DocumentNumberSequence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentNumberSequence_current_nonnegative" CHECK ("currentValue" >= 0)
);

CREATE UNIQUE INDEX "DocumentNumberSequence_workspaceId_documentType_key"
  ON "DocumentNumberSequence"("workspaceId", "documentType");
CREATE INDEX "DocumentNumberSequence_workspaceId_idx"
  ON "DocumentNumberSequence"("workspaceId");

ALTER TABLE "DocumentNumberSequence"
  ADD CONSTRAINT "DocumentNumberSequence_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TaxVersion"
  ADD CONSTRAINT "TaxVersion_effective_range_valid"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "TaxComponent"
  ADD CONSTRAINT "TaxComponent_rate_valid" CHECK ("rate" >= 0 AND "rate" <= 100);
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_tax_totals_nonnegative"
  CHECK ("taxableValue" >= 0 AND "taxTotal" >= 0);

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "TaxVersion"
  ADD CONSTRAINT "TaxVersion_no_active_effective_overlap"
  EXCLUDE USING gist (
    "taxProfileId" WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::date), '[]') WITH &&
  ) WHERE ("isActive");
