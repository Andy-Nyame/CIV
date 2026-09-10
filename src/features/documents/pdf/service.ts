import "server-only";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { authorizeWorkspaceById } from "@/features/authorization/context";
import { issuedDocumentSnapshotSchema } from "@/features/documents/snapshots";
import { documentIdSchema } from "@/features/documents/validation";
import { db } from "@/lib/db";

import { buildDocumentPdfFilename, buildIssuedDocumentPdfModel } from "./model";
import { renderIssuedDocumentPdf } from "./render";

export class DocumentPdfUnavailableError extends Error {
  constructor(readonly reason: "NOT_FOUND" | "SNAPSHOT_UNAVAILABLE") {
    super(reason === "NOT_FOUND" ? "Document PDF not found." : "The issued document snapshot is unavailable.");
    this.name = "DocumentPdfUnavailableError";
  }
}

export async function loadIssuedDocumentPdfSource(input: {
  actorUserId: string;
  workspaceId: string;
  documentId: unknown;
}) {
  const parsedId = documentIdSchema.safeParse(input.documentId);
  if (!parsedId.success) throw new DocumentPdfUnavailableError("NOT_FOUND");

  const authorization = await authorizeWorkspaceById(
    input.actorUserId,
    input.workspaceId,
    CAPABILITIES.VIEW_OWN_DOCUMENTS,
  );
  const access = getDocumentAccessFilter({
    role: authorization.membership.role,
    userId: input.actorUserId,
    workspaceId: input.workspaceId,
  });
  const document = access ? await db.document.findFirst({
    where: {
      id: parsedId.data,
      ...access,
      status: "ISSUED",
      archivedAt: null,
    },
    select: {
      id: true,
      isTestDocument: true,
      snapshot: { select: { snapshotVersion: true, payload: true } },
    },
  }) : null;

  if (!document) throw new DocumentPdfUnavailableError("NOT_FOUND");
  if (!document.snapshot) throw new DocumentPdfUnavailableError("SNAPSHOT_UNAVAILABLE");

  const parsedSnapshot = issuedDocumentSnapshotSchema.safeParse(document.snapshot.payload);
  if (!parsedSnapshot.success) throw new DocumentPdfUnavailableError("SNAPSHOT_UNAVAILABLE");
  if (
    parsedSnapshot.data.document.id !== document.id ||
    parsedSnapshot.data.issuer.workspaceId !== input.workspaceId
  ) {
    throw new DocumentPdfUnavailableError("SNAPSHOT_UNAVAILABLE");
  }

  const model = buildIssuedDocumentPdfModel(parsedSnapshot.data, document.isTestDocument);
  return {
    documentId: document.id,
    snapshotVersion: document.snapshot.snapshotVersion,
    snapshot: parsedSnapshot.data,
    model,
    filename: buildDocumentPdfFilename(model),
  } as const;
}

export async function generateIssuedDocumentPdf(input: Parameters<typeof loadIssuedDocumentPdfSource>[0]) {
  const source = await loadIssuedDocumentPdfSource(input);
  return {
    ...source,
    bytes: await renderIssuedDocumentPdf(source.model),
  } as const;
}
