"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireUser } from "@/features/auth/session";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformCapability } from "@/features/platform-admin/authorization";

import {
  PlatformInvitationConflictError,
  PlatformInvitationUnavailableError,
  PlatformOwnerProtectionError,
  PlatformTeamAuthorizationError,
  PlatformTeamValidationError,
} from "./errors";
import {
  acceptPlatformInvitation,
  cancelPlatformInvitation,
  createPlatformInvitation,
  renewPlatformInvitation,
} from "./invitation-service";
import { managePlatformMember } from "./membership-service";
import type { PlatformTeamFormState } from "./types";

function getOrigin(headersList: Headers) {
  const origin = headersList.get("origin");
  if (origin) return origin;
  const host = headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

function safePlatformTeamError(error: unknown): PlatformTeamFormState {
  if (error instanceof PlatformTeamValidationError) {
    return {
      message: "Check the highlighted fields and try again.",
      fieldErrors: error.fieldErrors,
    };
  }
  if (error instanceof PlatformInvitationConflictError) {
    return {
      message:
        error.reason === "PENDING"
          ? "A valid pending platform invitation already exists for this email."
          : error.reason === "MEMBER"
            ? "This person is already an active platform team member."
            : "Manage this person's existing platform access instead.",
    };
  }
  if (
    error instanceof PlatformTeamAuthorizationError ||
    error instanceof PlatformOwnerProtectionError
  ) {
    return { message: "You do not have access to this platform team action." };
  }
  if (error instanceof PlatformInvitationUnavailableError) {
    return { message: "This platform invitation is no longer available." };
  }
  return { message: "Unable to complete this platform team action right now." };
}

export async function invitePlatformMemberAction(
  _previousState: PlatformTeamFormState,
  formData: FormData,
): Promise<PlatformTeamFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM,
    );
    const invitation = await createPlatformInvitation({
      actorUserId: context.user.id,
      invitation: { email: formData.get("email"), role: formData.get("role") },
    });
    const origin = getOrigin(await headers());
    revalidatePath("/civ-admin/team");
    revalidatePath("/civ-admin/activity");
    return {
      success: true,
      message: "Platform invitation created. Share this link securely.",
      invitationUrl: `${origin}/platform-invite/${invitation.token}`,
    };
  } catch (error) {
    return safePlatformTeamError(error);
  }
}

export async function cancelPlatformInvitationAction(formData: FormData) {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM,
    );
    await cancelPlatformInvitation({
      actorUserId: context.user.id,
      invitationId: formData.get("invitationId"),
    });
  } catch {}
  revalidatePath("/civ-admin/team");
  revalidatePath("/civ-admin/activity");
}

export async function renewPlatformInvitationAction(
  _previousState: PlatformTeamFormState,
  formData: FormData,
): Promise<PlatformTeamFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM,
    );
    const invitation = await renewPlatformInvitation({
      actorUserId: context.user.id,
      invitationId: formData.get("invitationId"),
    });
    const origin = getOrigin(await headers());
    revalidatePath("/civ-admin/team");
    revalidatePath("/civ-admin/activity");
    return {
      success: true,
      message: "A new link was generated. The previous link is invalid.",
      invitationUrl: `${origin}/platform-invite/${invitation.token}`,
    };
  } catch (error) {
    return safePlatformTeamError(error);
  }
}

export async function managePlatformMemberAction(
  _previousState: PlatformTeamFormState,
  formData: FormData,
): Promise<PlatformTeamFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM,
    );
    const intent = formData.get("intent");
    await managePlatformMember({
      actorUserId: context.user.id,
      targetMembershipId: formData.get("membershipId"),
      ...(intent === "role" ? { role: formData.get("role") } : {}),
      ...(intent === "suspend" ? { status: "SUSPENDED" } : {}),
      ...(intent === "reactivate" ? { status: "ACTIVE" } : {}),
      ...(intent === "remove" ? { status: "REMOVED" } : {}),
    });
    revalidatePath("/civ-admin/team");
    revalidatePath("/civ-admin/activity");
    return { success: true, message: "Platform member updated." };
  } catch (error) {
    return safePlatformTeamError(error);
  }
}

export async function acceptPlatformInvitationAction(formData: FormData) {
  const user = await requireUser();
  const token = formData.get("token");
  try {
    await acceptPlatformInvitation({
      token,
      userId: user.id,
      userEmail: user.email,
    });
  } catch (error) {
    const code =
      error instanceof PlatformInvitationUnavailableError
        ? error.reason
        : "INVALID";
    redirect(`/platform-invite/${String(token)}?error=${code}`);
  }
  redirect("/civ-admin");
}
