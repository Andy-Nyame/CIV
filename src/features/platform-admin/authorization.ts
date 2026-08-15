import "server-only";

import { notFound } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { db } from "@/lib/db";

import {
  getPlatformCapabilitiesForRole,
  hasPlatformCapability,
  type PlatformCapability,
} from "./capabilities";
import { PlatformAuthorizationError } from "./errors";

export async function requirePlatformUser() {
  return requireUser();
}

export async function findActivePlatformMembership(userId: string) {
  return db.platformMembership.findFirst({
    where: { userId, status: "ACTIVE" },
    select: {
      id: true,
      role: true,
      status: true,
      user: {
        select: { id: true, name: true, email: true, image: true },
      },
    },
  });
}

export async function requirePlatformMembership() {
  const user = await requirePlatformUser();
  const membership = await findActivePlatformMembership(user.id);

  if (!membership) throw new PlatformAuthorizationError();

  return {
    user,
    membership,
    capabilities: getPlatformCapabilitiesForRole(membership.role),
  };
}

export async function requirePlatformCapability(
  capability: PlatformCapability,
) {
  const context = await requirePlatformMembership();
  if (!hasPlatformCapability(context.membership, capability)) {
    throw new PlatformAuthorizationError();
  }
  return context;
}

export async function requirePlatformPageCapability(
  capability: PlatformCapability,
) {
  try {
    return await requirePlatformCapability(capability);
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) notFound();
    throw error;
  }
}
