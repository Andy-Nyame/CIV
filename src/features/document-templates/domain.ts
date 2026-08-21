import "server-only";

import type { DocumentTemplateVersionState } from "@/generated/prisma/enums";

import { calculateLayoutManifestChecksum } from "./manifest";

export class DocumentTemplateIntegrityError extends Error {
  constructor(message = "The document template configuration conflicts with CIV's published definition.") {
    super(message);
    this.name = "DocumentTemplateIntegrityError";
  }
}

export function assertDocumentTemplateVersionMutable(state: DocumentTemplateVersionState) {
  if (state !== "DRAFT") {
    throw new DocumentTemplateIntegrityError(
      "Published or archived document template versions are immutable; create a new version instead.",
    );
  }
}

export function assertStoredManifestIntegrity(manifest: unknown, expectedChecksum: string) {
  const actualChecksum = calculateLayoutManifestChecksum(manifest);
  if (actualChecksum !== expectedChecksum) {
    throw new DocumentTemplateIntegrityError();
  }
}
