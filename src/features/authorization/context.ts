import "server-only";

import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import {
  getWorkspaceContextForUser,
  requireWorkspaceMembership,
} from "@/features/workspaces/access";

import {
  getCapabilitiesForRole,
  hasCapability,
  type Capability,
} from "./capabilities";
import { WorkspaceAuthorizationError } from "./errors";

export async function authorizeWorkspaceById(
  userId: string,
  workspaceId: unknown,
  capability: Capability = "VIEW_WORKSPACE",
) {
  const membership = await requireWorkspaceMembership(userId, workspaceId);

  if (!membership || !hasCapability(membership, capability)) {
    throw new WorkspaceAuthorizationError();
  }

  return {
    membership,
    workspace: membership.workspace,
    capabilities: getCapabilitiesForRole(membership.role),
  };
}

export async function requireActiveWorkspace() {
  const user = await requireUser();
  const workspaceContext = await getWorkspaceContextForUser(user.id);

  if (!workspaceContext.current) {
    redirect("/onboarding");
  }

  const authorization = await authorizeWorkspaceById(
    user.id,
    workspaceContext.current.id,
  );

  return {
    user,
    workspaceContext,
    ...authorization,
  };
}

export async function requireCapability(capability: Capability) {
  const context = await requireActiveWorkspace();

  if (!hasCapability(context.membership, capability)) {
    throw new WorkspaceAuthorizationError();
  }

  return context;
}

export async function requirePageCapability(capability: Capability) {
  try {
    return await requireCapability(capability);
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) {
      notFound();
    }

    throw error;
  }
}
