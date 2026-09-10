-- The initial CIV schema already reserved the nullable, uniquely indexed
-- "civDocumentId" column. Activate it as the CIV-native verification code
-- without backfilling or rewriting historical issued records.
--
-- NOT VALID preserves any legacy non-null values while enforcing the canonical
-- format for newly inserted or updated rows.
ALTER TABLE "Document"
ADD CONSTRAINT "Document_civ_verification_code_format_check"
CHECK (
  "civDocumentId" IS NULL
  OR "civDocumentId" ~ '^CIV-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$'
) NOT VALID;

-- A historical NULL may receive a code only through an explicit future
-- backfill. Once any document has a verification identity, database writes
-- cannot replace or remove it.
CREATE FUNCTION "prevent_document_verification_code_change"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."civDocumentId" IS NOT NULL
     AND NEW."civDocumentId" IS DISTINCT FROM OLD."civDocumentId" THEN
    RAISE EXCEPTION 'CIV document verification codes are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Document_verification_code_immutable"
BEFORE UPDATE OF "civDocumentId" ON "Document"
FOR EACH ROW
EXECUTE FUNCTION "prevent_document_verification_code_change"();
