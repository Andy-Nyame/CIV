import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { BUILT_IN_TEMPLATE_DEFINITIONS } from "./catalog";
import { DocumentTemplateIntegrityError, assertStoredManifestIntegrity } from "./domain";

function assertMatchingPublishedDefinition(
  stored: {
    workspaceId: string | null;
    name: string;
    description: string;
    kind: string;
    state: string;
    versions: Array<{
      version: number;
      state: string;
      layoutSchemaVersion: number;
      pageSize: string;
      layoutManifest: unknown;
      layoutChecksum: string;
      rendererCompatibilityVersion: number;
    }>;
  },
  expected: (typeof BUILT_IN_TEMPLATE_DEFINITIONS)[number],
) {
  const version = stored.versions.find((item) => item.version === expected.version);
  if (
    stored.workspaceId !== null ||
    stored.name !== expected.name ||
    stored.description !== expected.description ||
    stored.kind !== "BUILT_IN" ||
    stored.state !== "ACTIVE" ||
    !version ||
    version.state !== "PUBLISHED" ||
    version.layoutSchemaVersion !== expected.layoutSchemaVersion ||
    version.pageSize !== "A4" ||
    version.layoutChecksum !== expected.checksum ||
    version.rendererCompatibilityVersion !== expected.rendererCompatibilityVersion
  ) {
    throw new DocumentTemplateIntegrityError();
  }
  assertStoredManifestIntegrity(version.layoutManifest, expected.checksum);
}

export async function bootstrapBuiltInDocumentTemplates() {
  if (process.env.APP_ENV !== "development") {
    throw new Error("Built-in document template bootstrap is restricted to APP_ENV=development.");
  }

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext('civ-built-in-document-templates-v1'))::text AS lock
    `;

    let createdTemplates = 0;
    for (const definition of BUILT_IN_TEMPLATE_DEFINITIONS) {
      let template = await transaction.documentTemplate.findUnique({
        where: { code: definition.code },
        include: { versions: { orderBy: { version: "asc" } } },
      });
      if (!template) {
        template = await transaction.documentTemplate.create({
          data: {
            workspaceId: null,
            code: definition.code,
            name: definition.name,
            description: definition.description,
            kind: "BUILT_IN",
            state: "ACTIVE",
            versions: {
              create: {
                version: definition.version,
                state: "PUBLISHED",
                layoutSchemaVersion: definition.layoutSchemaVersion,
                pageSize: "A4",
                layoutManifest: definition.manifest as Prisma.InputJsonValue,
                layoutChecksum: definition.checksum,
                rendererCompatibilityVersion: definition.rendererCompatibilityVersion,
              },
            },
          },
          include: { versions: { orderBy: { version: "asc" } } },
        });
        createdTemplates += 1;
      }
      assertMatchingPublishedDefinition(template, definition);
    }

    return { createdTemplates, templateCount: BUILT_IN_TEMPLATE_DEFINITIONS.length };
  });
}
