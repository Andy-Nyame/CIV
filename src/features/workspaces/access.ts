import "server-only";

import { cookies } from "next/headers";

import { MembershipStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import type { WorkspaceContext, WorkspaceOption } from "./types";
import { workspaceIdSchema } from "./validation";

export const activeWorkspaceCookieName = "civ-active-workspace";

export async function requireWorkspaceMembership(
  userId: string,
  workspaceId: unknown,
) {
  const result = workspaceIdSchema.safeParse(workspaceId);

  if (!result.success) {
    return null;
  }

  return db.membership.findFirst({
    where: {
      userId,
      workspaceId: result.data,
      status: MembershipStatus.ACTIVE,
      workspace: { archivedAt: null },
    },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
    },
  });
}

export async function getWorkspaceContextForUser(
  userId: string,
): Promise<WorkspaceContext> {
  const cookieStore = await cookies();
  const preferredWorkspaceId = cookieStore.get(activeWorkspaceCookieName)?.value;
  const memberships = await db.membership.findMany({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      workspace: { archivedAt: null },
    },
    orderBy: [{ createdAt: "asc" }, { workspaceId: "asc" }],
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
    },
  });

  const available: WorkspaceOption[] = memberships.map(
    ({ role, workspace }) => ({ ...workspace, role }),
  );
  const current =
    available.find((workspace) => workspace.id === preferredWorkspaceId) ??
    available[0] ??
    null;

  return {
    current,
    available,
    preferenceNeedsRepair:
      preferredWorkspaceId !== undefined &&
      preferredWorkspaceId !== (current?.id ?? null),
  };
}

export async function setActiveWorkspaceCookie(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(activeWorkspaceCookieName, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    priority: "high",
  });
}

export async function clearActiveWorkspaceCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(activeWorkspaceCookieName);
}
