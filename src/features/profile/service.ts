import "server-only";

import { hashPassword, verifyPassword } from "@/features/auth/password";
import { db } from "@/lib/db";

import {
  IncorrectCurrentPasswordError,
  ProfileValidationError,
  StalePasswordUpdateError,
} from "./errors";
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

export async function removePersonalProfileImage(userId: string) {
  return db.user.update({
    where: { id: userId },
    data: { image: null },
    select: { id: true },
  });
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
