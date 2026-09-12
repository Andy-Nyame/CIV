import type { IssuedDocumentSnapshot } from "@/features/documents/snapshots";
import {
  buildAppliedRateRows,
  buildSnapshotAppliedRateRows,
  formatAppliedRateLabel,
  type AppliedRateRow,
} from "@/features/documents/applied-rates";
import { publicFiscalizationLabel } from "@/features/documents/compliance";

export type PdfDocumentType = "INVOICE" | "RECEIPT" | "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";

export type PdfLogoReference = NonNullable<IssuedDocumentSnapshot["issuer"]["logo"]>;

export type DocumentPdfModel = {
  lifecycle: "DRAFT" | "ISSUED";
  title: "Invoice" | "Receipt" | "VAT Invoice" | "Credit Note" | "Debit Note";
  number: string;
  currency: string;
  issueDate: string;
  supplyDate: string | null;
  taxPointDate: string | null;
  supplyDateTime: string | null;
  taxPointDateTime: string | null;
  dueDate: string | null;
  issuedAt: string | null;
  isTestDocument: boolean;
  isVoided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  logo: PdfLogoReference | null;
  transactionType: "SALE" | "SERVICE" | "HIRE_OR_LEASE" | "EXCHANGE" | "OTHER";
  receiptType: "COMMERCIAL" | "VAT_SALES_RECEIPT";
  servicePeriod: { start: string; end: string } | null;
  fiscalizationLabel: "GRA Certified" | "GRA Fiscalization Required" | "Not a GRA tax document" | "GRA fiscalization not recorded";
  priceMode: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE";
  adjustment: IssuedDocumentSnapshot["document"]["adjustment"];
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
    vatRegistrationStatus: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED" | null;
  };
  customer: {
    name: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    taxpayerId: string | null;
    taxpayerIdLabel: "Ghana Card PIN" | "GRA TIN" | null;
    vatRegistrationStatus: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED" | null;
    taxStatus: "ORDINARY_CONSUMER" | "TAXABLE_PERSON";
  } | null;
  lines: Array<{
    order: number;
    description: string;
    quantity: string;
    unitPrice: string;
    unitOfMeasure: string | null;
    originalAmount: string;
    discount: string;
    taxTreatment: "STANDARD_RATED" | "ZERO_RATED" | "EXEMPT";
    taxTreatmentReason: string | null;
    taxTreatmentReference: string | null;
    relief: { reason: string; reference: string } | null;
    taxableBase: string;
    taxAmount: string;
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
  payments: IssuedDocumentSnapshot["payments"];
  preparedBy: string;
  verificationCode: string | null;
};

export type IssuedDocumentPdfModel = DocumentPdfModel;

const titles: Record<PdfDocumentType, IssuedDocumentPdfModel["title"]> = {
  INVOICE: "Invoice",
  RECEIPT: "Receipt",
  VAT_INVOICE: "VAT Invoice",
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
};

export function buildIssuedDocumentPdfModel(
  snapshot: IssuedDocumentSnapshot,
  persistedIsTestDocument: boolean,
  lifecycle: { isVoided?: boolean; voidReason?: string | null; voidedAt?: Date | string | null } = {},
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
    supplyDate: snapshot.document.supplyDate,
    taxPointDate: snapshot.document.taxPointDate,
    supplyDateTime: snapshot.document.supplyDateTime,
    taxPointDateTime: snapshot.document.taxPointDateTime,
    dueDate: snapshot.document.dueDate,
    issuedAt: snapshot.document.issuedAt,
    // Either persisted flag is sufficient to retain the safety marking. A caller
    // cannot downgrade a TEST snapshot by changing request parameters or UI state.
    isTestDocument: persistedIsTestDocument || snapshot.document.isTestDocument,
    isVoided: lifecycle.isVoided ?? false,
    voidReason: lifecycle.voidReason ?? null,
    voidedAt: lifecycle.voidedAt instanceof Date ? lifecycle.voidedAt.toISOString() : lifecycle.voidedAt ?? null,
    logo: snapshot.issuer.logo,
    transactionType: snapshot.document.transactionType,
    receiptType: snapshot.document.receiptType,
    servicePeriod: snapshot.document.servicePeriod,
    fiscalizationLabel: publicFiscalizationLabel({
      status: snapshot.document.fiscalization?.status ?? "NOT_RECORDED",
      fiscalDocumentId: snapshot.document.fiscalization?.fiscalDocumentId,
      timestamp: snapshot.document.fiscalization?.timestamp,
      providerReference: snapshot.document.fiscalization?.providerReference,
    }),
    priceMode: snapshot.document.priceMode,
    adjustment: snapshot.document.adjustment,
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
      vatRegistrationStatus: snapshot.issuer.vatRegistrationStatus,
    },
    customer: snapshot.customer ? {
      name: snapshot.customer.name,
      address: snapshot.customer.address,
      email: snapshot.customer.email,
      phone: snapshot.customer.phone,
      taxpayerId: snapshot.customer.taxpayerId ?? snapshot.customer.businessTin,
      taxpayerIdLabel: snapshot.customer.taxpayerIdType === "GHANA_CARD_PIN" ? "Ghana Card PIN" : snapshot.customer.taxpayerIdType === "GRA_TIN" || snapshot.customer.taxpayerId || snapshot.customer.businessTin ? "GRA TIN" : null,
      vatRegistrationStatus: snapshot.customer.vatRegistrationStatus,
      taxStatus: snapshot.customer.taxStatus,
    } : null,
    lines: snapshot.lines.map((line) => ({
      order: line.order,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitOfMeasure: line.unitOfMeasure,
      originalAmount: line.originalAmount === "0.00" ? line.subtotal : line.originalAmount,
      discount: line.discount,
      taxTreatment: line.taxTreatment,
      taxTreatmentReason: line.taxTreatmentReason,
      taxTreatmentReference: line.taxTreatmentReference,
      relief: line.relief,
      taxableBase: line.taxableBase === "0.00" && snapshot.snapshotVersion === 1 ? line.subtotal : line.taxableBase,
      taxAmount: line.tax?.amount ?? "0.00",
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
    payments: snapshot.payments,
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
    supplyDate?: string | null;
    taxPointDate?: string | null;
    supplyDateTime?: string | null;
    taxPointDateTime?: string | null;
    transactionType?: "SALE" | "SERVICE" | "HIRE_OR_LEASE" | "EXCHANGE" | "OTHER";
    receiptType?: "COMMERCIAL" | "VAT_SALES_RECEIPT";
    servicePeriod?: { start: string; end: string } | null;
    priceMode?: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE";
    adjustment?: IssuedDocumentSnapshot["document"]["adjustment"];
    dueDate: string | null;
    notes: string | null;
    isTestDocument: boolean;
  };
  issuer: IssuedDocumentSnapshot["issuer"];
  customer: IssuedDocumentSnapshot["customer"];
  lines: IssuedDocumentSnapshot["lines"];
  tax: IssuedDocumentSnapshot["tax"];
  totals: IssuedDocumentSnapshot["totals"];
  payments?: IssuedDocumentSnapshot["payments"];
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
    supplyDate: input.document.supplyDate ?? null,
    taxPointDate: input.document.taxPointDate ?? null,
    supplyDateTime: input.document.supplyDateTime ?? null,
    taxPointDateTime: input.document.taxPointDateTime ?? null,
    dueDate: input.document.dueDate,
    issuedAt: null,
    isTestDocument: input.document.isTestDocument,
    isVoided: false,
    voidReason: null,
    voidedAt: null,
    logo: input.issuer.logo,
    transactionType: input.document.transactionType ?? "SALE",
    receiptType: input.document.receiptType ?? "COMMERCIAL",
    servicePeriod: input.document.servicePeriod ?? null,
    fiscalizationLabel: input.document.type === "VAT_INVOICE"
      || input.document.type === "CREDIT_NOTE"
      || input.document.type === "DEBIT_NOTE"
      || (input.document.type === "RECEIPT" && input.document.receiptType === "VAT_SALES_RECEIPT")
      ? "GRA Fiscalization Required"
      : "Not a GRA tax document",
    priceMode: input.document.priceMode ?? "TAX_EXCLUSIVE",
    adjustment: input.document.adjustment ?? null,
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
      vatRegistrationStatus: input.issuer.vatRegistrationStatus,
    },
    customer: input.customer ? {
      name: input.customer.name,
      address: input.customer.address,
      email: input.customer.email,
      phone: input.customer.phone,
      taxpayerId: input.customer.taxpayerId ?? input.customer.businessTin,
      taxpayerIdLabel: input.customer.taxpayerIdType === "GHANA_CARD_PIN" ? "Ghana Card PIN" : input.customer.taxpayerIdType === "GRA_TIN" || input.customer.taxpayerId || input.customer.businessTin ? "GRA TIN" : null,
      vatRegistrationStatus: input.customer.vatRegistrationStatus,
      taxStatus: input.customer.taxStatus,
    } : null,
    lines: input.lines.map((line) => ({
      order: line.order,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitOfMeasure: line.unitOfMeasure,
      originalAmount: line.originalAmount === "0.00" ? line.subtotal : line.originalAmount,
      discount: line.discount,
      taxTreatment: line.taxTreatment,
      taxTreatmentReason: line.taxTreatmentReason,
      taxTreatmentReference: line.taxTreatmentReference,
      relief: line.relief,
      taxableBase: line.taxableBase,
      taxAmount: line.tax?.amount ?? "0.00",
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
    payments: input.payments ?? [],
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
