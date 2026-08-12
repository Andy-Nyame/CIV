export function getTrustedProfileImage(image: string | null | undefined) {
  if (!image) return null;

  try {
    const url = new URL(image);
    return url.protocol === "https:" &&
      url.hostname === "lh3.googleusercontent.com"
      ? image
      : null;
  } catch {
    return null;
  }
}

export function chooseProfileImage(
  privateImageUrl: string | null | undefined,
  oauthImage: string | null | undefined,
) {
  return privateImageUrl || getTrustedProfileImage(oauthImage);
}
