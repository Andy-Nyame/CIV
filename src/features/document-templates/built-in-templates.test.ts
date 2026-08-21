import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { issuedDocumentSnapshotSchema } from "@/features/documents/snapshots";
import { db } from "@/lib/db";

import { bootstrapBuiltInDocumentTemplates } from "./bootstrap";
import { BUILT_IN_TEMPLATE_DEFINITIONS } from "./catalog";
import {
  DocumentTemplateIntegrityError,
  assertDocumentTemplateVersionMutable,
} from "./domain";
import {
  calculateLayoutManifestChecksum,
  documentTemplateLayoutManifestSchema,
} from "./manifest";
import {
  listAvailableBuiltInDocumentTemplates,
  resolveBuiltInDocumentTemplate,
  resolveExactPublishedBuiltInTemplateVersion,
} from "./service";

function stableFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function issuedState() {
  const documents = await db.document.findMany({
    where: { status: "ISSUED" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      workspaceId: true,
      documentNumber: true,
      status: true,
      issuedAt: true,
      snapshot: { select: { id: true, snapshotVersion: true, payload: true, createdAt: true } },
    },
  });
  return { documents, fingerprint: stableFingerprint(documents) };
}

test("built-in templates bootstrap idempotently and preserve ISSUE Phase 1 state", async () => {
  const beforeIssued = await issuedState();
  const beforeCapacity = await db.documentCapacityConsumption.count();
  const beforeCredits = await db.documentCreditTransaction.count();
  const beforeFiles = await db.documentFile.count();

  for (const document of beforeIssued.documents) {
    assert.ok(document.snapshot);
    assert.equal(document.snapshot.snapshotVersion, 1);
    issuedDocumentSnapshotSchema.parse(document.snapshot.payload);
  }

  const first = await bootstrapBuiltInDocumentTemplates();
  assert.ok(first.createdTemplates >= 0 && first.createdTemplates <= 3);
  const initialRows = await db.documentTemplate.findMany({
    where: { code: { in: BUILT_IN_TEMPLATE_DEFINITIONS.map(({ code }) => code) } },
    include: { versions: { orderBy: { version: "asc" } } },
    orderBy: { code: "asc" },
  });
  assert.equal(initialRows.length, 3);
  assert.deepEqual(initialRows.map(({ code }) => code), ["CIV_COMPACT", "CIV_MODERN", "CIV_STANDARD"]);
  for (const template of initialRows) {
    assert.equal(template.workspaceId, null);
    assert.equal(template.kind, "BUILT_IN");
    assert.equal(template.state, "ACTIVE");
    assert.equal(template.versions.length, 1);
    assert.equal(template.versions[0]?.version, 1);
    assert.equal(template.versions[0]?.state, "PUBLISHED");
  }

  const rowFingerprint = stableFingerprint(initialRows);
  const second = await bootstrapBuiltInDocumentTemplates();
  assert.equal(second.createdTemplates, 0);
  const repeatedRows = await db.documentTemplate.findMany({
    where: { code: { in: BUILT_IN_TEMPLATE_DEFINITIONS.map(({ code }) => code) } },
    include: { versions: { orderBy: { version: "asc" } } },
    orderBy: { code: "asc" },
  });
  assert.equal(stableFingerprint(repeatedRows), rowFingerprint);

  const listed = await listAvailableBuiltInDocumentTemplates();
  assert.equal(listed.length, 3);
  for (const definition of BUILT_IN_TEMPLATE_DEFINITIONS) {
    const template = await resolveBuiltInDocumentTemplate(definition.code);
    assert.equal(template?.code, definition.code);
    assert.equal(template?.versions[0]?.layoutChecksum, definition.checksum);
    const exact = await resolveExactPublishedBuiltInTemplateVersion({
      code: definition.code,
      version: 1,
    });
    assert.equal(exact?.layoutChecksum, definition.checksum);
  }
  assert.equal(
    await resolveExactPublishedBuiltInTemplateVersion({ code: "CIV_STANDARD", version: 2 }),
    null,
  );

  assert.doesNotThrow(() => assertDocumentTemplateVersionMutable("DRAFT"));
  assert.throws(
    () => assertDocumentTemplateVersionMutable("PUBLISHED"),
    DocumentTemplateIntegrityError,
  );
  assert.throws(
    () => assertDocumentTemplateVersionMutable("ARCHIVED"),
    DocumentTemplateIntegrityError,
  );

  const afterIssued = await issuedState();
  assert.equal(afterIssued.fingerprint, beforeIssued.fingerprint);
  assert.equal(await db.documentCapacityConsumption.count(), beforeCapacity);
  assert.equal(await db.documentCreditTransaction.count(), beforeCredits);
  assert.equal(await db.documentFile.count(), beforeFiles);
});

test("layout manifests are strict, bounded, non-executable, and checksummed canonically", () => {
  const source = BUILT_IN_TEMPLATE_DEFINITIONS[0]!.manifest;
  assert.doesNotThrow(() => documentTemplateLayoutManifestSchema.parse(source));
  assert.equal(new Set(BUILT_IN_TEMPLATE_DEFINITIONS.map(({ checksum }) => checksum)).size, 3);
  assert.equal(calculateLayoutManifestChecksum(source), calculateLayoutManifestChecksum(structuredClone(source)));

  const reordered = {
    lineTable: source.lineTable,
    fields: source.fields,
    page: source.page,
    manifestVersion: source.manifestVersion,
  };
  assert.equal(calculateLayoutManifestChecksum(source), calculateLayoutManifestChecksum(reordered));

  const changed = structuredClone(source);
  changed.fields[0]!.box.x += 1;
  assert.notEqual(calculateLayoutManifestChecksum(source), calculateLayoutManifestChecksum(changed));

  const unknownTopLevel = { ...structuredClone(source), html: "<script>alert(1)</script>" };
  assert.throws(() => documentTemplateLayoutManifestSchema.parse(unknownTopLevel));

  const outOfBounds = structuredClone(source) as unknown as Record<string, unknown>;
  const fields = outOfBounds.fields as Array<{ box: { x: number } }>;
  fields[0]!.box.x = 10_001;
  assert.throws(() => documentTemplateLayoutManifestSchema.parse(outOfBounds));

  const arbitraryField = structuredClone(source) as unknown as Record<string, unknown>;
  const arbitraryFields = arbitraryField.fields as Array<{ field: string }>;
  arbitraryFields[0]!.field = "customer.secretExpression";
  assert.throws(() => documentTemplateLayoutManifestSchema.parse(arbitraryField));

  const executable = structuredClone(source) as unknown as Record<string, unknown>;
  const executableFields = executable.fields as Array<Record<string, unknown>>;
  executableFields[0]!.remoteUrl = "https://example.invalid/malicious.js";
  executableFields[0]!.expression = "process.exit()";
  assert.throws(() => documentTemplateLayoutManifestSchema.parse(executable));
});

test("bootstrap refuses non-development execution before making a database change", async () => {
  const originalEnvironment = process.env.APP_ENV;
  process.env.APP_ENV = "production";
  try {
    await assert.rejects(
      bootstrapBuiltInDocumentTemplates(),
      /restricted to APP_ENV=development/,
    );
  } finally {
    process.env.APP_ENV = originalEnvironment;
  }
});
