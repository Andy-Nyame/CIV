export type VatRegistrationContext = {
  vatRegistrationStatus: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED";
  vatRegistrationEffectiveDate: Date | string | null;
  vatDeregistrationEffectiveDate: Date | string | null;
};

function dateOnly(value: Date | string) {
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid tax-point date.");
  return date;
}

export function determineTaxPoint(input: {
  supplyDate: Date | string;
  documentDate: Date | string;
  paymentDate?: Date | string | null;
}) {
  return [input.supplyDate, input.documentDate, input.paymentDate]
    .filter((value): value is Date | string => Boolean(value))
    .map(dateOnly)
    .sort()[0]!;
}

export function isVatEligibleAtTaxPoint(workspace: VatRegistrationContext, taxPointInput: Date | string) {
  if (workspace.vatRegistrationStatus === "NOT_REGISTERED" || workspace.vatRegistrationStatus === "PENDING") return false;
  if (!workspace.vatRegistrationEffectiveDate) return false;
  const taxPoint = dateOnly(taxPointInput);
  const effective = dateOnly(workspace.vatRegistrationEffectiveDate);
  const deregistered = workspace.vatDeregistrationEffectiveDate
    ? dateOnly(workspace.vatDeregistrationEffectiveDate)
    : null;
  return taxPoint >= effective && (!deregistered || taxPoint < deregistered);
}
