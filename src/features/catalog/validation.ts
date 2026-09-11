import { z } from "zod";

const optional = (max: number) => z.preprocess(
  (value) => value === undefined || value === null ? "" : value,
  z.string().trim().max(max).transform((value) => value || null),
);
export const moneySchema = z.string().trim().regex(/^\d{1,15}(\.\d{1,4})?$/);
export const catalogueInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: optional(2_000),
  type: z.enum(["ITEM", "SERVICE"]),
  unitPrice: moneySchema,
  currency: z.string().trim().toUpperCase().length(3),
  unitLabel: optional(50),
  defaultTaxTreatment: z.enum(["STANDARD_RATED", "ZERO_RATED", "EXEMPT"]).default("STANDARD_RATED"),
  taxTreatmentReason: optional(500),
  taxTreatmentReference: optional(500),
  sku: optional(100),
}).superRefine((value, context) => {
  if (value.defaultTaxTreatment !== "STANDARD_RATED" && !value.taxTreatmentReason) {
    context.addIssue({ code: "custom", path: ["taxTreatmentReason"], message: "Explain the non-standard tax treatment." });
  }
  if (value.defaultTaxTreatment === "ZERO_RATED" && !value.taxTreatmentReference) {
    context.addIssue({ code: "custom", path: ["taxTreatmentReference"], message: "Add the zero-rating support reference." });
  }
});
export const catalogueIdSchema = z.string().uuid();
