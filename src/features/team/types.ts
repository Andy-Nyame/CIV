export type TeamFormState = {
  message?: string;
  success?: boolean;
  invitationUrl?: string;
  fieldErrors?: {
    email?: string[];
    role?: string[];
  };
};

export const initialTeamFormState: TeamFormState = {};
