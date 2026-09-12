export type ComplianceDocumentType = "INVOICE" | "RECEIPT" | "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
export type ComplianceReceiptType = "COMMERCIAL" | "VAT_SALES_RECEIPT";
export type ComplianceFiscalizationStatus = "NOT_RECORDED" | "NOT_REQUIRED" | "REQUIRES_GRA" | "PENDING" | "CERTIFIED" | "FAILED";

export function isStatutoryTaxDocument(type: ComplianceDocumentType, receiptType: ComplianceReceiptType = "COMMERCIAL") {
  return type === "VAT_INVOICE" || (type === "RECEIPT" && receiptType === "VAT_SALES_RECEIPT");
}

export function fiscalizationStatusForDraft(type: ComplianceDocumentType, receiptType: ComplianceReceiptType = "COMMERCIAL"): ComplianceFiscalizationStatus {
  return isStatutoryTaxDocument(type, receiptType) || type === "CREDIT_NOTE" || type === "DEBIT_NOTE"
    ? "REQUIRES_GRA"
    : "NOT_REQUIRED";
}

export function requiresTaxableCustomerIdentity(input: {
  documentType: ComplianceDocumentType;
  receiptType?: ComplianceReceiptType;
  customerTaxStatus: "ORDINARY_CONSUMER" | "TAXABLE_PERSON";
}) {
  return input.customerTaxStatus === "TAXABLE_PERSON"
    && (isStatutoryTaxDocument(input.documentType, input.receiptType) || input.documentType === "CREDIT_NOTE" || input.documentType === "DEBIT_NOTE");
}

export function hasAuthoritativeGraCertification(input: {
  status: ComplianceFiscalizationStatus;
  fiscalDocumentId?: string | null;
  timestamp?: Date | string | null;
  providerReference?: string | null;
}) {
  return input.status === "CERTIFIED"
    && Boolean(input.fiscalDocumentId?.trim())
    && Boolean(input.timestamp)
    && Boolean(input.providerReference?.trim());
}

export function publicFiscalizationLabel(input: Parameters<typeof hasAuthoritativeGraCertification>[0]) {
  if (hasAuthoritativeGraCertification(input)) return "GRA Certified" as const;
  if (input.status === "REQUIRES_GRA" || input.status === "PENDING" || input.status === "FAILED") return "GRA Fiscalization Required" as const;
  if (input.status === "NOT_REQUIRED") return "Not a GRA tax document" as const;
  return "GRA fiscalization not recorded" as const;
}
