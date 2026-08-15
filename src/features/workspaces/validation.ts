import { z } from "zod";

export const workspaceInputSchema = z.object({
  type: z.enum(["INDIVIDUAL", "BUSINESS", "ORGANIZATION"], {
    error: "Choose how you will use CIV.",
  }),
  name: z
    .string()
    .trim()
    .min(2, "Workspace name must be at least 2 characters.")
    .max(200, "Workspace name must be 200 characters or fewer."),
});

export const workspaceIdSchema = z.string().uuid();

const optionalTrimmedText = (maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(maximum).nullable(),
  );

const optionalEmail = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? null : value,
  z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid workspace email address.")
    .max(320)
    .nullable(),
);

export const workspaceSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Workspace name must be at least 2 characters.")
    .max(200, "Workspace name must be 200 characters or fewer."),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use a two-letter country code, such as GH."),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, such as GHS."),
  email: optionalEmail,
  phone: optionalTrimmedText(50),
  address: optionalTrimmedText(1000),
  registrationNumber: optionalTrimmedText(100),
  businessTin: optionalTrimmedText(100),
});

export const workspaceLifecycleConfirmationSchema = z.enum([
  "ARCHIVE",
  "RESTORE",
  "LEAVE",
  "TRANSFER",
]);

export const transferOwnershipSchema = z.object({
  targetMembershipId: z.string().uuid(),
  confirmation: z.literal("TRANSFER"),
});

export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;
