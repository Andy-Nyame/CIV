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
});
export const documentIdSchema = z.string().uuid();
