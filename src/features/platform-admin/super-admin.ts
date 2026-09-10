import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

const REQUIRED_SUPER_ADMIN_EMAIL = "nyameandy8@gmail.com";

export class SuperAdminAuthorizationError extends Error {
  constructor() {
    super("CIV Super Admin access is required.");
    this.name = "SuperAdminAuthorizationError";
  }
}

export function configuredSuperAdminEmails(raw = process.env.SUPER_ADMIN_EMAILS) {
  return new Set(
    [REQUIRED_SUPER_ADMIN_EMAIL, ...(raw?.split(",") ?? [])]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isSuperAdminEmail(email: string | null | undefined, raw?: string) {
  return Boolean(email && configuredSuperAdminEmails(raw).has(email.trim().toLowerCase()));
}

export async function isSuperAdminUserId(
  userId: string,
  client: Pick<typeof db, "user"> | Prisma.TransactionClient = db,
) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return isSuperAdminEmail(user?.email);
}

export async function requireSuperAdminUserId(
  userId: string,
  client: Pick<typeof db, "user"> | Prisma.TransactionClient = db,
) {
  if (!(await isSuperAdminUserId(userId, client))) {
    throw new SuperAdminAuthorizationError();
  }
}

export async function requireSuperAdminActor(
  userId: unknown,
  client: Pick<typeof db, "user"> | Prisma.TransactionClient = db,
) {
  if (typeof userId !== "string" || !userId) {
    throw new SuperAdminAuthorizationError();
  }
  await requireSuperAdminUserId(userId, client);
  return userId;
}
