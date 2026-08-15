export type TrialFormState = {
  success?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const initialTrialFormState: TrialFormState = {};
