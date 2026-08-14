import type { BetaPlanCode } from "./validation";

export type PlanOption = {
  code: BetaPlanCode;
  name: string;
  description: string | null;
  betaPrice: string;
  currency: string;
  memberLimit: number | null;
  documentLimit: number | null;
};

export type PlanFormState = {
  success?: boolean;
  message?: string;
};

export const initialPlanFormState: PlanFormState = {};
