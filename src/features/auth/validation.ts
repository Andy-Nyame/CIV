import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, "Email must be 320 characters or fewer.")
  .email("Enter a valid email address.");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.");

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signupSchema = loginSchema.extend({
  name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(200, "Name must be 200 characters or fewer."),
});

export const googleProfileSchema = z.object({
  email: emailSchema,
  email_verified: z.literal(true),
});
