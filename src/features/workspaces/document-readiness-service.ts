import "server-only";

import type { DocumentType, Prisma } from "@/generated/prisma/client";
import { isSuperAdminEmail, isSuperAdminUserId } from "@/features/platform-admin/super-admin";
import { db } from "@/lib/db";
import { hasCapability, type Capability } from "@/features/authorization/capabilities";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import type { MembershipRole } from "@/generated/prisma/enums";

import { evaluateWorkspaceDocumentReadiness, WorkspaceDocumentReadinessError } from "./document-readiness";

export const workspaceReadinessSelect = {
  name: true,
  type: true,
  environment: true,
  legalName: true,
  address: true,
  taxpayerIdType: true,
  taxpayerId: true,
  vatRegistered: true,
} as const;

export async function getWorkspaceDocumentReadiness(input: {
  actorUserId: string;
  workspaceId: string;
  documentType?: DocumentType;
}) {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: workspaceReadinessSelect,
  });
  const isSuperAdmin = await isSuperAdminUserId(input.actorUserId);
  return evaluateWorkspaceDocumentReadiness({ workspace, documentType: input.documentType, isSuperAdmin });
}

export async function authorizeWorkspaceDocumentReadinessInTransaction(input: {
  actorUserId: string;
  workspaceId: string;
  documentType?: DocumentType;
  capability: Capability;
}, transaction: Prisma.TransactionClient) {
  const rows = await transaction.$queryRaw<Array<{
    role: MembershipRole;
    email: string | null;
    name: string;
    type: "INDIVIDUAL" | "BUSINESS" | "ORGANIZATION";
    environment: "NORMAL" | "TEST";
    legalName: string | null;
    address: string | null;
    taxpayerIdType: "GHANA_CARD_PIN" | "GRA_TIN" | null;
    taxpayerId: string | null;
    vatRegistered: boolean;
  }>>`
    SELECT m."role"::text AS role, u."email", w."name",
      w."type"::text AS type, w."environment"::text AS environment,
      w."legalName", w."address", w."taxpayerIdType"::text AS "taxpayerIdType",
      w."taxpayerId", w."vatRegistered"
    FROM "Membership" m
    JOIN "User" u ON u."id" = m."userId"
    JOIN "Workspace" w ON w."id" = m."workspaceId"
    WHERE m."userId" = ${input.actorUserId}::uuid
      AND m."workspaceId" = ${input.workspaceId}::uuid
      AND m."status" = 'ACTIVE'::"MembershipStatus"
      AND w."archivedAt" IS NULL
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || !hasCapability({ role: row.role }, input.capability)) throw new WorkspaceAuthorizationError();
  const { role, email, ...workspace } = row;
  const isSuperAdmin = isSuperAdminEmail(email);
  if (workspace.environment === "TEST" && !isSuperAdmin) throw new WorkspaceAuthorizationError();
  const readiness = evaluateWorkspaceDocumentReadiness({
    workspace,
    documentType: input.documentType,
    isSuperAdmin,
  });
  return { readiness, workspace, isSuperAdmin, membership: { role, userId: input.actorUserId, workspaceId: input.workspaceId } };
}

export async function requireWorkspaceDocumentReadinessInTransaction(input: {
  actorUserId: string;
  workspaceId: string;
  documentType?: DocumentType;
  capability: Capability;
}, transaction: Prisma.TransactionClient) {
  const context = await authorizeWorkspaceDocumentReadinessInTransaction(input, transaction);
  if (!context.readiness.ready) throw new WorkspaceDocumentReadinessError(context.readiness.issues);
  return context;
}
