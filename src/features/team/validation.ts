import { z } from "zod";

export const normalizedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, "Email must be 320 characters or fewer.")
  .email("Enter a valid email address.");

export const teamRoleSchema = z.enum(["ADMIN", "MANAGER", "STAFF"], {
  error: "Choose Admin, Manager, or Staff.",
});

export const invitationInputSchema = z.object({
  email: normalizedEmailSchema,
  role: teamRoleSchema,
});

export const invitationIdSchema = z.string().uuid();
export const membershipIdSchema = z.string().uuid();

export type TeamRole = z.infer<typeof teamRoleSchema>;
