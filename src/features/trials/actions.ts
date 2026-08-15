"use server";

import { revalidatePath } from "next/cache";

import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformCapability } from "@/features/platform-admin/authorization";

import {
  TrialAuthorizationError,
  TrialConfigurationError,
  TrialIneligibleError,
  TrialUnavailableError,
  TrialValidationError,
} from "./errors";
import {
  cancelWorkspaceTrial,
  grantConfiguredTrial,
  updateTrialConfiguration,
} from "./service";
import type { TrialFormState } from "./types";

function checkbox(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function safeTrialError(error: unknown): TrialFormState {
  if (error instanceof TrialValidationError) {
    return {
      message: "Check the highlighted trial settings and try again.",
      fieldErrors: error.fieldErrors,
    };
  }
  if (error instanceof TrialIneligibleError) {
    const messages: Record<string, string> = {
      DISABLED: "Trials are currently disabled.",
      WORKSPACE_ARCHIVED: "Archived or unavailable workspaces cannot receive trials.",
      ALREADY_ACTIVE: "This workspace already has an active trial.",
      ALREADY_USED: "This workspace has already used its available trial.",
      NOT_NEW_WORKSPACE: "This trial is limited to newly created workspaces.",
      PAYMENT_METHOD_REQUIRED: "This trial requires a future payment-method flow.",
      MANUAL_GRANTS_DISABLED: "Manual trial grants are currently disabled.",
      PLAN_UNAVAILABLE: "The configured trial plan is unavailable.",
    };
    return { message: messages[error.reason] ?? "This workspace is not eligible for a trial." };
  }
  if (
    error instanceof TrialAuthorizationError ||
    error instanceof TrialConfigurationError ||
    error instanceof TrialUnavailableError
  ) {
    return { message: "You do not have access to this trial action." };
  }
  return { message: "Unable to complete this trial action right now." };
}

function revalidateTrials() {
  revalidatePath("/civ-admin/trials");
  revalidatePath("/app/settings/plan");
  revalidatePath("/app/settings/credits");
  revalidatePath("/app/activity");
  revalidatePath("/civ-admin/activity");
}

export async function updateTrialConfigurationAction(
  _previous: TrialFormState,
  formData: FormData,
): Promise<TrialFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_TRIALS,
    );
    const result = await updateTrialConfiguration({
      actorUserId: context.user.id,
      configuration: {
        enabled: checkbox(formData, "enabled"),
        trialPlanCode: formData.get("trialPlanCode"),
        durationDays: formData.get("durationDays"),
        fallbackPlanCode: formData.get("fallbackPlanCode"),
        newWorkspacesOnly: checkbox(formData, "newWorkspacesOnly"),
        oneTrialPerWorkspace: checkbox(formData, "oneTrialPerWorkspace"),
        paymentMethodRequired: checkbox(formData, "paymentMethodRequired"),
        allowManualGrant: checkbox(formData, "allowManualGrant"),
      },
    });
    revalidateTrials();
    return {
      success: true,
      message: result.changedFields.length
        ? "Trial configuration updated. Existing trials were not changed."
        : "No trial configuration changes were needed.",
    };
  } catch (error) {
    return safeTrialError(error);
  }
}

export async function grantTrialAction(
  _previous: TrialFormState,
  formData: FormData,
): Promise<TrialFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_TRIALS,
    );
    const trial = await grantConfiguredTrial({
      actorUserId: context.user.id,
      workspaceId: formData.get("workspaceId"),
    });
    revalidateTrials();
    return {
      success: true,
      message: `${trial.trialPlanCodeSnapshot} trial granted successfully.`,
    };
  } catch (error) {
    return safeTrialError(error);
  }
}

export async function cancelTrialAction(
  _previous: TrialFormState,
  formData: FormData,
): Promise<TrialFormState> {
  try {
    const context = await requirePlatformCapability(
      PLATFORM_CAPABILITIES.MANAGE_TRIALS,
    );
    await cancelWorkspaceTrial({
      actorUserId: context.user.id,
      trialId: formData.get("trialId"),
    });
    revalidateTrials();
    return { success: true, message: "The workspace trial was cancelled." };
  } catch (error) {
    return safeTrialError(error);
  }
}
