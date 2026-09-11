import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);

export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(320).refine((value) => !value || z.email().safeParse(value).success, "Enter a valid email.").transform((value) => value || null),
  phone: optionalText(50),
  address: optionalText(2_000),
  businessTin: optionalText(100),
  taxpayerIdType: z.preprocess((value) => value === "" || value === null ? null : value, z.enum(["GHANA_CARD_PIN", "GRA_TIN"]).nullable()).optional(),
  taxpayerId: optionalText(100).optional(),
  vatRegistrationStatus: z.preprocess((value) => value === "" || value === null ? null : value, z.enum(["NOT_REGISTERED", "PENDING", "REGISTERED", "DEREGISTERED"]).nullable()).optional(),
  notes: optionalText(4_000),
}).superRefine((value, context) => {
  if (value.taxpayerId && !value.taxpayerIdType) context.addIssue({ code: "custom", path: ["taxpayerIdType"], message: "Choose the customer taxpayer ID type." });
});

export const customerIdSchema = z.string().uuid();
