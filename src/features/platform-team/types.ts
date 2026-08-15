export type PlatformTeamFormState = {
  success?: boolean;
  message?: string;
  invitationUrl?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};
