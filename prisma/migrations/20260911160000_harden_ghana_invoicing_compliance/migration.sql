-- Additive compliance state for the pre-GRA adapter boundary. Existing issued
-- snapshots and their financial values are not rewritten.
CREATE TYPE "VatSalesReceiptAuthorization" AS ENUM ('UNKNOWN', 'NOT_AUTHORIZED', 'AUTHORIZED');
CREATE TYPE "CustomerTaxStatus" AS ENUM ('ORDINARY_CONSUMER', 'TAXABLE_PERSON');
CREATE TYPE "ReceiptType" AS ENUM ('COMMERCIAL', 'VAT_SALES_RECEIPT');
CREATE TYPE "FiscalizationStatus" AS ENUM ('NOT_RECORDED', 'NOT_REQUIRED', 'REQUIRES_GRA', 'PENDING', 'CERTIFIED', 'FAILED');

ALTER TABLE "Workspace"
  ADD COLUMN "vatSalesReceiptAuthorization" "VatSalesReceiptAuthorization" NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE "Customer"
  ADD COLUMN "taxStatus" "CustomerTaxStatus" NOT NULL DEFAULT 'ORDINARY_CONSUMER';

ALTER TABLE "Document"
  ADD COLUMN "customerTaxStatus" "CustomerTaxStatus" NOT NULL DEFAULT 'ORDINARY_CONSUMER',
  ADD COLUMN "receiptType" "ReceiptType" NOT NULL DEFAULT 'COMMERCIAL',
  ADD COLUMN "servicePeriodStart" TIMESTAMPTZ(3),
  ADD COLUMN "servicePeriodEnd" TIMESTAMPTZ(3),
  ADD COLUMN "withholdingAgent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "withholdingEvidence" VARCHAR(500),
  ADD COLUMN "fiscalizationStatus" "FiscalizationStatus" NOT NULL DEFAULT 'NOT_RECORDED',
  ADD COLUMN "graFiscalDocumentId" VARCHAR(200),
  ADD COLUMN "graTimestamp" TIMESTAMPTZ(3),
  ADD COLUMN "graSignature" TEXT,
  ADD COLUMN "graVerificationEngineId" VARCHAR(200),
  ADD COLUMN "graVerificationPayload" TEXT,
  ADD COLUMN "graSecurityData" TEXT,
  ADD COLUMN "graProviderReference" VARCHAR(300),
  ADD COLUMN "voidReason" VARCHAR(1000),
  ADD COLUMN "voidedByUserId" UUID;

-- New drafts get an explicit pre-integration state in application code. Mark
-- existing mutable VAT drafts likewise; historical issued documents retain the
-- neutral NOT_RECORDED compatibility state.
UPDATE "Document"
SET "fiscalizationStatus" = 'REQUIRES_GRA'::"FiscalizationStatus"
WHERE "status" = 'DRAFT'::"DocumentStatus"
  AND "type" = 'VAT_INVOICE'::"DocumentType";

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_void_audit_check"
  CHECK (
    "status" <> 'VOIDED'::"DocumentStatus"
    OR ("voidedAt" IS NOT NULL AND "voidedByUserId" IS NOT NULL AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) > 0)
  ) NOT VALID,
  ADD CONSTRAINT "Document_service_period_check"
  CHECK ("servicePeriodEnd" IS NULL OR "servicePeriodStart" IS NULL OR "servicePeriodEnd" >= "servicePeriodStart"),
  ADD CONSTRAINT "Document_certified_fiscalization_check"
  CHECK (
    "fiscalizationStatus" <> 'CERTIFIED'::"FiscalizationStatus"
    OR (
      "graFiscalDocumentId" IS NOT NULL AND length(btrim("graFiscalDocumentId")) > 0
      AND "graTimestamp" IS NOT NULL
      AND "graProviderReference" IS NOT NULL AND length(btrim("graProviderReference")) > 0
    )
  ) NOT VALID,
  ADD CONSTRAINT "Document_voidedByUserId_fkey"
  FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DocumentPaymentEvent" (
  "id" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "amount" DECIMAL(19,4) NOT NULL,
  "method" VARCHAR(100),
  "reference" VARCHAR(300),
  "isPartial" BOOLEAN NOT NULL DEFAULT true,
  "eventOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DocumentPaymentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentPaymentEvent_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "DocumentPaymentEvent_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DocumentPaymentEvent_documentId_eventOrder_key" ON "DocumentPaymentEvent"("documentId", "eventOrder");
CREATE INDEX "DocumentPaymentEvent_documentId_occurredAt_idx" ON "DocumentPaymentEvent"("documentId", "occurredAt");
CREATE INDEX "Document_voidedByUserId_idx" ON "Document"("voidedByUserId");
CREATE INDEX "Document_fiscalizationStatus_idx" ON "Document"("fiscalizationStatus");
CREATE INDEX "Document_graFiscalDocumentId_idx" ON "Document"("graFiscalDocumentId");
CREATE INDEX "Document_graProviderReference_idx" ON "Document"("graProviderReference");
