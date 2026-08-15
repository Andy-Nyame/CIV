import "server-only";

import { z } from "zod";

import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";
import { db } from "@/lib/db";

export const activityPageSize = 20;

const activityCursorSchema = z.string().uuid();

export async function listWorkspaceAuditEvents(
  workspaceId: string,
  cursorInput: unknown,
) {
  const cursorResult = activityCursorSchema.safeParse(cursorInput);
  const cursor = cursorResult.success
    ? await db.auditEvent.findFirst({
        where: {
          id: cursorResult.data,
          workspaceId,
        },
        select: { id: true, createdAt: true },
      })
    : null;

  const events = await db.auditEvent.findMany({
    where: {
      workspaceId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: activityPageSize + 1,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });
  const hasMore = events.length > activityPageSize;
  const pageEvents = events.slice(0, activityPageSize);

  return {
    events: pageEvents,
    hasMore,
    hasPreviousPage: Boolean(cursor),
    nextCursor: hasMore ? pageEvents.at(-1)?.id ?? null : null,
  };
}

export async function getActivityPageData(cursorInput: unknown) {
  const context = await requirePageCapability(CAPABILITIES.VIEW_AUDIT_LOG);
  const page = await listWorkspaceAuditEvents(
    context.workspace.id,
    cursorInput,
  );

  return { workspace: context.workspace, ...page };
}
