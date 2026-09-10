import type { IssuedDocumentSnapshot } from "@/features/documents/snapshots";

export type PdfDocumentType = "INVOICE" | "RECEIPT" | "VAT_INVOICE";

export type IssuedDocumentPdfModel = {
  title: "Invoice" | "Receipt" | "VAT Invoice";
  number: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  issuedAt: string;
  isTestDocument: boolean;
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
    rateName: string | null;
    rateAmount: string | null;
    total: string;
  }>;
  tax: {
    profileName: string;
    versionCode: string;
    components: Array<{ code: string; name: string; rate: string; amount: string }>;
  } | null;
  totals: IssuedDocumentSnapshot["totals"];
  notes: string | null;
  issuedBy: string;
  verificationCode: string | null;
};

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
    title: titles[snapshot.document.type],
    number: snapshot.document.documentNumber,
    currency: snapshot.document.currency,
    issueDate: snapshot.document.issueDate,
    dueDate: snapshot.document.dueDate,
    issuedAt: snapshot.document.issuedAt,
    // Either persisted flag is sufficient to retain the safety marking. A caller
    // cannot downgrade a TEST snapshot by changing request parameters or UI state.
    isTestDocument: persistedIsTestDocument || snapshot.document.isTestDocument,
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
      rateName: line.customRate?.name ?? null,
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
    totals: snapshot.totals,
    notes: snapshot.document.notes,
    issuedBy: snapshot.issuedBy.displayName,
    verificationCode: snapshot.verification?.code ?? null,
  };
}

export function buildDocumentPdfFilename(model: IssuedDocumentPdfModel) {
  const type = model.title.toUpperCase().replaceAll(" ", "-");
  const number = model.number
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "DOCUMENT";
  return `CIV-${model.isTestDocument ? "TEST-" : ""}${type}-${number}.pdf`;
}
