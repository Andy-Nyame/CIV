import "server-only";

import { db } from "@/lib/db";

import { DocumentTemplateIntegrityError, assertStoredManifestIntegrity } from "./domain";
import { builtInTemplateCodeSchema, type BuiltInTemplateCode } from "./manifest";

const publishedBuiltInSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  kind: true,
  state: true,
  versions: {
    where: { state: "PUBLISHED" as const },
    orderBy: { version: "desc" as const },
    select: {
      id: true,
      version: true,
      state: true,
      layoutSchemaVersion: true,
      pageSize: true,
      layoutManifest: true,
      layoutChecksum: true,
      rendererCompatibilityVersion: true,
      createdAt: true,
    },
  },
} as const;

function verifyTemplate<T extends { kind: string; state: string; versions: Array<{ layoutManifest: unknown; layoutChecksum: string }> }>(template: T) {
  if (template.kind !== "BUILT_IN" || template.state !== "ACTIVE") {
    throw new DocumentTemplateIntegrityError();
  }
  for (const version of template.versions) {
    assertStoredManifestIntegrity(version.layoutManifest, version.layoutChecksum);
  }
  return template;
}

export async function listAvailableBuiltInDocumentTemplates() {
  const templates = await db.documentTemplate.findMany({
    where: { workspaceId: null, kind: "BUILT_IN", state: "ACTIVE" },
    orderBy: { code: "asc" },
    select: publishedBuiltInSelect,
  });
  return templates.filter((template) => template.versions.length > 0).map(verifyTemplate);
}

export async function resolveBuiltInDocumentTemplate(code: BuiltInTemplateCode | string) {
  const safeCode = builtInTemplateCodeSchema.parse(code);
  const template = await db.documentTemplate.findFirst({
    where: { workspaceId: null, code: safeCode, kind: "BUILT_IN", state: "ACTIVE" },
    select: publishedBuiltInSelect,
  });
  if (!template || template.versions.length === 0) return null;
  return verifyTemplate(template);
}

export async function resolveExactPublishedBuiltInTemplateVersion(input: {
  code: BuiltInTemplateCode | string;
  version: number;
}) {
  const safeCode = builtInTemplateCodeSchema.parse(input.code);
  if (!Number.isInteger(input.version) || input.version < 1) return null;
  const version = await db.documentTemplateVersion.findFirst({
    where: {
      version: input.version,
      state: "PUBLISHED",
      template: { workspaceId: null, code: safeCode, kind: "BUILT_IN", state: "ACTIVE" },
    },
    select: {
      id: true,
      version: true,
      state: true,
      layoutSchemaVersion: true,
      pageSize: true,
      layoutManifest: true,
      layoutChecksum: true,
      rendererCompatibilityVersion: true,
      createdAt: true,
      template: { select: { id: true, code: true, name: true, description: true } },
    },
  });
  if (!version) return null;
  assertStoredManifestIntegrity(version.layoutManifest, version.layoutChecksum);
  return version;
}
