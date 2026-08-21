import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);

export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(320).refine((value) => !value || z.email().safeParse(value).success, "Enter a valid email.").transform((value) => value || null),
  phone: optionalText(50),
  address: optionalText(2_000),
  businessTin: optionalText(100),
  notes: optionalText(4_000),
});

export const customerIdSchema = z.string().uuid();
