import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";

import { CAPABILITIES, getDocumentAccessFilter } from "@/features/authorization/capabilities";
import { authorizeWorkspaceById } from "@/features/authorization/context";
import {
  buildCustomerSnapshot,
  buildIssuerSnapshot,
  buildLineSnapshots,
  documentTaxSnapshotSchema,
  issuedDocumentSnapshotSchema,
} from "@/features/documents/snapshots";
import { documentIdSchema } from "@/features/documents/validation";
import { db } from "@/lib/db";
import { getObject } from "@/lib/storage/object-storage";

import {
  buildDocumentPdfFilename,
  buildDraftDocumentPdfModel,
  buildIssuedDocumentPdfModel,
  type PdfLogoReference,
} from "./model";
import { renderDocumentPdf } from "./render";

export class DocumentPdfUnavailableError extends Error {
  constructor(readonly reason: "NOT_FOUND" | "SNAPSHOT_UNAVAILABLE" | "DRAFT_DATA_UNAVAILABLE") {
    const messages = {
      NOT_FOUND: "Document PDF not found.",
      SNAPSHOT_UNAVAILABLE: "The issued document snapshot is unavailable.",
      DRAFT_DATA_UNAVAILABLE: "The saved draft data is unavailable.",
    } as const;
    super(messages[reason]);
    this.name = "DocumentPdfUnavailableError";
  }
}

type PdfInput = {
  actorUserId: string;
  workspaceId: string;
  documentId: unknown;
};

type PrivateObjectLoader = typeof getObject;

export async function loadPdfLogoImage(
  reference: PdfLogoReference | null,
  objectLoader: PrivateObjectLoader = getObject,
) {
  if (!reference) return null;
  try {
    const stored = await objectLoader(reference.storageKey);
    const checksum = createHash("sha256").update(stored.body).digest("hex");
    if (checksum !== reference.checksum) return null;
    const png = await sharp(stored.body, { failOn: "error" })
      .rotate()
      .png({ compressionLevel: 9 })
      .toBuffer();
    return new Uint8Array(png);
  } catch {
    // A missing, stale, or malformed private logo must never block the document.
    return null;
  }
}

export async function loadDocumentPdfSource(input: PdfInput) {
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
      status: { in: ["DRAFT", "ISSUED"] },
      archivedAt: null,
    },
    include: {
      snapshot: true,
      workspace: { include: { logo: true } },
      customer: true,
      createdBy: { select: { name: true, email: true } },
      lines: { orderBy: { lineOrder: "asc" } },
    },
  }) : null;

  if (!document) throw new DocumentPdfUnavailableError("NOT_FOUND");

  if (document.status === "ISSUED") {
    if (!document.snapshot) throw new DocumentPdfUnavailableError("SNAPSHOT_UNAVAILABLE");
    const parsedSnapshot = issuedDocumentSnapshotSchema.safeParse(document.snapshot.payload);
    if (!parsedSnapshot.success) throw new DocumentPdfUnavailableError("SNAPSHOT_UNAVAILABLE");
    if (
      parsedSnapshot.data.document.id !== document.id ||
      parsedSnapshot.data.issuer.workspaceId !== input.workspaceId
    ) {
      throw new DocumentPdfUnavailableError("SNAPSHOT_UNAVAILABLE");
    }

    // Mutable workspace, customer, line, and tax records loaded alongside the
    // row are deliberately ignored here. The immutable snapshot is the sole
    // issued-document source.
    const model = buildIssuedDocumentPdfModel(parsedSnapshot.data, document.isTestDocument);
    return {
      lifecycle: "ISSUED" as const,
      documentId: document.id,
      snapshotVersion: document.snapshot.snapshotVersion,
      snapshot: parsedSnapshot.data,
      model,
      filename: buildDocumentPdfFilename(model),
    };
  }

  if (!["INVOICE", "RECEIPT", "VAT_INVOICE"].includes(document.type)) {
    throw new DocumentPdfUnavailableError("DRAFT_DATA_UNAVAILABLE");
  }
  const documentType = document.type as "INVOICE" | "RECEIPT" | "VAT_INVOICE";

  const parsedTax = documentType === "VAT_INVOICE"
    ? documentTaxSnapshotSchema.safeParse(document.taxCalculation)
    : { success: true as const, data: null };
  if (!parsedTax.success) throw new DocumentPdfUnavailableError("DRAFT_DATA_UNAVAILABLE");

  const model = buildDraftDocumentPdfModel({
    document: {
      draftReference: document.draftReference,
      type: documentType,
      currency: document.currency,
      draftDate: document.draftDate.toISOString().slice(0, 10),
      dueDate: document.dueDate?.toISOString().slice(0, 10) ?? null,
      notes: document.notes,
      isTestDocument: document.isTestDocument,
    },
    issuer: buildIssuerSnapshot(document.workspace),
    customer: buildCustomerSnapshot(document),
    lines: buildLineSnapshots(document.lines),
    tax: parsedTax.data,
    totals: {
      subtotal: document.subtotal.toFixed(2),
      discount: document.discountTotal.toFixed(2),
      customRates: documentType === "VAT_INVOICE" ? "0.00" : document.rateTotal.toFixed(2),
      taxableValue: document.taxableValue.toFixed(2),
      trustedTax: document.taxTotal.toFixed(2),
      grandTotal: document.grandTotal.toFixed(2),
    },
    preparedBy: document.createdBy.name?.trim() || document.createdBy.email || "Workspace member",
  });
  return {
    lifecycle: "DRAFT" as const,
    documentId: document.id,
    snapshotVersion: null,
    snapshot: null,
    model,
    filename: buildDocumentPdfFilename(model),
  };
}

export async function loadIssuedDocumentPdfSource(input: PdfInput) {
  const source = await loadDocumentPdfSource(input);
  if (source.lifecycle !== "ISSUED") throw new DocumentPdfUnavailableError("NOT_FOUND");
  return source;
}

export async function loadDraftDocumentPdfSource(input: PdfInput) {
  const source = await loadDocumentPdfSource(input);
  if (source.lifecycle !== "DRAFT") throw new DocumentPdfUnavailableError("NOT_FOUND");
  return source;
}

async function renderPdfSource(source: Awaited<ReturnType<typeof loadDocumentPdfSource>>) {
  const logoImage = await loadPdfLogoImage(source.model.logo);
  return {
    ...source,
    bytes: await renderDocumentPdf(source.model, { logoImage }),
  };
}

export async function generateDocumentPdf(input: PdfInput) {
  return renderPdfSource(await loadDocumentPdfSource(input));
}

export async function generateIssuedDocumentPdf(input: PdfInput) {
  return renderPdfSource(await loadIssuedDocumentPdfSource(input));
}

export async function generateDraftDocumentPdf(input: PdfInput) {
  return renderPdfSource(await loadDraftDocumentPdfSource(input));
}
