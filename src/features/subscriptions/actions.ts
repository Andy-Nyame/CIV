"use server";

import { revalidatePath } from "next/cache";

import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requireCapability } from "@/features/authorization/context";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";

import {
  PlanConfigurationError,
  PlanDowngradeError,
  PlanValidationError,
} from "./errors";
import { changeWorkspacePlan } from "./service";
import type { PlanFormState } from "./types";

function safePlanError(error: unknown): PlanFormState {
  if (error instanceof PlanDowngradeError) {
    return {
      message:
        error.reason === "MEMBERS"
          ? `Cannot switch to ${error.planName}: active members and valid pending invitations reserve ${error.usage} places, but the plan supports ${error.limit}. Reduce members or cancel invitations first.`
          : `Cannot switch to ${error.planName}: this workspace has ${error.usage} issued documents, but the plan supports ${error.limit}.`,
    };
  }
  if (error instanceof PlanValidationError) {
    return { message: "Choose a valid CIV beta plan." };
  }
  if (error instanceof WorkspaceAuthorizationError) {
    return { message: "Only the Workspace Owner can change the plan." };
  }
  if (error instanceof PlanConfigurationError) {
    return { message: "Workspace plan information is temporarily unavailable." };
  }
  return { message: "Unable to change the workspace plan right now." };
}

export async function changeWorkspacePlanAction(
  _previousState: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  try {
    const context = await requireCapability(CAPABILITIES.MANAGE_SUBSCRIPTION);
    const result = await changeWorkspacePlan({
      actorUserId: context.user.id,
      workspaceId: context.workspace.id,
      planCode: formData.get("planCode"),
    });
    revalidatePath("/app/settings/plan");
    revalidatePath("/app/team");
    return {
      success: true,
      message: result.changed
        ? `Workspace switched to ${result.plan.name}.`
        : `${result.plan.name} is already the current plan.`,
    };
  } catch (error) {
    return safePlanError(error);
  }
}
