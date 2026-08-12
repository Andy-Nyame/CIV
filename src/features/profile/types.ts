export type ProfileFieldErrors = {
  name?: string[];
  currentPassword?: string[];
  newPassword?: string[];
  confirmPassword?: string[];
};

export type ProfileFormState = {
  success?: boolean;
  message?: string;
  fieldErrors?: ProfileFieldErrors;
};

export const initialProfileFormState: ProfileFormState = {};
