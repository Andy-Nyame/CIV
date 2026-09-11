-- Additive Ghana 2026 tax-compliance foundation. Historical issued snapshots
-- remain immutable JSON and existing operational rows retain their totals.
CREATE TYPE "BusinessActivity" AS ENUM ('GOODS', 'SERVICES', 'BOTH');
CREATE TYPE "VatRegistrationStatus" AS ENUM ('NOT_REGISTERED', 'PENDING', 'REGISTERED', 'DEREGISTERED');
CREATE TYPE "GhanaTaxTreatment" AS ENUM ('STANDARD_RATED', 'ZERO_RATED', 'EXEMPT');
CREATE TYPE "TaxPriceMode" AS ENUM ('TAX_EXCLUSIVE', 'TAX_INCLUSIVE');
CREATE TYPE "TransactionType" AS ENUM ('SALE', 'SERVICE', 'HIRE_OR_LEASE', 'EXCHANGE', 'OTHER');

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE';

ALTER TABLE "Workspace"
  ADD COLUMN "businessActivity" "BusinessActivity" NOT NULL DEFAULT 'BOTH',
  ADD COLUMN "vatRegistrationStatus" "VatRegistrationStatus" NOT NULL DEFAULT 'NOT_REGISTERED',
  ADD COLUMN "vatRegistrationEffectiveDate" DATE,
  ADD COLUMN "vatDeregistrationEffectiveDate" DATE;

-- Preserve the meaning of the legacy boolean without inventing an effective date.
-- Registered workspaces must deliberately add an effective date before new VAT charging.
UPDATE "Workspace"
SET "vatRegistrationStatus" = CASE
  WHEN "vatRegistered" THEN 'REGISTERED'::"VatRegistrationStatus"
  ELSE 'NOT_REGISTERED'::"VatRegistrationStatus"
END;

ALTER TABLE "Customer"
  ADD COLUMN "taxpayerIdType" "TaxpayerIdType",
  ADD COLUMN "taxpayerId" VARCHAR(100),
  ADD COLUMN "vatRegistrationStatus" "VatRegistrationStatus";

UPDATE "Customer"
SET "taxpayerId" = "businessTin",
    "taxpayerIdType" = CASE WHEN "businessTin" IS NULL THEN NULL ELSE 'GRA_TIN'::"TaxpayerIdType" END
WHERE "businessTin" IS NOT NULL;

ALTER TABLE "ItemService"
  ADD COLUMN "defaultTaxTreatment" "GhanaTaxTreatment" NOT NULL DEFAULT 'STANDARD_RATED',
  ADD COLUMN "taxTreatmentReason" VARCHAR(500),
  ADD COLUMN "taxTreatmentReference" VARCHAR(500);

ALTER TABLE "Document"
  ADD COLUMN "customerTaxpayerIdType" "TaxpayerIdType",
  ADD COLUMN "customerTaxpayerId" VARCHAR(100),
  ADD COLUMN "customerVatRegistrationStatus" "VatRegistrationStatus",
  ADD COLUMN "originalDocumentId" UUID,
  ADD COLUMN "adjustmentReason" VARCHAR(1000),
  ADD COLUMN "supplyDate" TIMESTAMPTZ(3),
  ADD COLUMN "taxPointDate" TIMESTAMPTZ(3),
  ADD COLUMN "transactionType" "TransactionType" NOT NULL DEFAULT 'SALE',
  ADD COLUMN "priceMode" "TaxPriceMode" NOT NULL DEFAULT 'TAX_EXCLUSIVE',
  ADD COLUMN "standardRatedValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "zeroRatedValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "exemptValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "relievedValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "withholdingApplied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "withholdingAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "withholdingReference" VARCHAR(500),
  ADD COLUMN "withholdingDate" DATE,
  ADD COLUMN "netPayable" DECIMAL(19,4) NOT NULL DEFAULT 0;

UPDATE "Document"
SET "supplyDate" = "draftDate"::timestamp AT TIME ZONE 'UTC',
    "taxPointDate" = "draftDate"::timestamp AT TIME ZONE 'UTC',
    "netPayable" = "grandTotal";

ALTER TABLE "DocumentLine"
  ADD COLUMN "unitOfMeasure" VARCHAR(50),
  ADD COLUMN "taxTreatment" "GhanaTaxTreatment" NOT NULL DEFAULT 'STANDARD_RATED',
  ADD COLUMN "taxTreatmentReason" VARCHAR(500),
  ADD COLUMN "taxTreatmentReference" VARCHAR(500),
  ADD COLUMN "reliefApplied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reliefReason" VARCHAR(500),
  ADD COLUMN "reliefReference" VARCHAR(500),
  ADD COLUMN "originalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxableBase" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxCalculation" JSONB;

UPDATE "DocumentLine" line
SET "unitOfMeasure" = item."unitLabel",
    "originalAmount" = line."lineSubtotal",
    "taxableBase" = line."lineSubtotal"
FROM "ItemService" item
WHERE item."id" = line."catalogItemId";

UPDATE "DocumentLine"
SET "originalAmount" = "lineSubtotal",
    "taxableBase" = "lineSubtotal"
WHERE "originalAmount" = 0 AND "lineSubtotal" <> 0;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_originalDocumentId_fkey"
  FOREIGN KEY ("originalDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Document_tax_foundation_totals_check"
  CHECK (
    "standardRatedValue" >= 0 AND "zeroRatedValue" >= 0 AND
    "exemptValue" >= 0 AND "relievedValue" >= 0 AND
    "withholdingAmount" >= 0 AND "netPayable" >= 0
  );

ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_vat_registration_dates_check"
  CHECK ("vatDeregistrationEffectiveDate" IS NULL OR "vatRegistrationEffectiveDate" IS NULL OR "vatDeregistrationEffectiveDate" >= "vatRegistrationEffectiveDate");

ALTER TABLE "DocumentLine"
  ADD CONSTRAINT "DocumentLine_tax_foundation_values_check"
  CHECK (
    "originalAmount" >= 0 AND "discountAmount" >= 0 AND
    "discountAmount" <= "originalAmount" AND "taxableBase" >= 0 AND "taxTotal" >= 0
  ),
  ADD CONSTRAINT "DocumentLine_relief_reason_check"
  CHECK (NOT "reliefApplied" OR ("reliefReason" IS NOT NULL AND length(btrim("reliefReason")) > 0));

CREATE INDEX "Document_originalDocumentId_idx" ON "Document"("originalDocumentId");
