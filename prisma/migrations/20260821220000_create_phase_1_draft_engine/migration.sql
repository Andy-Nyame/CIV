ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'VAT_INVOICE';

CREATE TYPE "ItemServiceType" AS ENUM ('ITEM', 'SERVICE');

ALTER TABLE "Customer"
  ADD COLUMN "createdByUserId" UUID;

ALTER TABLE "ItemService"
  ADD COLUMN "createdByUserId" UUID,
  ADD COLUMN "type" "ItemServiceType" NOT NULL DEFAULT 'SERVICE',
  ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'GHS',
  ADD COLUMN "unitLabel" VARCHAR(50),
  ADD COLUMN "sku" VARCHAR(100);

ALTER TABLE "Document"
  ADD COLUMN "draftReference" VARCHAR(40) NOT NULL,
  ADD COLUMN "draftDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "discountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "rateTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "grandTotal" DECIMAL(19,4) NOT NULL DEFAULT 0;

ALTER TABLE "DocumentLine"
  ADD COLUMN "customRateId" UUID,
  ADD COLUMN "lineSubtotal" DECIMAL(19,4) NOT NULL,
  ADD COLUMN "rateNameSnapshot" VARCHAR(200),
  ADD COLUMN "rateTypeSnapshot" "RateType",
  ADD COLUMN "rateValueSnapshot" DECIMAL(19,6),
  ADD COLUMN "rateTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "lineTotal" DECIMAL(19,4) NOT NULL;

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ItemService"
  ADD CONSTRAINT "ItemService_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentLine"
  ADD CONSTRAINT "DocumentLine_customRateId_fkey" FOREIGN KEY ("customRateId") REFERENCES "CustomRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Document_draftReference_key" ON "Document"("draftReference");
CREATE UNIQUE INDEX "Document_official_number_key" ON "Document"("workspaceId", "type", "documentNumber") WHERE "documentNumber" IS NOT NULL;
CREATE UNIQUE INDEX "ItemService_workspace_sku_key" ON "ItemService"("workspaceId", "sku") WHERE "sku" IS NOT NULL;
CREATE INDEX "Customer_createdByUserId_idx" ON "Customer"("createdByUserId");
CREATE INDEX "ItemService_createdByUserId_idx" ON "ItemService"("createdByUserId");
CREATE INDEX "ItemService_workspaceId_sku_idx" ON "ItemService"("workspaceId", "sku");
CREATE INDEX "Document_workspaceId_draftReference_idx" ON "Document"("workspaceId", "draftReference");
CREATE INDEX "DocumentLine_customRateId_idx" ON "DocumentLine"("customRateId");

ALTER TABLE "ItemService" ADD CONSTRAINT "ItemService_unitPrice_nonnegative" CHECK ("unitPrice" >= 0);
ALTER TABLE "Document" ADD CONSTRAINT "Document_totals_nonnegative" CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "rateTotal" >= 0 AND "grandTotal" >= 0);
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_financial_values_valid" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "lineSubtotal" >= 0 AND "rateTotal" >= 0 AND "lineTotal" >= 0);
