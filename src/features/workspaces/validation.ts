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

export type WorkspaceInput = z.infer<typeof workspaceInputSchema>;
