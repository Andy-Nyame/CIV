import type { DocumentType } from "@/generated/prisma/enums";

export type WorkspaceReadinessRecord = {
  name: string;
  type: "INDIVIDUAL" | "BUSINESS" | "ORGANIZATION";
  environment: "NORMAL" | "TEST";
  legalName: string | null;
  address: string | null;
  taxpayerIdType: "GHANA_CARD_PIN" | "GRA_TIN" | null;
  taxpayerId: string | null;
  vatRegistered: boolean;
};

export type WorkspaceReadinessCode =
  | "TEST_WORKSPACE_ACCESS_REQUIRED"
  | "LEGAL_NAME_REQUIRED"
  | "ADDRESS_REQUIRED"
  | "TAXPAYER_ID_TYPE_INVALID"
  | "TAXPAYER_ID_REQUIRED"
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
  if (input.documentType === "VAT_INVOICE" && !workspace.vatRegistered) {
    issues.push({
      code: "VAT_REGISTRATION_REQUIRED",
      message: "This workspace is not marked as VAT registered, so it cannot create VAT invoices.",
      field: "vatRegistered",
    });
  }

  return { ready: issues.length === 0, isTestWorkspace: false, issues };
}
