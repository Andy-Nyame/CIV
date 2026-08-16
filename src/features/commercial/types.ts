export type CommercialFormState = {
  success?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  authorizationUrl?: string;
  reference?: string;
};

export const initialCommercialFormState: CommercialFormState = {};
