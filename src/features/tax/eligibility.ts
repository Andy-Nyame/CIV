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

export function parseGhanaDateTime(value: Date | string) {
  if (value instanceof Date) return new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return new Date(`${value.length === 16 ? `${value}:00` : value}.000Z`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid Ghana transaction date/time.");
  return parsed;
}

export function determineTaxPointDateTime(input: {
  supplyDate: Date | string;
  documentDate: Date | string;
  paymentDates?: Array<Date | string>;
}) {
  return [input.supplyDate, input.documentDate, ...(input.paymentDates ?? [])]
    .map(parseGhanaDateTime)
    .sort((a, b) => a.getTime() - b.getTime())[0]!;
}

export function determineTaxPoint(input: {
  supplyDate: Date | string;
  documentDate: Date | string;
  paymentDate?: Date | string | null;
}) {
  return dateOnly(determineTaxPointDateTime({
    supplyDate: input.supplyDate,
    documentDate: input.documentDate,
    paymentDates: input.paymentDate ? [input.paymentDate] : [],
  }));
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
