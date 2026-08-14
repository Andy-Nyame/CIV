import { z } from "zod";

export const betaPlanCodeSchema = z.enum([
  "FREE",
  "STARTER",
  "BUSINESS",
  "PRO",
  "ENTERPRISE",
]);

export type BetaPlanCode = z.infer<typeof betaPlanCodeSchema>;
