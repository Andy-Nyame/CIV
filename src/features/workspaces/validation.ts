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
  environment: z.enum(["NORMAL", "TEST"]).default("NORMAL"),
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
  type: z.enum(["INDIVIDUAL", "BUSINESS", "ORGANIZATION"]).optional(),
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
  legalName: optionalTrimmedText(200).optional(),
  tradingName: optionalTrimmedText(200).optional(),
  taxpayerId: optionalTrimmedText(100).optional(),
  businessActivity: z.enum(["GOODS", "SERVICES", "BOTH"]).optional(),
  vatRegistrationStatus: z.enum(["NOT_REGISTERED", "PENDING", "REGISTERED", "DEREGISTERED"]).optional(),
  vatRegistrationEffectiveDate: z.preprocess((value) => value === "" || value === null ? null : value, z.string().date().nullable()).optional(),
  vatDeregistrationEffectiveDate: z.preprocess((value) => value === "" || value === null ? null : value, z.string().date().nullable()).optional(),
  vatRegistered: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  registrationNumber: optionalTrimmedText(100),
  businessTin: optionalTrimmedText(100).optional(),
}).superRefine((value, context) => {
  if ((value.vatRegistrationStatus === "REGISTERED" || value.vatRegistrationStatus === "DEREGISTERED") && !value.vatRegistrationEffectiveDate) {
    context.addIssue({ code: "custom", path: ["vatRegistrationEffectiveDate"], message: "Add the VAT registration effective date." });
  }
  if (value.vatRegistrationStatus === "DEREGISTERED" && !value.vatDeregistrationEffectiveDate) {
    context.addIssue({ code: "custom", path: ["vatDeregistrationEffectiveDate"], message: "Add the deregistration effective date." });
  }
  if (value.vatDeregistrationEffectiveDate && value.vatRegistrationEffectiveDate && value.vatDeregistrationEffectiveDate < value.vatRegistrationEffectiveDate) {
    context.addIssue({ code: "custom", path: ["vatDeregistrationEffectiveDate"], message: "Deregistration cannot predate registration." });
  }
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
