-- Record the authenticated issuer on the operational document row.
ALTER TABLE "Document"
ADD COLUMN "issuedByUserId" UUID;

-- Bind the exactly-once commercial receipt to its issued document.
ALTER TABLE "DocumentCapacityConsumption"
ADD COLUMN "documentId" UUID;

CREATE UNIQUE INDEX "DocumentCapacityConsumption_documentId_key"
ON "DocumentCapacityConsumption"("documentId");

CREATE INDEX "Document_issuedByUserId_idx"
ON "Document"("issuedByUserId");

ALTER TABLE "Document"
ADD CONSTRAINT "Document_issuedByUserId_fkey"
FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentCapacityConsumption"
ADD CONSTRAINT "DocumentCapacityConsumption_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drafts have no issued identity; every issued/voided record has a complete one.
ALTER TABLE "Document"
ADD CONSTRAINT "Document_issue_state_check"
CHECK (
  (
    "status" = 'DRAFT'
    AND "documentNumber" IS NULL
    AND "issueDate" IS NULL
    AND "issuedAt" IS NULL
    AND "issuedByUserId" IS NULL
  )
  OR
  (
    "status" IN ('ISSUED', 'VOIDED')
    AND "documentNumber" IS NOT NULL
    AND "issueDate" IS NOT NULL
    AND "issuedAt" IS NOT NULL
    AND "issuedByUserId" IS NOT NULL
  )
);

ALTER TABLE "DocumentSnapshot"
ADD CONSTRAINT "DocumentSnapshot_version_positive_check"
CHECK ("snapshotVersion" > 0);

-- Application audit history is append-only and one issue success is permitted per document.
CREATE UNIQUE INDEX "AuditEvent_document_issued_once_key"
ON "AuditEvent"("workspaceId", "action", "resourceId")
WHERE "action" = 'DOCUMENT_ISSUED' AND "resourceId" IS NOT NULL;
