import "server-only";

import type { DocumentType, Prisma } from "@/generated/prisma/client";
import { isSuperAdminEmail, isSuperAdminUserId } from "@/features/platform-admin/super-admin";
import { db } from "@/lib/db";
import { hasCapability, type Capability } from "@/features/authorization/capabilities";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";

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
  vatRegistrationStatus: true,
  vatRegistrationEffectiveDate: true,
  vatDeregistrationEffectiveDate: true,
  vatSalesReceiptAuthorization: true,
} as const;

export async function getWorkspaceDocumentReadiness(input: {
  actorUserId: string;
  workspaceId: string;
  documentType?: DocumentType;
  taxPointDate?: Date | string;
}) {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: workspaceReadinessSelect,
  });
  const isSuperAdmin = await isSuperAdminUserId(input.actorUserId);
  return evaluateWorkspaceDocumentReadiness({ workspace, documentType: input.documentType, taxPointDate: input.taxPointDate, isSuperAdmin });
}

export async function authorizeWorkspaceDocumentReadinessInTransaction(input: {
  actorUserId: string;
  workspaceId: string;
  documentType?: DocumentType;
  taxPointDate?: Date | string;
  capability: Capability;
}, transaction: Prisma.TransactionClient) {
  const membership = await transaction.membership.findFirst({
    where: {
      userId: input.actorUserId,
      workspaceId: input.workspaceId,
      status: "ACTIVE",
      workspace: { archivedAt: null },
    },
    select: {
      role: true,
      user: { select: { email: true } },
      workspace: { select: workspaceReadinessSelect },
    },
  });
  if (!membership || !hasCapability({ role: membership.role }, input.capability)) throw new WorkspaceAuthorizationError();
  const { role, user: { email }, workspace } = membership;
  const isSuperAdmin = isSuperAdminEmail(email);
  if (workspace.environment === "TEST" && !isSuperAdmin) throw new WorkspaceAuthorizationError();
  const readiness = evaluateWorkspaceDocumentReadiness({
    workspace,
    documentType: input.documentType,
    taxPointDate: input.taxPointDate,
    isSuperAdmin,
  });
  return { readiness, workspace, isSuperAdmin, membership: { role, userId: input.actorUserId, workspaceId: input.workspaceId } };
}

export async function requireWorkspaceDocumentReadinessInTransaction(input: {
  actorUserId: string;
  workspaceId: string;
  documentType?: DocumentType;
  taxPointDate?: Date | string;
  capability: Capability;
}, transaction: Prisma.TransactionClient) {
  const context = await authorizeWorkspaceDocumentReadinessInTransaction(input, transaction);
  if (!context.readiness.ready) throw new WorkspaceDocumentReadinessError(context.readiness.issues);
  return context;
}
