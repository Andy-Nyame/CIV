import "server-only";

import { recordAuditEvent } from "@/features/audit/service";
import { isSuperAdminUserId } from "@/features/platform-admin/super-admin";
import { db } from "@/lib/db";

import {
  lockWorkspace,
  requireWorkspaceSettingsManagerInTransaction,
  workspaceTransactionOptions,
} from "./authorization";
import { expectedTaxpayerIdType } from "./document-readiness";
import { WorkspaceSettingsValidationError, WorkspaceTestModeError } from "./settings-errors";
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
        type: true,
        name: true,
        country: true,
        currency: true,
        email: true,
        phone: true,
        address: true,
        registrationNumber: true,
        businessTin: true,
        legalName: true,
        tradingName: true,
        taxpayerId: true,
        taxpayerIdType: true,
        taxpayerVerificationStatus: true,
        vatRegistered: true,
      },
    });
    const nextType = result.data.type ?? current.type;
    const data = {
      ...result.data,
      ...(result.data.taxpayerId !== undefined || result.data.type !== undefined
        ? { taxpayerIdType: expectedTaxpayerIdType(nextType) }
        : {}),
      ...(result.data.taxpayerId !== undefined || result.data.type !== undefined
        ? { businessTin: nextType === "INDIVIDUAL" ? null : result.data.taxpayerId ?? current.taxpayerId ?? current.businessTin }
        : {}),
      ...((result.data.taxpayerId !== undefined && result.data.taxpayerId !== current.taxpayerId) ||
      (result.data.type !== undefined && result.data.type !== current.type)
        ? { taxpayerVerificationStatus: "UNVERIFIED" as const }
        : {}),
    };
    const changedFields = Object.entries(data)
      .filter(([key, value]) => current[key as keyof typeof current] !== value)
      .map(([key]) => key);

    if (changedFields.length === 0) {
      return { changed: false, workspace: current };
    }

    const workspace = await transaction.workspace.update({
      where: { id: input.workspaceId },
      data,
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
        environment: true,
        legalName: true,
        tradingName: true,
        taxpayerId: true,
        taxpayerIdType: true,
        taxpayerVerificationStatus: true,
        vatRegistered: true,
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

export async function enableWorkspaceTestMode(input: {
  actorUserId: string;
  workspaceId: string;
}) {
  return db.$transaction(async (transaction) => {
    await lockWorkspace(transaction, input.workspaceId);
    await requireWorkspaceSettingsManagerInTransaction(transaction, input.actorUserId, input.workspaceId);
    if (!(await isSuperAdminUserId(input.actorUserId, transaction))) {
      throw new WorkspaceTestModeError("SUPER_ADMIN_REQUIRED");
    }
    const workspace = await transaction.workspace.findUniqueOrThrow({
      where: { id: input.workspaceId },
      select: { environment: true, _count: { select: { documents: true } } },
    });
    if (workspace.environment === "TEST") throw new WorkspaceTestModeError("ALREADY_TEST");
    if (workspace._count.documents > 0) throw new WorkspaceTestModeError("DOCUMENTS_EXIST");
    await transaction.workspace.update({ where: { id: input.workspaceId }, data: { environment: "TEST" } });
    await recordAuditEvent(transaction, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "WORKSPACE_UPDATED",
      resourceType: "WORKSPACE",
      resourceId: input.workspaceId,
      metadata: { changedFields: ["environment"] },
    });
    return { environment: "TEST" as const };
  }, workspaceTransactionOptions);
}
