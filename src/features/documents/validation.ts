import { z } from "zod";
import { moneySchema } from "@/features/catalog/validation";

const nullableUuid = z.preprocess((value) => value === "" || value === null ? null : value, z.string().uuid().nullable());
const dateSchema = z.preprocess((value) => value === "" || value === null ? null : value, z.string().date().nullable());
export const draftLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  catalogItemId: nullableUuid,
  customRateId: nullableUuid,
  description: z.string().trim().min(1).max(2_000),
  quantity: z.string().trim().regex(/^\d{1,12}(\.\d{1,6})?$/).refine((value) => Number(value) > 0),
  unitPrice: moneySchema,
});
export const draftInputSchema = z.object({
  type: z.enum(["INVOICE", "RECEIPT", "VAT_INVOICE"]),
  customerId: nullableUuid,
  currency: z.string().trim().toUpperCase().length(3),
  draftDate: z.string().date(),
  dueDate: dateSchema,
  notes: z.string().trim().max(4_000).transform((value) => value || null),
  lines: z.array(draftLineInputSchema).min(1).max(100),
}).superRefine((value, context) => {
  if (value.dueDate && value.dueDate < value.draftDate) context.addIssue({ code: "custom", path: ["dueDate"], message: "Due date cannot be before the draft date." });
  if (value.type === "VAT_INVOICE" && value.currency !== "GHS") context.addIssue({ code: "custom", path: ["currency"], message: "Ghana VAT invoices must use GHS." });
  if (value.type === "VAT_INVOICE" && value.lines.some((line) => line.customRateId)) context.addIssue({ code: "custom", path: ["lines"], message: "Trusted Ghana VAT cannot be combined with workspace custom rates." });
});
export const documentIdSchema = z.string().uuid();
