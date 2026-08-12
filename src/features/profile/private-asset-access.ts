import "server-only";

import { db } from "@/lib/db";

export type PersonalAssetType = "photo" | "signature";

export async function findPersonalAssetForUser(
  userId: string,
  asset: PersonalAssetType,
) {
  return asset === "photo"
    ? db.profilePhoto.findUnique({
        where: { userId },
        select: { storageKey: true, mimeType: true },
      })
    : db.signatureProfile.findUnique({
        where: { userId },
        select: { storageKey: true, mimeType: true },
      });
}
