import { z } from "zod";
import { moneySchema } from "@/features/catalog/validation";

const nullableUuid = z.preprocess((value) => value === "" || value === null ? null : value, z.string().uuid().nullable());
const dateSchema = z.preprocess((value) => value === "" || value === null ? null : value, z.string().date().nullable());
const dateTimeSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Enter a valid Ghana date and time.");
const optionalText = (max: number) => z.preprocess(
  (value) => value === "" || value === null || value === undefined ? null : value,
  z.string().trim().max(max).nullable(),
).optional();
const optionalEmail = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? null : value,
  z.string().trim().toLowerCase().max(320).refine((value) => z.email().safeParse(value).success, "Enter a valid email.").nullable(),
).optional();
const requiredBoolean = z.preprocess(
  (value) => value === true || value === "true" || value === "on",
  z.boolean(),
);
export const draftLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  catalogItemId: nullableUuid,
  customRateId: nullableUuid,
  description: z.string().trim().min(1).max(2_000),
  quantity: z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/).refine((value) => Number(value) > 0),
  unitPrice: moneySchema,
  unitOfMeasure: optionalText(50),
  discountAmount: moneySchema.default("0"),
  taxTreatment: z.enum(["STANDARD_RATED", "ZERO_RATED", "EXEMPT"]).optional(),
  taxTreatmentReason: optionalText(500),
  taxTreatmentReference: optionalText(500),
  reliefApplied: requiredBoolean.default(false),
  reliefReason: optionalText(500),
  reliefReference: optionalText(500),
}).superRefine((line, context) => {
  const treatment = line.taxTreatment ?? "STANDARD_RATED";
  if (treatment !== "STANDARD_RATED" && !line.taxTreatmentReason) {
    context.addIssue({ code: "custom", path: ["taxTreatmentReason"], message: "Explain the selected tax treatment." });
  }
  if (treatment !== "STANDARD_RATED" && !line.taxTreatmentReference) {
    context.addIssue({ code: "custom", path: ["taxTreatmentReference"], message: "Add the classification/support reference." });
  }
  if (line.reliefApplied && treatment !== "STANDARD_RATED") {
    context.addIssue({ code: "custom", path: ["reliefApplied"], message: "Relief is separate and may only be applied to a standard-rated supply." });
  }
  if (line.reliefApplied && (!line.reliefReason || !line.reliefReference)) {
    context.addIssue({ code: "custom", path: ["reliefReason"], message: "Relief requires a reason and supporting reference." });
  }
});
export const draftInputSchema = z.object({
  type: z.enum(["INVOICE", "RECEIPT", "VAT_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"]),
  customerId: nullableUuid,
  customerName: z.string().trim().min(1, "Customer name is required.").max(200),
  customerEmail: optionalEmail,
  customerPhone: optionalText(50),
  customerAddress: optionalText(2_000),
  customerBusinessTin: optionalText(100),
  customerTaxpayerIdType: z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.enum(["GHANA_CARD_PIN", "GRA_TIN"]).nullable()).optional(),
  customerTaxpayerId: optionalText(100),
  customerVatRegistrationStatus: z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.enum(["NOT_REGISTERED", "PENDING", "REGISTERED", "DEREGISTERED"]).nullable()).optional(),
  customerTaxStatus: z.enum(["ORDINARY_CONSUMER", "TAXABLE_PERSON"]).default("ORDINARY_CONSUMER"),
  currency: z.string().trim().toUpperCase().length(3),
  draftDate: z.string().date(),
  supplyDate: dateTimeSchema,
  dueDate: dateSchema,
  transactionType: z.enum(["SALE", "SERVICE", "HIRE_OR_LEASE", "EXCHANGE", "OTHER"]).default("SALE"),
  servicePeriodStart: z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, dateTimeSchema.nullable()).optional().default(null),
  servicePeriodEnd: z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, dateTimeSchema.nullable()).optional().default(null),
  receiptType: z.enum(["COMMERCIAL", "VAT_SALES_RECEIPT"]).default("COMMERCIAL"),
  priceMode: z.enum(["TAX_EXCLUSIVE", "TAX_INCLUSIVE"]).default("TAX_EXCLUSIVE"),
  originalDocumentId: nullableUuid.optional().default(null),
  adjustmentReason: optionalText(1_000),
  withholdingApplied: requiredBoolean.default(false),
  withholdingAmount: moneySchema.default("0"),
  withholdingReference: optionalText(500),
  withholdingDate: dateSchema.optional().default(null),
  withholdingAgent: requiredBoolean.default(false),
  withholdingEvidence: optionalText(500),
  paymentEvents: z.array(z.object({
    occurredAt: dateTimeSchema,
    amount: moneySchema.refine((value) => Number(value) > 0, "Payment amount must be greater than zero."),
    method: optionalText(100),
    reference: optionalText(300),
  })).max(20).default([]),
  notes: z.string().trim().max(4_000).transform((value) => value || null),
  lines: z.array(draftLineInputSchema).min(1).max(100),
}).superRefine((value, context) => {
  if (value.dueDate && value.dueDate < value.draftDate) context.addIssue({ code: "custom", path: ["dueDate"], message: "Due date cannot be before the draft date." });
  if (value.type === "VAT_INVOICE" && value.currency !== "GHS") context.addIssue({ code: "custom", path: ["currency"], message: "Ghana VAT invoices must use GHS." });
  if (["CREDIT_NOTE", "DEBIT_NOTE"].includes(value.type) && (!value.originalDocumentId || !value.adjustmentReason)) {
    context.addIssue({ code: "custom", path: ["adjustmentReason"], message: "Adjustment documents require an original issued document and a reason." });
  }
  if (!["CREDIT_NOTE", "DEBIT_NOTE"].includes(value.type) && value.originalDocumentId) {
    context.addIssue({ code: "custom", path: ["originalDocumentId"], message: "Only credit and debit notes may reference an original document." });
  }
  if (value.type !== "RECEIPT" && value.receiptType !== "COMMERCIAL") {
    context.addIssue({ code: "custom", path: ["receiptType"], message: "Only receipts can use the VAT sales receipt classification." });
  }
  if (value.transactionType === "HIRE_OR_LEASE" && (!value.servicePeriodStart || !value.servicePeriodEnd)) {
    context.addIssue({ code: "custom", path: ["servicePeriodStart"], message: "Hire or lease transactions require a service/rental period." });
  }
  if (value.servicePeriodStart && value.servicePeriodEnd && value.servicePeriodEnd < value.servicePeriodStart) {
    context.addIssue({ code: "custom", path: ["servicePeriodEnd"], message: "The service period cannot end before it starts." });
  }
  if (value.withholdingApplied && (!value.withholdingReference || Number(value.withholdingAmount) <= 0)) {
    context.addIssue({ code: "custom", path: ["withholdingReference"], message: "Recorded VAT withholding requires a positive certified amount and reference." });
  }
  if (value.withholdingApplied && !value.withholdingAgent) {
    context.addIssue({ code: "custom", path: ["withholdingAgent"], message: "Confirm that the recipient is an appointed VAT withholding agent." });
  }
});
export const documentIdSchema = z.string().uuid();
