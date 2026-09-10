import "server-only";

import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";

import { requireSuperAdminUserId, SuperAdminAuthorizationError } from "./super-admin";

export async function requireSuperAdminPageUser() {
  const user = await requireUser();
  try {
    await requireSuperAdminUserId(user.id);
  } catch (error) {
    if (error instanceof SuperAdminAuthorizationError) notFound();
    throw error;
  }
  return user;
}
