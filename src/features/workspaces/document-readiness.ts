import type { DocumentType } from "@/generated/prisma/enums";
import { isVatEligibleAtTaxPoint } from "@/features/tax/eligibility";

export type WorkspaceReadinessRecord = {
  name: string;
  type: "INDIVIDUAL" | "BUSINESS" | "ORGANIZATION";
  environment: "NORMAL" | "TEST";
  legalName: string | null;
  address: string | null;
  taxpayerIdType: "GHANA_CARD_PIN" | "GRA_TIN" | null;
  taxpayerId: string | null;
  vatRegistered: boolean;
  vatRegistrationStatus?: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED";
  vatRegistrationEffectiveDate?: Date | string | null;
  vatDeregistrationEffectiveDate?: Date | string | null;
};

export type WorkspaceReadinessCode =
  | "TEST_WORKSPACE_ACCESS_REQUIRED"
  | "LEGAL_NAME_REQUIRED"
  | "ADDRESS_REQUIRED"
  | "TAXPAYER_ID_TYPE_INVALID"
  | "TAXPAYER_ID_REQUIRED"
  | "VAT_EFFECTIVE_DATE_REQUIRED"
  | "VAT_REGISTRATION_REQUIRED";

export type WorkspaceReadinessIssue = {
  code: WorkspaceReadinessCode;
  message: string;
  field?: string;
};

export class WorkspaceDocumentReadinessError extends Error {
  constructor(readonly issues: WorkspaceReadinessIssue[]) {
    super(issues[0]?.message ?? "Complete workspace setup before creating documents.");
    this.name = "WorkspaceDocumentReadinessError";
  }
}

export function expectedTaxpayerIdType(type: WorkspaceReadinessRecord["type"]) {
  return type === "INDIVIDUAL" ? "GHANA_CARD_PIN" as const : "GRA_TIN" as const;
}

export function evaluateWorkspaceDocumentReadiness(input: {
  workspace: WorkspaceReadinessRecord;
  documentType?: DocumentType;
  taxPointDate?: Date | string;
  isSuperAdmin: boolean;
}) {
  const { workspace } = input;
  const issues: WorkspaceReadinessIssue[] = [];

  if (workspace.environment === "TEST") {
    if (!input.isSuperAdmin) {
      issues.push({
        code: "TEST_WORKSPACE_ACCESS_REQUIRED",
        message: "Only a CIV Super Admin can use a TEST workspace.",
      });
    }
    return { ready: issues.length === 0, isTestWorkspace: true, issues };
  }

  if (!workspace.legalName?.trim()) {
    issues.push({ code: "LEGAL_NAME_REQUIRED", message: "Add the legal or registered name.", field: "legalName" });
  }
  if (!workspace.address?.trim()) {
    issues.push({ code: "ADDRESS_REQUIRED", message: "Add the business address.", field: "address" });
  }
  const expectedIdType = expectedTaxpayerIdType(workspace.type);
  if (workspace.taxpayerIdType !== expectedIdType) {
    issues.push({
      code: "TAXPAYER_ID_TYPE_INVALID",
      message: workspace.type === "INDIVIDUAL"
        ? "Set the taxpayer ID type to Ghana Card PIN."
        : "Set the taxpayer ID type to GRA TIN.",
      field: "taxpayerId",
    });
  }
  if (!workspace.taxpayerId?.trim()) {
    issues.push({
      code: "TAXPAYER_ID_REQUIRED",
      message: workspace.type === "INDIVIDUAL" ? "Add the Ghana Card PIN." : "Add the GRA TIN.",
      field: "taxpayerId",
    });
  }
  const legacyVatEligible = workspace.vatRegistrationStatus === undefined && workspace.vatRegistered;
  const vatEligible = legacyVatEligible || (workspace.vatRegistrationStatus !== undefined && isVatEligibleAtTaxPoint({
    vatRegistrationStatus: workspace.vatRegistrationStatus,
    vatRegistrationEffectiveDate: workspace.vatRegistrationEffectiveDate ?? null,
    vatDeregistrationEffectiveDate: workspace.vatDeregistrationEffectiveDate ?? null,
  }, input.taxPointDate ?? new Date()));
  if (input.documentType === "VAT_INVOICE" && workspace.vatRegistrationStatus === "REGISTERED" && !workspace.vatRegistrationEffectiveDate) {
    issues.push({
      code: "VAT_EFFECTIVE_DATE_REQUIRED",
      message: "Add the VAT registration effective date before creating a VAT invoice.",
      field: "vatRegistrationEffectiveDate",
    });
  } else if (input.documentType === "VAT_INVOICE" && !vatEligible) {
    issues.push({
      code: "VAT_REGISTRATION_REQUIRED",
      message: "This workspace is not VAT eligible on the transaction tax date, so it cannot create a VAT invoice.",
      field: "vatRegistrationStatus",
    });
  }

  return { ready: issues.length === 0, isTestWorkspace: false, issues };
}
