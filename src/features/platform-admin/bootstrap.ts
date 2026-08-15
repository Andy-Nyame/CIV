import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";

import { PlatformBootstrapError } from "./errors";

const ownerEmailSchema = z.string().trim().toLowerCase().email().max(320);

export async function bootstrapDevelopmentPlatformOwner(input: {
  appEnvironment: string | undefined;
  email: string | undefined;
}) {
  if (input.appEnvironment !== "development") {
    throw new PlatformBootstrapError("INVALID_ENVIRONMENT");
  }
  if (!input.email?.trim()) throw new PlatformBootstrapError("EMAIL_REQUIRED");

  const email = ownerEmailSchema.safeParse(input.email);
  if (!email.success) throw new PlatformBootstrapError("INVALID_EMAIL");

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw<[{ lock: string }]>`
      SELECT pg_advisory_xact_lock(hashtext('civ-platform-owner-bootstrap'))::text AS lock
    `;

    const [user, activeOwners] = await Promise.all([
      transaction.user.findUnique({
        where: { email: email.data },
        select: { id: true },
      }),
      transaction.platformMembership.findMany({
        where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
        select: { userId: true },
        take: 2,
      }),
    ]);

    if (!user) throw new PlatformBootstrapError("USER_NOT_FOUND");
    if (activeOwners.length > 1) {
      throw new PlatformBootstrapError("INCONSISTENT_OWNERS");
    }
    if (activeOwners[0] && activeOwners[0].userId !== user.id) {
      throw new PlatformBootstrapError("OWNER_ALREADY_EXISTS");
    }

    const membership = await transaction.platformMembership.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        role: "PLATFORM_OWNER",
        status: "ACTIVE",
      },
      update: { role: "PLATFORM_OWNER", status: "ACTIVE" },
      select: { id: true, userId: true, role: true, status: true },
    });

    const ownerCount = await transaction.platformMembership.count({
      where: { role: "PLATFORM_OWNER", status: "ACTIVE" },
    });
    if (ownerCount !== 1) {
      throw new PlatformBootstrapError("INCONSISTENT_OWNERS");
    }

    return membership;
  });
}
