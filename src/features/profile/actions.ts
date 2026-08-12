"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/features/auth/session";

import {
  IncorrectCurrentPasswordError,
  ProfileValidationError,
  StalePasswordUpdateError,
} from "./errors";
import {
  removePersonalProfileImage,
  updatePersonalDisplayName,
  updatePersonalPassword,
} from "./service";
import type { ProfileFormState } from "./types";

function refreshPersonalIdentity() {
  revalidatePath("/app", "layout");
  revalidatePath("/app/profile");
}

export async function updateDisplayNameAction(
  _previousState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireUser();

  try {
    await updatePersonalDisplayName(user.id, { name: formData.get("name") });
    refreshPersonalIdentity();
    return { success: true, message: "Display name updated." };
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      return {
        message: "Check the highlighted field and try again.",
        fieldErrors: error.fieldErrors,
      };
    }
    return { message: "Unable to update your display name right now." };
  }
}

export async function removeProfileImageAction(
  _previousState: ProfileFormState,
): Promise<ProfileFormState> {
  void _previousState;
  const user = await requireUser();

  try {
    await removePersonalProfileImage(user.id);
    refreshPersonalIdentity();
    return { success: true, message: "Profile photo removed." };
  } catch {
    return { message: "Unable to remove your profile photo right now." };
  }
}

export async function updatePasswordAction(
  _previousState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const sessionUser = await requireUser();
  try {
    const result = await updatePersonalPassword(sessionUser.id, {
      currentPassword: formData.get("currentPassword") ?? undefined,
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });
    refreshPersonalIdentity();
    return {
      success: true,
      message: result.hadPassword
        ? "Password changed."
        : "Password added to your account.",
    };
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      return {
        message: "Check the highlighted fields and try again.",
        fieldErrors: error.fieldErrors,
      };
    }
    if (error instanceof IncorrectCurrentPasswordError) {
      return {
        message: "Current password is incorrect.",
        fieldErrors: { currentPassword: ["Enter your current password."] },
      };
    }
    if (error instanceof StalePasswordUpdateError) {
      return {
        message: "Your password changed in another session. Refresh and try again.",
      };
    }
    return { message: "Unable to update your password right now." };
  }
}
