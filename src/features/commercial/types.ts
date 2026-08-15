export type CommercialFormState = {
  success?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const initialCommercialFormState: CommercialFormState = {};
