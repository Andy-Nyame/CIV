"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/features/auth/session";

import {
  IncorrectCurrentPasswordError,
  PrivateAssetCleanupError,
  ProfileValidationError,
  StalePasswordUpdateError,
} from "./errors";
import {
  removePersonalProfilePhoto,
  removePersonalSignature,
  savePersonalProfilePhoto,
  savePersonalSignature,
  updatePersonalDisplayName,
  updatePersonalPassword,
} from "./service";
import { PrivateImageValidationError } from "./private-images";
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

function fileFrom(formData: FormData) {
  const value = formData.get("image");
  if (!(value instanceof File)) {
    throw new PrivateImageValidationError("Choose an image to upload.");
  }
  return value;
}

function assetResultMessage(
  result: { cleanupPending: boolean },
  successMessage: string,
) {
  return result.cleanupPending
    ? `${successMessage} The previous private object could not be cleaned up automatically.`
    : successMessage;
}

export async function uploadProfilePhotoAction(
  _previousState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireUser();
  try {
    const result = await savePersonalProfilePhoto(user.id, fileFrom(formData));
    refreshPersonalIdentity();
    return {
      success: true,
      message: assetResultMessage(result, "Profile photo saved."),
    };
  } catch (error) {
    if (error instanceof PrivateImageValidationError) {
      return { message: error.message, fieldErrors: { image: [error.message] } };
    }
    return { message: "Unable to save your profile photo right now." };
  }
}

export async function removeProfilePhotoAction(
  _previousState: ProfileFormState,
): Promise<ProfileFormState> {
  void _previousState;
  const user = await requireUser();

  try {
    await removePersonalProfilePhoto(user.id);
    refreshPersonalIdentity();
    return { success: true, message: "Profile photo removed." };
  } catch (error) {
    if (error instanceof PrivateAssetCleanupError) {
      return { message: "The photo was removed, but private object cleanup needs attention." };
    }
    return { message: "Unable to remove your profile photo right now." };
  }
}

export async function saveSignatureAction(
  _previousState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireUser();
  try {
    const result = await savePersonalSignature(user.id, fileFrom(formData));
    revalidatePath("/app/profile");
    return {
      success: true,
      message: assetResultMessage(result, "Personal signature saved."),
    };
  } catch (error) {
    if (error instanceof PrivateImageValidationError) {
      return { message: error.message, fieldErrors: { image: [error.message] } };
    }
    return { message: "Unable to save your signature right now." };
  }
}

export async function removeSignatureAction(
  _previousState: ProfileFormState,
): Promise<ProfileFormState> {
  void _previousState;
  const user = await requireUser();
  try {
    await removePersonalSignature(user.id);
    revalidatePath("/app/profile");
    return { success: true, message: "Personal signature removed." };
  } catch (error) {
    if (error instanceof PrivateAssetCleanupError) {
      return { message: "The signature was removed, but private object cleanup needs attention." };
    }
    return { message: "Unable to remove your signature right now." };
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
