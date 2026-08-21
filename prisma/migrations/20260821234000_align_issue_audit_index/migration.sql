-- Align the issuance-audit partial index with Prisma's canonical predicate.
DROP INDEX "AuditEvent_document_issued_once_key";

CREATE UNIQUE INDEX "AuditEvent_document_issued_once_key"
ON "AuditEvent"("workspaceId", "action", "resourceId")
WHERE ("action" = 'DOCUMENT_ISSUED' AND "resourceId" IS NOT NULL);
