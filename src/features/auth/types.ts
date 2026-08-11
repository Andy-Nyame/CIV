export type AuthFieldErrors = {
  name?: string[];
  email?: string[];
  password?: string[];
};

export type AuthFormState = {
  message?: string;
  fieldErrors?: AuthFieldErrors;
};

export const initialAuthFormState: AuthFormState = {};
