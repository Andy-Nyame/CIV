-- Capture the customer details used by each document independently of an
-- optional reusable Customer record. All columns are nullable so existing
-- drafts and issued documents require no backfill or snapshot rewrite.
ALTER TABLE "Document"
ADD COLUMN "customerName" VARCHAR(200),
ADD COLUMN "customerEmail" VARCHAR(320),
ADD COLUMN "customerPhone" VARCHAR(50),
ADD COLUMN "customerAddress" TEXT,
ADD COLUMN "customerBusinessTin" VARCHAR(100);
