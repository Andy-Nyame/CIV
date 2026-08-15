import "server-only";

import { recordAuditEvent } from "@/features/audit/service";
import { db } from "@/lib/db";
import { createWorkspaceLogoKey } from "@/lib/storage/object-keys";
import { deleteObject, getObject, uploadObject } from "@/lib/storage/object-storage";

import {
  lockWorkspace,
  requireWorkspaceSettingsManagerInTransaction,
  workspaceTransactionOptions,
} from "./authorization";
import { processWorkspaceLogo } from "./logo-image";
import { WorkspaceAssetCleanupError } from "./settings-errors";

export async function saveWorkspaceLogo(input: {
  actorUserId: string;
  workspaceId: string;
  file: File;
}) {
  // Reject unauthorized callers before doing image work or writing an object.
  // The permission is checked again inside the mutation transaction so a role
  // change during upload cannot authorize a stale request.
  await db.$transaction((transaction) =>
    requireWorkspaceSettingsManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    ),
  );

  const image = await processWorkspaceLogo(input.file);
  const key = createWorkspaceLogoKey(input.workspaceId);

  await uploadObject({
    key,
    body: image.body,
    contentType: image.mimeType,
    checksumSha256: image.checksum,
  });

  let previousStorageKey: string | null = null;
  try {
    await db.$transaction(async (transaction) => {
      await lockWorkspace(transaction, input.workspaceId);
      await requireWorkspaceSettingsManagerInTransaction(
        transaction,
        input.actorUserId,
        input.workspaceId,
      );
      const existing = await transaction.workspaceLogo.findUnique({
        where: { workspaceId: input.workspaceId },
        select: { storageKey: true },
      });
      previousStorageKey = existing?.storageKey ?? null;
      await transaction.workspaceLogo.upsert({
        where: { workspaceId: input.workspaceId },
        create: {
          workspaceId: input.workspaceId,
          storageKey: key,
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          sizeBytes: image.sizeBytes,
          checksum: image.checksum,
        },
        update: {
          storageKey: key,
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          sizeBytes: image.sizeBytes,
          checksum: image.checksum,
        },
      });
      await recordAuditEvent(transaction, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "WORKSPACE_LOGO_UPDATED",
        resourceType: "WORKSPACE",
        resourceId: input.workspaceId,
        metadata: {
          replacedExistingLogo: existing !== null,
          mimeType: image.mimeType,
        },
      });
    }, workspaceTransactionOptions);
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }

  let cleanupPending = false;
  if (previousStorageKey && previousStorageKey !== key) {
    try {
      await deleteObject(previousStorageKey);
    } catch {
      cleanupPending = true;
    }
  }

  return { cleanupPending };
}

export async function removeWorkspaceLogo(input: {
  actorUserId: string;
  workspaceId: string;
}) {
  // This preflight prevents an unauthorized caller from using the service to
  // probe or mutate another workspace's private object. The transaction below
  // revalidates the same permission immediately before the destructive step.
  await db.$transaction((transaction) =>
    requireWorkspaceSettingsManagerInTransaction(
      transaction,
      input.actorUserId,
      input.workspaceId,
    ),
  );

  let deletedObject:
    | {
        storageKey: string;
        mimeType: string;
        checksum: string;
        body: Uint8Array;
      }
    | undefined;
  try {
    const removed = await db.$transaction(async (transaction) => {
      await lockWorkspace(transaction, input.workspaceId);
      await requireWorkspaceSettingsManagerInTransaction(
        transaction,
        input.actorUserId,
        input.workspaceId,
      );
      const existing = await transaction.workspaceLogo.findUnique({
        where: { workspaceId: input.workspaceId },
      });
      if (!existing) return false;

      const stored = await getObject(existing.storageKey);
      await deleteObject(existing.storageKey);
      deletedObject = {
        storageKey: existing.storageKey,
        mimeType: existing.mimeType,
        checksum: existing.checksum,
        body: stored.body,
      };

      await transaction.workspaceLogo.delete({
        where: { id: existing.id },
      });
      await recordAuditEvent(transaction, {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: "WORKSPACE_LOGO_REMOVED",
        resourceType: "WORKSPACE",
        resourceId: input.workspaceId,
        metadata: { mimeType: existing.mimeType },
      });
      return true;
    }, workspaceTransactionOptions);
    return { removed };
  } catch (error) {
    if (deletedObject) {
      try {
        await uploadObject({
          key: deletedObject.storageKey,
          body: deletedObject.body,
          contentType: deletedObject.mimeType,
          checksumSha256: deletedObject.checksum,
        });
      } catch {
        throw new WorkspaceAssetCleanupError(true);
      }
    }
    throw error;
  }
}
