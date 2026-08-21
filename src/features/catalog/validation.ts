import { z } from "zod";

const optional = (max: number) => z.string().trim().max(max).transform((value) => value || null);
export const moneySchema = z.string().trim().regex(/^\d{1,15}(\.\d{1,4})?$/);
export const catalogueInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: optional(2_000),
  type: z.enum(["ITEM", "SERVICE"]),
  unitPrice: moneySchema,
  currency: z.string().trim().toUpperCase().length(3),
  unitLabel: optional(50),
  sku: optional(100),
});
export const catalogueIdSchema = z.string().uuid();
