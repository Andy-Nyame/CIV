"use server";

import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/features/authorization/capabilities";
import { authorizeWorkspaceById } from "@/features/authorization/context";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { requireUser } from "@/features/auth/session";

import {
  setActiveWorkspaceCookie,
} from "./access";
import {
  createWorkspace,
  WorkspaceConfigurationError,
  WorkspaceValidationError,
} from "./service";
import type { WorkspaceFormState } from "./types";

export async function createWorkspaceAction(
  _previousState: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();

  try {
    const workspace = await createWorkspace({
      userId: user.id,
      input: {
        type: formData.get("type"),
        name: formData.get("name"),
      },
    });

    await setActiveWorkspaceCookie(workspace.id);
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      return {
        message: "Check the highlighted fields and try again.",
        fieldErrors: error.fieldErrors,
      };
    }

    if (error instanceof WorkspaceConfigurationError) {
      return {
        message:
          "Workspace setup is temporarily unavailable. Please try again later.",
      };
    }

    return {
      message: "Unable to create your workspace right now. Please try again.",
    };
  }

  redirect("/app");
}

export async function switchWorkspaceAction(formData: FormData) {
  const user = await requireUser();

  try {
    const authorization = await authorizeWorkspaceById(
      user.id,
      formData.get("workspaceId"),
      CAPABILITIES.VIEW_WORKSPACE,
    );
    await setActiveWorkspaceCookie(authorization.workspace.id);
  } catch (error) {
    if (!(error instanceof WorkspaceAuthorizationError)) {
      throw error;
    }
  }

  redirect("/app");
}
