import "server-only";

import { recordAuditEvent } from "@/features/audit/service";
import { db } from "@/lib/db";

import {
  lockWorkspace,
  requireWorkspaceSettingsManagerInTransaction,
  workspaceTransactionOptions,
} from "./authorization";
import { WorkspaceSettingsValidationError } from "./settings-errors";
import { workspaceSettingsSchema } from "./validation";

export async function updateWorkspaceSettings(input: {
  actorUserId: string;
  workspaceId: string;
  values: unknown;
}) {
  const result = workspaceSettingsSchema.safeParse(input.values);
  if (!result.success) {
    throw new WorkspaceSettingsValidationError(result.error.flatten().fieldErrors);
  }

  return db.$transaction(async (transaction) => {
    await lockWorkspace(transaction, input.workspaceId);
    await requireWorkspaceSettingsManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    );

    const current = await transaction.workspace.findUniqueOrThrow({
      where: { id: input.workspaceId },
      select: {
        name: true,
        country: true,
        currency: true,
        email: true,
        phone: true,
        address: true,
        registrationNumber: true,
        businessTin: true,
      },
    });
    const changedFields = Object.entries(result.data)
      .filter(([key, value]) => current[key as keyof typeof current] !== value)
      .map(([key]) => key);

    if (changedFields.length === 0) {
      return { changed: false, workspace: current };
    }

    const workspace = await transaction.workspace.update({
      where: { id: input.workspaceId },
      data: result.data,
      select: {
        id: true,
        name: true,
        type: true,
        country: true,
        currency: true,
        email: true,
        phone: true,
        address: true,
        registrationNumber: true,
        businessTin: true,
      },
    });

    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "WORKSPACE_UPDATED",
      resourceType: "WORKSPACE",
      resourceId: input.workspaceId,
      metadata: { changedFields },
    });

    return { changed: true, workspace };
  }, workspaceTransactionOptions);
}
