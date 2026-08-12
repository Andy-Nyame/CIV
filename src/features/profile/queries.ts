import "server-only";

import { requireUser } from "@/features/auth/session";
import { db } from "@/lib/db";

export async function getPersonalProfilePhotoUrl(userId: string) {
  const profilePhoto = await db.profilePhoto.findUnique({
    where: { userId },
    select: { updatedAt: true },
  });
  return profilePhoto
    ? `/api/profile/assets/photo?v=${profilePhoto.updatedAt.getTime()}`
    : null;
}

export async function getPersonalProfile() {
  const sessionUser = await requireUser();
  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      name: true,
      email: true,
      image: true,
      passwordHash: true,
      accounts: {
        where: { provider: "google" },
        select: { provider: true },
        take: 1,
      },
      profilePhoto: {
        select: { mimeType: true, updatedAt: true },
      },
      signatureProfile: {
        select: {
          mimeType: true,
          width: true,
          height: true,
          sizeBytes: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("Authenticated account is unavailable.");
  }

  return {
    name: user.name,
    email: user.email,
    image: user.image,
    profilePhoto: user.profilePhoto,
    profilePhotoUrl: user.profilePhoto
      ? `/api/profile/assets/photo?v=${user.profilePhoto.updatedAt.getTime()}`
      : null,
    hasPassword: user.passwordHash !== null,
    hasGoogle: user.accounts.length > 0,
    signature: user.signatureProfile,
    signatureUrl: user.signatureProfile
      ? `/api/profile/assets/signature?v=${user.signatureProfile.updatedAt.getTime()}`
      : null,
  };
}
