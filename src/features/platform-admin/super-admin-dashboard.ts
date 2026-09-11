import "server-only";

import { evaluateWorkspaceDocumentReadiness } from "@/features/workspaces/document-readiness";
import { workspaceIdSchema } from "@/features/workspaces/validation";
import { db } from "@/lib/db";

import { requireSuperAdminActor } from "./super-admin";

export const SUPER_ADMIN_WORKSPACE_PAGE_SIZE = 20;
export const CIV_DOCUMENT_TYPES = ["INVOICE", "RECEIPT", "VAT_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"] as const;

export class SuperAdminWorkspaceNotFoundError extends Error {
  constructor() {
    super("Workspace not found.");
    this.name = "SuperAdminWorkspaceNotFoundError";
  }
}

function normalizedPage(value: unknown) {
  const number = typeof value === "string" ? Number(value) : Number(value ?? 1);
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

export function maskTaxpayerId(value: string | null) {
  const identifier = value?.trim();
  if (!identifier) return null;
  if (identifier.length <= 4) return "••••";
  const visibleCharacters = identifier.length > 6 ? 4 : 2;
  return `${"•".repeat(Math.max(4, Math.min(8, identifier.length - visibleCharacters)))}${identifier.slice(-visibleCharacters)}`;
}

export async function getSuperAdminDashboard(input: {
  actorUserId: unknown;
  page?: unknown;
}) {
  await requireSuperAdminActor(input.actorUserId);
  const requestedPage = normalizedPage(input.page);

  const [totalUsers, workspaceGroups, documentGroups] = await Promise.all([
    db.user.count(),
    db.workspace.groupBy({ by: ["environment"], _count: { _all: true } }),
    db.document.groupBy({ by: ["status", "isTestDocument"], _count: { _all: true } }),
  ]);

  const totalWorkspaces = workspaceGroups.reduce((total, group) => total + group._count._all, 0);
  const totalDocuments = documentGroups.reduce((total, group) => total + group._count._all, 0);
  const totalPages = Math.max(1, Math.ceil(totalWorkspaces / SUPER_ADMIN_WORKSPACE_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const rawWorkspaces = await db.workspace.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * SUPER_ADMIN_WORKSPACE_PAGE_SIZE,
    take: SUPER_ADMIN_WORKSPACE_PAGE_SIZE,
    select: {
      id: true,
      name: true,
      type: true,
      environment: true,
      legalName: true,
      address: true,
      taxpayerIdType: true,
      taxpayerId: true,
      taxpayerVerificationStatus: true,
      vatRegistered: true,
      vatRegistrationStatus: true,
      vatRegistrationEffectiveDate: true,
      vatDeregistrationEffectiveDate: true,
      createdAt: true,
      archivedAt: true,
      memberships: {
        where: { role: "OWNER", status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { user: { select: { name: true, email: true } } },
      },
      _count: { select: { documents: true } },
    },
  });
  const workspaces = rawWorkspaces.map((workspace) => {
    const readiness = evaluateWorkspaceDocumentReadiness({ workspace, isSuperAdmin: true });
    return {
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      environment: workspace.environment,
      taxpayerVerificationStatus: workspace.taxpayerVerificationStatus,
      vatRegistered: workspace.vatRegistered,
      createdAt: workspace.createdAt,
      archivedAt: workspace.archivedAt,
      owner: workspace.memberships[0]?.user ?? null,
      taxpayerIdPresent: Boolean(workspace.taxpayerId?.trim()),
      taxpayerReady: readiness.ready,
      readinessIssues: readiness.issues.map(({ code, message }) => ({ code, message })),
      documentCount: workspace._count.documents,
    };
  });

  return {
    metrics: {
      totalUsers,
      totalWorkspaces,
      normalWorkspaces: workspaceGroups.find(({ environment }) => environment === "NORMAL")?._count._all ?? 0,
      testWorkspaces: workspaceGroups.find(({ environment }) => environment === "TEST")?._count._all ?? 0,
      totalDocuments,
      issuedDocuments: documentGroups.filter(({ status }) => status === "ISSUED").reduce((total, group) => total + group._count._all, 0),
      testDocuments: documentGroups.filter(({ isTestDocument }) => isTestDocument).reduce((total, group) => total + group._count._all, 0),
    },
    workspaces,
    pagination: { page, totalPages, pageSize: SUPER_ADMIN_WORKSPACE_PAGE_SIZE, totalItems: totalWorkspaces },
    system: {
      applicationEnvironment: process.env.APP_ENV === "production" ? "Production" as const : "Development" as const,
      databaseStatus: "Connected" as const,
      documentTypes: CIV_DOCUMENT_TYPES,
      superAdminAccess: true as const,
    },
  };
}

export async function getSuperAdminWorkspaceDetail(input: {
  actorUserId: unknown;
  workspaceId: unknown;
}) {
  await requireSuperAdminActor(input.actorUserId);
  const actorUserId = input.actorUserId as string;
  const parsedWorkspaceId = workspaceIdSchema.safeParse(input.workspaceId);
  if (!parsedWorkspaceId.success) throw new SuperAdminWorkspaceNotFoundError();

  const [workspace, documentGroups, membershipGroups, viewerMembership] = await Promise.all([
    db.workspace.findUnique({
      where: { id: parsedWorkspaceId.data },
      select: {
        id: true,
        name: true,
        type: true,
        environment: true,
        legalName: true,
        tradingName: true,
        address: true,
        taxpayerIdType: true,
        taxpayerId: true,
        taxpayerVerificationStatus: true,
        vatRegistered: true,
        vatRegistrationStatus: true,
        vatRegistrationEffectiveDate: true,
        vatDeregistrationEffectiveDate: true,
        createdAt: true,
        updatedAt: true,
        archivedAt: true,
        memberships: {
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          take: 50,
          select: {
            id: true,
            role: true,
            status: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        _count: { select: { memberships: true, documents: true } },
      },
    }),
    db.document.groupBy({ where: { workspaceId: parsedWorkspaceId.data }, by: ["status", "isTestDocument"], _count: { _all: true } }),
    db.membership.groupBy({ where: { workspaceId: parsedWorkspaceId.data }, by: ["status"], _count: { _all: true } }),
    db.membership.findFirst({
      where: { workspaceId: parsedWorkspaceId.data, userId: actorUserId, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  if (!workspace) throw new SuperAdminWorkspaceNotFoundError();

  const { taxpayerId, _count, ...safeWorkspace } = workspace;
  const readiness = evaluateWorkspaceDocumentReadiness({ workspace: { ...safeWorkspace, taxpayerId }, isSuperAdmin: true });
  return {
    workspace: {
      ...safeWorkspace,
      taxpayerIdPresent: Boolean(taxpayerId?.trim()),
      maskedTaxpayerId: maskTaxpayerId(taxpayerId),
      taxpayerReady: readiness.ready,
      readinessIssues: readiness.issues.map(({ code, message }) => ({ code, message })),
      membershipCount: _count.memberships,
      documentCount: _count.documents,
      viewerCanOpen: viewerMembership !== null,
    },
    documentSummary: {
      total: documentGroups.reduce((total, group) => total + group._count._all, 0),
      drafts: documentGroups.filter(({ status }) => status === "DRAFT").reduce((total, group) => total + group._count._all, 0),
      issued: documentGroups.filter(({ status }) => status === "ISSUED").reduce((total, group) => total + group._count._all, 0),
      voided: documentGroups.filter(({ status }) => status === "VOIDED").reduce((total, group) => total + group._count._all, 0),
      test: documentGroups.filter(({ isTestDocument }) => isTestDocument).reduce((total, group) => total + group._count._all, 0),
    },
    membershipSummary: Object.fromEntries(membershipGroups.map(({ status, _count }) => [status, _count._all])),
  };
}
