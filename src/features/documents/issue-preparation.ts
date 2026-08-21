import "server-only";

/**
 * The future ISSUE mutation will execute these steps in one database transaction.
 * Phase 2 deliberately exposes no function that performs them.
 */
export const ISSUE_TRANSACTION_STEPS = [
  "VALIDATE_READINESS",
  "FREEZE_TRUSTED_CALCULATION",
  "ALLOCATE_OFFICIAL_NUMBER",
  "CONSUME_DOCUMENT_CAPACITY",
  "PERSIST_IMMUTABLE_SNAPSHOT",
  "TRANSITION_TO_ISSUED",
  "RECORD_ISSUANCE_AUDIT",
] as const;

export function buildIssueIdempotencyReference(documentId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
    throw new Error("A valid document ID is required for issue preparation.");
  }
  return `civ:document:${documentId}:issue:v1`;
}
