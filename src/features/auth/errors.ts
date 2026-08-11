const oauthErrorMessages: Record<string, string> = {
  OAuthAccountNotLinked:
    "An account already exists with this email. Sign in with your existing method.",
  AccessDenied:
    "Google could not verify an eligible email address. Try another Google account or sign in with email and password.",
  OAuthCallbackError:
    "Google sign-in could not be completed. Please try again.",
  OAuthSignin: "Google sign-in could not be started. Please try again.",
};

export function getOAuthErrorMessage(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  return (
    oauthErrorMessages[value] ??
    "Google sign-in could not be completed. Please try again."
  );
}
