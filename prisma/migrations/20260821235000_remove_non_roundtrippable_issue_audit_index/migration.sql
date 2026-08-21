-- Document locking and the atomic issued transition enforce one issuance audit.
-- Prisma cannot round-trip the equality predicate on this VARCHAR index without drift.
DROP INDEX "AuditEvent_document_issued_once_key";
