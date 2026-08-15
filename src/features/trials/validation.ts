import { z } from "zod";

const planCodeSchema = z.string().trim().min(1).max(50);

export const trialConfigurationInputSchema = z
  .object({
    enabled: z.boolean(),
    trialPlanCode: planCodeSchema,
    durationDays: z.coerce.number().int().min(1).max(365),
    fallbackPlanCode: planCodeSchema,
    newWorkspacesOnly: z.boolean(),
    oneTrialPerWorkspace: z.boolean(),
    paymentMethodRequired: z.boolean(),
    allowManualGrant: z.boolean(),
  })
  .refine((value) => value.trialPlanCode !== value.fallbackPlanCode, {
    message: "Trial and fallback plans must be different.",
    path: ["fallbackPlanCode"],
  });

export const manualTrialGrantSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const trialCancellationSchema = z.object({
  trialId: z.string().uuid(),
});
