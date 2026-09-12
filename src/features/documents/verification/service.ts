import "server-only";

import { issuedDocumentSnapshotSchema, type IssuedDocumentSnapshot } from "@/features/documents/snapshots";
import { publicFiscalizationLabel } from "@/features/documents/compliance";
import { db } from "@/lib/db";

import { normalizeVerificationCode } from "./code";

export type PublicVerificationResult =
  | { status: "NOT_FOUND" }
  | {
      status: "VALID" | "TEST" | "VOID";
      isTestDocument: boolean;
      verificationCode: string;
      documentType: "Invoice" | "Receipt" | "VAT Invoice" | "Credit Note" | "Debit Note";
      documentNumber: string;
      issuerName: string;
      issueDate: string;
      currency: string;
      grandTotal: string;
      fiscalizationStatus: "GRA Certified" | "GRA Fiscalization Required" | "Not a GRA tax document" | "GRA fiscalization not recorded";
    };

const documentTypeLabels = {
  INVOICE: "Invoice",
  RECEIPT: "Receipt",
  VAT_INVOICE: "VAT Invoice",
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
} as const;

export function mapPublicVerificationResult(input: {
  status: "ISSUED" | "VOIDED";
  verificationCode: string;
  isTestDocument: boolean;
  snapshot: IssuedDocumentSnapshot;
}): PublicVerificationResult {
  const snapshotCode = input.snapshot.verification?.code;
  if (!snapshotCode || snapshotCode !== input.verificationCode) return { status: "NOT_FOUND" };
  const isTestDocument = input.isTestDocument || input.snapshot.document.isTestDocument;
  return {
    status: input.status === "VOIDED" ? "VOID" : isTestDocument ? "TEST" : "VALID",
    isTestDocument,
    verificationCode: snapshotCode,
    documentType: documentTypeLabels[input.snapshot.document.type],
    documentNumber: input.snapshot.document.documentNumber,
    issuerName: input.snapshot.issuer.legalName ?? input.snapshot.issuer.displayName,
    issueDate: input.snapshot.document.issueDate,
    currency: input.snapshot.document.currency,
    grandTotal: input.snapshot.totals.grandTotal,
    fiscalizationStatus: publicFiscalizationLabel({
      status: input.snapshot.document.fiscalization?.status ?? "NOT_RECORDED",
      fiscalDocumentId: input.snapshot.document.fiscalization?.fiscalDocumentId,
      timestamp: input.snapshot.document.fiscalization?.timestamp,
      providerReference: input.snapshot.document.fiscalization?.providerReference,
    }),
  };
}

export async function lookupPublicDocumentVerification(input: unknown) {
  const verificationCode = normalizeVerificationCode(input);
  if (!verificationCode) return { status: "NOT_FOUND" } as const;

  const document = await db.document.findUnique({
    where: { verificationCode },
    select: {
      id: true,
      verificationCode: true,
      status: true,
      isTestDocument: true,
      snapshot: { select: { payload: true } },
    },
  });
  if (!document?.verificationCode || !document.snapshot) return { status: "NOT_FOUND" } as const;
  if (document.status !== "ISSUED" && document.status !== "VOIDED") return { status: "NOT_FOUND" } as const;

  const snapshot = issuedDocumentSnapshotSchema.safeParse(document.snapshot.payload);
  if (!snapshot.success) return { status: "NOT_FOUND" } as const;
  if (snapshot.data.document.id !== document.id) return { status: "NOT_FOUND" } as const;
  return mapPublicVerificationResult({
    status: document.status,
    verificationCode: document.verificationCode,
    isTestDocument: document.isTestDocument,
    snapshot: snapshot.data,
  });
}
