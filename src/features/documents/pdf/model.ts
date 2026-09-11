import type { IssuedDocumentSnapshot } from "@/features/documents/snapshots";
import {
  buildAppliedRateRows,
  buildSnapshotAppliedRateRows,
  formatAppliedRateLabel,
  type AppliedRateRow,
} from "@/features/documents/applied-rates";

export type PdfDocumentType = "INVOICE" | "RECEIPT" | "VAT_INVOICE";

export type PdfLogoReference = NonNullable<IssuedDocumentSnapshot["issuer"]["logo"]>;

export type DocumentPdfModel = {
  lifecycle: "DRAFT" | "ISSUED";
  title: "Invoice" | "Receipt" | "VAT Invoice";
  number: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  issuedAt: string | null;
  isTestDocument: boolean;
  logo: PdfLogoReference | null;
  issuer: {
    legalName: string;
    tradingName: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    registrationNumber: string | null;
    taxpayerIdLabel: "Ghana Card PIN" | "GRA TIN" | null;
    taxpayerId: string | null;
    taxpayerVerificationStatus: "UNVERIFIED" | "VERIFIED" | null;
    vatRegistered: boolean | null;
  };
  customer: {
    name: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    taxpayerId: string | null;
  } | null;
  lines: Array<{
    order: number;
    description: string;
    quantity: string;
    unitPrice: string;
    rateLabel: string | null;
    rateAmount: string | null;
    total: string;
  }>;
  tax: {
    profileName: string;
    versionCode: string;
    components: Array<{ code: string; name: string; rate: string; amount: string }>;
  } | null;
  appliedRates: AppliedRateRow[];
  totals: IssuedDocumentSnapshot["totals"];
  notes: string | null;
  preparedBy: string;
  verificationCode: string | null;
};

export type IssuedDocumentPdfModel = DocumentPdfModel;

const titles: Record<PdfDocumentType, IssuedDocumentPdfModel["title"]> = {
  INVOICE: "Invoice",
  RECEIPT: "Receipt",
  VAT_INVOICE: "VAT Invoice",
};

export function buildIssuedDocumentPdfModel(
  snapshot: IssuedDocumentSnapshot,
  persistedIsTestDocument: boolean,
): IssuedDocumentPdfModel {
  const taxpayerId = snapshot.issuer.taxpayerId ?? snapshot.issuer.businessTin;
  const taxpayerIdLabel = taxpayerId
    ? snapshot.issuer.taxpayerIdType === "GHANA_CARD_PIN" || snapshot.issuer.issuerType === "INDIVIDUAL"
      ? "Ghana Card PIN"
      : "GRA TIN"
    : null;

  return {
    lifecycle: "ISSUED",
    title: titles[snapshot.document.type],
    number: snapshot.document.documentNumber,
    currency: snapshot.document.currency,
    issueDate: snapshot.document.issueDate,
    dueDate: snapshot.document.dueDate,
    issuedAt: snapshot.document.issuedAt,
    // Either persisted flag is sufficient to retain the safety marking. A caller
    // cannot downgrade a TEST snapshot by changing request parameters or UI state.
    isTestDocument: persistedIsTestDocument || snapshot.document.isTestDocument,
    logo: snapshot.issuer.logo,
    issuer: {
      legalName: snapshot.issuer.legalName ?? snapshot.issuer.displayName,
      tradingName: snapshot.issuer.tradingName,
      address: snapshot.issuer.address,
      email: snapshot.issuer.email,
      phone: snapshot.issuer.phone,
      registrationNumber: snapshot.issuer.registrationNumber,
      taxpayerIdLabel,
      taxpayerId,
      taxpayerVerificationStatus: snapshot.issuer.taxpayerVerificationStatus,
      vatRegistered: snapshot.issuer.vatRegistered,
    },
    customer: snapshot.customer ? {
      name: snapshot.customer.name,
      address: snapshot.customer.address,
      email: snapshot.customer.email,
      phone: snapshot.customer.phone,
      taxpayerId: snapshot.customer.businessTin,
    } : null,
    lines: snapshot.lines.map((line) => ({
      order: line.order,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      rateLabel: line.customRate ? formatAppliedRateLabel({ ...line.customRate, currency: snapshot.document.currency }) : null,
      rateAmount: line.customRate?.amount ?? null,
      total: line.total,
    })),
    tax: snapshot.tax ? {
      profileName: snapshot.tax.profile.name,
      versionCode: snapshot.tax.version.code,
      components: snapshot.tax.components.map((component) => ({
        code: component.code,
        name: component.name,
        rate: component.rate,
        amount: component.amount,
      })),
    } : null,
    appliedRates: buildSnapshotAppliedRateRows(snapshot),
    totals: snapshot.totals,
    notes: snapshot.document.notes,
    preparedBy: snapshot.issuedBy.displayName,
    verificationCode: snapshot.verification?.code ?? null,
  };
}

export function buildDraftDocumentPdfModel(input: {
  document: {
    draftReference: string;
    type: PdfDocumentType;
    currency: string;
    draftDate: string;
    dueDate: string | null;
    notes: string | null;
    isTestDocument: boolean;
  };
  issuer: IssuedDocumentSnapshot["issuer"];
  customer: IssuedDocumentSnapshot["customer"];
  lines: IssuedDocumentSnapshot["lines"];
  tax: IssuedDocumentSnapshot["tax"];
  totals: IssuedDocumentSnapshot["totals"];
  preparedBy: string;
}): DocumentPdfModel {
  const taxpayerId = input.issuer.taxpayerId ?? input.issuer.businessTin;
  const taxpayerIdLabel = taxpayerId
    ? input.issuer.taxpayerIdType === "GHANA_CARD_PIN" || input.issuer.issuerType === "INDIVIDUAL"
      ? "Ghana Card PIN"
      : "GRA TIN"
    : null;
  const customRates = input.lines.flatMap((line) => line.customRate ? [{
    key: `line:${line.order}`,
    name: line.customRate.name,
    type: line.customRate.type,
    value: line.customRate.value,
    amount: line.customRate.amount,
  }] : []);

  return {
    lifecycle: "DRAFT",
    title: titles[input.document.type],
    number: input.document.draftReference,
    currency: input.document.currency,
    issueDate: input.document.draftDate,
    dueDate: input.document.dueDate,
    issuedAt: null,
    isTestDocument: input.document.isTestDocument,
    logo: input.issuer.logo,
    issuer: {
      legalName: input.issuer.legalName ?? input.issuer.displayName,
      tradingName: input.issuer.tradingName,
      address: input.issuer.address,
      email: input.issuer.email,
      phone: input.issuer.phone,
      registrationNumber: input.issuer.registrationNumber,
      taxpayerIdLabel,
      taxpayerId,
      taxpayerVerificationStatus: input.issuer.taxpayerVerificationStatus,
      vatRegistered: input.issuer.vatRegistered,
    },
    customer: input.customer ? {
      name: input.customer.name,
      address: input.customer.address,
      email: input.customer.email,
      phone: input.customer.phone,
      taxpayerId: input.customer.businessTin,
    } : null,
    lines: input.lines.map((line) => ({
      order: line.order,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      rateLabel: line.customRate ? formatAppliedRateLabel({ ...line.customRate, currency: input.document.currency }) : null,
      rateAmount: line.customRate?.amount ?? null,
      total: line.total,
    })),
    tax: input.tax ? {
      profileName: input.tax.profile.name,
      versionCode: input.tax.version.code,
      components: input.tax.components.map((component) => ({
        code: component.code,
        name: component.name,
        rate: component.rate,
        amount: component.amount,
      })),
    } : null,
    appliedRates: buildAppliedRateRows({
      currency: input.document.currency,
      customRates,
      statutoryRates: input.tax?.components.map((component) => ({
        key: `tax:${component.code}`,
        code: component.code,
        name: component.name,
        rate: component.rate,
        amount: component.amount,
      })),
    }),
    totals: input.totals,
    notes: input.document.notes,
    preparedBy: input.preparedBy,
    verificationCode: null,
  };
}

export function buildDocumentPdfFilename(model: DocumentPdfModel) {
  const type = model.title.toUpperCase().replaceAll(" ", "-");
  const number = model.number
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "DOCUMENT";
  return `CIV-${model.isTestDocument ? "TEST-" : ""}${model.lifecycle === "DRAFT" ? "DRAFT-" : ""}${type}-${number}.pdf`;
}
