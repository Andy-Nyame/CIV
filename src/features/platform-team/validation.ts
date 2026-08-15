import { z } from "zod";

export const recruitablePlatformRoleSchema = z.enum([
  "PLATFORM_ADMIN",
  "ANALYST",
  "SUPPORT",
  "FINANCE",
]);

export type RecruitablePlatformRole = z.infer<
  typeof recruitablePlatformRoleSchema
>;

export const platformInvitationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: recruitablePlatformRoleSchema,
});

export const platformInvitationIdSchema = z.string().uuid();

export const platformMembershipMutationSchema = z
  .object({
    actorUserId: z.string().uuid(),
    targetMembershipId: z.string().uuid(),
    role: recruitablePlatformRoleSchema.optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "REMOVED"]).optional(),
  })
  .refine((input) => input.role !== undefined || input.status !== undefined);
