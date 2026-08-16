import type { BetaPlanCode } from "./validation";

export type PlanOption = {
  code: BetaPlanCode;
  name: string;
  description: string | null;
  betaPrice: string;
  monthlyPrice: string;
  currency: string;
  billingMode: "FREE" | "RECURRING" | "CUSTOM";
  paystackPlanConfigured: boolean;
  memberLimit: number | null;
  documentLimit: number | null;
};

export type PlanFormState = {
  success?: boolean;
  message?: string;
};

export const initialPlanFormState: PlanFormState = {};
