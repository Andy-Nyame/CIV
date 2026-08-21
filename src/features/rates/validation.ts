import { z } from "zod";

export const customRateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.string().trim().regex(/^\d{1,15}(\.\d{1,6})?$/),
  description: z.string().trim().max(2_000).transform((value) => value || null),
}).superRefine((value, context) => {
  if (value.type === "PERCENTAGE" && Number(value.value) > 100) context.addIssue({ code: "custom", path: ["value"], message: "Percentage cannot exceed 100%." });
});
export const customRateIdSchema = z.string().uuid();
