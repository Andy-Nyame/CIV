import "server-only";

import { requireUser } from "@/features/auth/session";
import { db } from "@/lib/db";

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
    hasPassword: user.passwordHash !== null,
    hasGoogle: user.accounts.length > 0,
    signature: user.signatureProfile,
  };
}
