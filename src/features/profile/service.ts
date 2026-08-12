import "server-only";

import { hashPassword, verifyPassword } from "@/features/auth/password";
import { db } from "@/lib/db";
import { createUserImageKey } from "@/lib/storage/object-keys";
import { deleteObject, getObject, uploadObject } from "@/lib/storage/object-storage";

import {
  IncorrectCurrentPasswordError,
  PrivateAssetCleanupError,
  ProfileValidationError,
  StalePasswordUpdateError,
} from "./errors";
import {
  processProfilePhoto,
  processSignatureImage,
  type ProcessedPrivateImage,
} from "./private-images";
import { displayNameSchema, passwordUpdateSchema } from "./validation";

export async function updatePersonalDisplayName(userId: string, input: unknown) {
  const result = displayNameSchema.safeParse(input);
  if (!result.success) {
    throw new ProfileValidationError(result.error.flatten().fieldErrors);
  }

  return db.user.update({
    where: { id: userId },
    data: { name: result.data.name },
    select: { id: true, name: true },
  });
}

type PrivateAssetKind = "profile" | "signature";

async function savePrivateAsset(
  userId: string,
  kind: PrivateAssetKind,
  image: ProcessedPrivateImage,
) {
  const objectKind = kind === "profile" ? "profile" : "signatures";
  const key = createUserImageKey({ userId, kind: objectKind, mimeType: image.mimeType });
  const existing =
    kind === "profile"
      ? await db.profilePhoto.findUnique({ where: { userId }, select: { storageKey: true } })
      : await db.signatureProfile.findUnique({ where: { userId }, select: { storageKey: true } });

  await uploadObject({
    key,
    body: image.body,
    contentType: image.mimeType,
    checksumSha256: image.checksum,
  });

  const data = {
    storageKey: key,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    sizeBytes: image.sizeBytes,
    checksum: image.checksum,
  };

  try {
    if (kind === "profile") {
      await db.profilePhoto.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    } else {
      await db.signatureProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    }
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }

  if (existing && existing.storageKey !== key) {
    try {
      await deleteObject(existing.storageKey);
    } catch {
      return { cleanupPending: true };
    }
  }

  return { cleanupPending: false };
}

async function removePrivateAsset(userId: string, kind: PrivateAssetKind) {
  const existing =
    kind === "profile"
      ? await db.profilePhoto.findUnique({ where: { userId } })
      : await db.signatureProfile.findUnique({ where: { userId } });
  if (!existing) return { removed: false };

  const stored = await getObject(existing.storageKey);
  await deleteObject(existing.storageKey);

  try {
    if (kind === "profile") {
      await db.profilePhoto.delete({ where: { userId } });
    } else {
      await db.signatureProfile.delete({ where: { userId } });
    }
  } catch (error) {
    try {
      await uploadObject({
        key: existing.storageKey,
        body: stored.body,
        contentType: existing.mimeType,
        checksumSha256: existing.checksum,
      });
    } catch {
      throw new PrivateAssetCleanupError(true);
    }
    throw error;
  }

  return { removed: true };
}

export async function savePersonalProfilePhoto(userId: string, file: File) {
  return savePrivateAsset(userId, "profile", await processProfilePhoto(file));
}

export async function removePersonalProfilePhoto(userId: string) {
  return removePrivateAsset(userId, "profile");
}

export async function savePersonalSignature(userId: string, file: File) {
  return savePrivateAsset(userId, "signature", await processSignatureImage(file));
}

export async function removePersonalSignature(userId: string) {
  return removePrivateAsset(userId, "signature");
}

export async function updatePersonalPassword(userId: string, input: unknown) {
  const result = passwordUpdateSchema.safeParse(input);
  if (!result.success) {
    throw new ProfileValidationError(result.error.flatten().fieldErrors);
  }

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (user.passwordHash) {
    if (
      !result.data.currentPassword ||
      !(await verifyPassword(user.passwordHash, result.data.currentPassword))
    ) {
      throw new IncorrectCurrentPasswordError();
    }
  }

  const passwordHash = await hashPassword(result.data.newPassword);
  const updated = await db.user.updateMany({
    where: { id: userId, passwordHash: user.passwordHash },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  if (updated.count !== 1) throw new StalePasswordUpdateError();

  return { hadPassword: user.passwordHash !== null };
}
