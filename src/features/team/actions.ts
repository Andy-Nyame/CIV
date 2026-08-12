"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import {
  manageWorkspaceMember,
  OwnerProtectionError,
} from "@/features/authorization/membership-service";
import { requireUser } from "@/features/auth/session";
import { setActiveWorkspaceCookie } from "@/features/workspaces/access";

import {
  InvitationConflictError,
  InvitationUnavailableError,
  MemberLimitError,
  SubscriptionConfigurationError,
  TeamValidationError,
} from "./errors";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  renewInvitation,
} from "./invitation-service";
import type { TeamFormState } from "./types";

function getOrigin(headersList: Headers) {
  const origin = headersList.get("origin");
  if (origin) return origin;
  const host = headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

function safeTeamActionError(error: unknown): TeamFormState {
  if (error instanceof TeamValidationError) {
    return {
      message: "Check the highlighted fields and try again.",
      fieldErrors: error.fieldErrors,
    };
  }
  if (error instanceof MemberLimitError) {
    return { message: "Your current plan has reached its member limit." };
  }
  if (error instanceof InvitationConflictError) {
    return {
      message:
        error.reason === "PENDING"
          ? "A pending invitation already exists for this email."
          : error.reason === "MEMBER"
            ? "This person is already a member of this workspace."
            : "Manage this person's existing membership instead.",
    };
  }
  if (
    error instanceof WorkspaceAuthorizationError ||
    error instanceof OwnerProtectionError
  ) {
    return { message: "You do not have access to this team action." };
  }
  if (error instanceof SubscriptionConfigurationError) {
    return { message: "Workspace plan information is temporarily unavailable." };
  }
  if (error instanceof InvitationUnavailableError) {
    return { message: "This invitation is no longer available." };
  }

  return { message: "Unable to complete this team action right now." };
}

export async function inviteMemberAction(
  _previousState: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_TEAM);
    const invitation = await createInvitation({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      input: { email: formData.get("email"), role: formData.get("role") },
    });
    const origin = getOrigin(await headers());
    revalidatePath("/app/team");
    return {
      success: true,
      message: "Invitation created. Share this link securely.",
      invitationUrl: `${origin}/invite/${invitation.token}`,
    };
  } catch (error) {
    return safeTeamActionError(error);
  }
}

export async function cancelInvitationAction(formData: FormData) {
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_TEAM);
    await cancelInvitation({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      invitationId: formData.get("invitationId"),
    });
  } catch {}
  revalidatePath("/app/team");
}

export async function renewInvitationAction(
  _previousState: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_TEAM);
    const invitation = await renewInvitation({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      invitationId: formData.get("invitationId"),
    });
    const origin = getOrigin(await headers());
    revalidatePath("/app/team");
    return {
      success: true,
      message: "A new invitation link was generated. The previous link is invalid.",
      invitationUrl: `${origin}/invite/${invitation.token}`,
    };
  } catch (error) {
    return safeTeamActionError(error);
  }
}

export async function manageMemberAction(
  _previousState: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_TEAM);
    const intent = formData.get("intent");
    const input = {
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      targetMembershipId: formData.get("membershipId"),
      ...(intent === "role" ? { role: formData.get("role") } : {}),
      ...(intent === "suspend" ? { status: "SUSPENDED" } : {}),
      ...(intent === "reactivate" ? { status: "ACTIVE" } : {}),
      ...(intent === "remove" ? { status: "REMOVED" } : {}),
    };
    await manageWorkspaceMember(input);
    revalidatePath("/app/team");
    return { success: true, message: "Member updated." };
  } catch (error) {
    return safeTeamActionError(error);
  }
}

export async function acceptInvitationAction(formData: FormData) {
  const user = await requireUser();
  const token = formData.get("token");

  try {
    const membership = await acceptInvitation({
      token,
      userId: user.id,
      userEmail: user.email,
    });
    await setActiveWorkspaceCookie(membership.workspaceId);
  } catch (error) {
    const code =
      error instanceof InvitationUnavailableError ? error.reason : "INVALID";
    redirect(`/invite/${String(token)}?error=${code}`);
  }

  redirect("/app");
}
