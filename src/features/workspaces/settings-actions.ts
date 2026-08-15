"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { PrivateImageValidationError } from "@/features/profile/private-images";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import {
  requireActiveWorkspace,
  requireCapability,
} from "@/features/authorization/context";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { requireUser } from "@/features/auth/session";

import {
  clearActiveWorkspaceCookie,
  setActiveWorkspaceCookie,
} from "./access";
import {
  archiveWorkspace,
  leaveWorkspace,
  restoreWorkspace,
  transferWorkspaceOwnership,
} from "./lifecycle-service";
import { removeWorkspaceLogo, saveWorkspaceLogo } from "./logo-service";
import {
  WorkspaceAssetCleanupError,
  WorkspaceLifecycleError,
  WorkspaceSettingsValidationError,
} from "./settings-errors";
import { updateWorkspaceSettings } from "./settings-service";
import type { WorkspaceSettingsFormState } from "./types";
import { workspaceLifecycleConfirmationSchema } from "./validation";

function safeSettingsError(error: unknown): WorkspaceSettingsFormState {
  if (error instanceof WorkspaceSettingsValidationError) {
    return {
      message: "Check the highlighted workspace details and try again.",
      fieldErrors: error.fieldErrors,
    };
  }
  if (error instanceof PrivateImageValidationError) {
    return { message: error.message, fieldErrors: { logo: [error.message] } };
  }
  if (error instanceof WorkspaceAssetCleanupError) {
    return {
      message: error.objectRestoreFailed
        ? "The workspace logo could not be removed safely. Please contact support before trying again."
        : "The workspace logo could not be cleaned up safely.",
    };
  }
  if (
    error instanceof WorkspaceAuthorizationError ||
    error instanceof WorkspaceLifecycleError
  ) {
    return { message: "You do not have access to this workspace action." };
  }
  return { message: "Unable to update workspace settings right now." };
}

export async function updateWorkspaceSettingsAction(
  _previousState: WorkspaceSettingsFormState,
  formData: FormData,
): Promise<WorkspaceSettingsFormState> {
  void _previousState;
  try {
    const context = await requireCapability(
      CAPABILITIES.MANAGE_WORKSPACE_SETTINGS,
    );
    const result = await updateWorkspaceSettings({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      values: {
        name: formData.get("name"),
        country: formData.get("country"),
        currency: formData.get("currency"),
        email: formData.get("email"),
        phone: formData.get("phone"),
        address: formData.get("address"),
        registrationNumber: formData.get("registrationNumber"),
        businessTin: formData.get("businessTin"),
      },
    });
    revalidatePath("/app", "layout");
    revalidatePath("/app/settings");
    return {
      success: true,
      message: result.changed
        ? "Workspace settings saved."
        : "Workspace settings are already up to date.",
    };
  } catch (error) {
    return safeSettingsError(error);
  }
}

export async function uploadWorkspaceLogoAction(
  _previousState: WorkspaceSettingsFormState,
  formData: FormData,
): Promise<WorkspaceSettingsFormState> {
  void _previousState;
  try {
    const context = await requireCapability(
      CAPABILITIES.MANAGE_WORKSPACE_SETTINGS,
    );
    const file = formData.get("logo");
    if (!(file instanceof File)) {
      return { message: "Choose a workspace logo to upload." };
    }
    const result = await saveWorkspaceLogo({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      file,
    });
    revalidatePath("/app/settings");
    return {
      success: true,
      message: result.cleanupPending
        ? "The new logo is saved. Cleanup of the previous private object will be retried later."
        : "Workspace logo saved.",
    };
  } catch (error) {
    return safeSettingsError(error);
  }
}

export async function removeWorkspaceLogoAction(
  _previousState: WorkspaceSettingsFormState,
): Promise<WorkspaceSettingsFormState> {
  void _previousState;
  try {
    const context = await requireCapability(
      CAPABILITIES.MANAGE_WORKSPACE_SETTINGS,
    );
    const result = await removeWorkspaceLogo({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
    });
    revalidatePath("/app/settings");
    return {
      success: true,
      message: result.removed
        ? "Workspace logo removed."
        : "No custom workspace logo is saved.",
    };
  } catch (error) {
    return safeSettingsError(error);
  }
}

export async function archiveWorkspaceAction(
  _previousState: WorkspaceSettingsFormState,
  formData: FormData,
): Promise<WorkspaceSettingsFormState> {
  void _previousState;
  const context = await requireActiveWorkspace();
  if (
    workspaceLifecycleConfirmationSchema.safeParse(
      formData.get("confirmation"),
    ).data !== "ARCHIVE"
  ) {
    return { message: "Confirm that you want to archive this workspace." };
  }
  try {
    await archiveWorkspace({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
    });
  } catch (error) {
    return safeSettingsError(error);
  }
  await clearActiveWorkspaceCookie();
  redirect("/app");
}

export async function restoreWorkspaceAction(
  _previousState: WorkspaceSettingsFormState,
  formData: FormData,
): Promise<WorkspaceSettingsFormState> {
  void _previousState;
  const user = await requireUser();
  if (
    workspaceLifecycleConfirmationSchema.safeParse(
      formData.get("confirmation"),
    ).data !== "RESTORE"
  ) {
    return { message: "Confirm that you want to restore this workspace." };
  }
  let result: Awaited<ReturnType<typeof restoreWorkspace>>;
  try {
    result = await restoreWorkspace({
      actorUserId: user.id,
      workspaceId: formData.get("workspaceId"),
    });
  } catch (error) {
    return safeSettingsError(error);
  }
  await setActiveWorkspaceCookie(result.workspaceId);
  redirect("/app/settings");
}

export async function leaveWorkspaceAction(
  _previousState: WorkspaceSettingsFormState,
  formData: FormData,
): Promise<WorkspaceSettingsFormState> {
  void _previousState;
  const context = await requireActiveWorkspace();
  if (
    workspaceLifecycleConfirmationSchema.safeParse(
      formData.get("confirmation"),
    ).data !== "LEAVE"
  ) {
    return { message: "Confirm that you want to leave this workspace." };
  }
  try {
    await leaveWorkspace({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
    });
  } catch (error) {
    return safeSettingsError(error);
  }
  await clearActiveWorkspaceCookie();
  redirect("/app");
}

export async function transferWorkspaceOwnershipAction(
  _previousState: WorkspaceSettingsFormState,
  formData: FormData,
): Promise<WorkspaceSettingsFormState> {
  try {
    const context = await requireActiveWorkspace();
    await transferWorkspaceOwnership({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      values: {
        targetMembershipId: formData.get("targetMembershipId"),
        confirmation: formData.get("confirmation"),
      },
    });
    revalidatePath("/app", "layout");
    revalidatePath("/app/settings");
    revalidatePath("/app/team");
    return {
      success: true,
      message: "Workspace ownership transferred. Your role is now Admin.",
    };
  } catch (error) {
    return safeSettingsError(error);
  }
}
