import "server-only";

import packageJson from "../../../package.json";

import { readR2Config } from "@/lib/storage/config";
import { db } from "@/lib/db";

const planOrder = ["FREE", "STARTER", "BUSINESS", "PRO", "ENTERPRISE"];

function orderPlans<T extends { code: string }>(plans: T[]) {
  return plans.sort(
    (left, right) =>
      planOrder.indexOf(left.code) - planOrder.indexOf(right.code),
  );
}

export async function getPlatformOverview(input: {
  includeAuthAnalytics: boolean;
  includeStorageAnalytics: boolean;
}) {
  const now = new Date();
  const [
    totalUsers,
    totalWorkspaces,
    activeWorkspaces,
    archivedWorkspaces,
    totalMemberships,
    pendingInvitations,
    totalAuditEvents,
    plans,
    profilePhotos,
    signatures,
    workspaceLogos,
    passwordUsers,
    googleAccountLinks,
  ] = await Promise.all([
    db.user.count(),
    db.workspace.count(),
    db.workspace.count({ where: { archivedAt: null } }),
    db.workspace.count({ where: { archivedAt: { not: null } } }),
    db.membership.count(),
    db.invitation.count({
      where: { status: "PENDING", expiresAt: { gt: now } },
    }),
    db.auditEvent.count(),
    db.plan.findMany({
      select: {
        code: true,
        name: true,
        _count: { select: { subscriptions: true } },
      },
    }),
    input.includeStorageAnalytics ? db.profilePhoto.count() : Promise.resolve(0),
    input.includeStorageAnalytics
      ? db.signatureProfile.count()
      : Promise.resolve(0),
    input.includeStorageAnalytics
      ? db.workspaceLogo.count()
      : Promise.resolve(0),
    input.includeAuthAnalytics
      ? db.user.count({ where: { passwordHash: { not: null } } })
      : Promise.resolve(0),
    input.includeAuthAnalytics
      ? db.account.count({ where: { provider: "google" } })
      : Promise.resolve(0),
  ]);

  return {
    totalUsers,
    totalWorkspaces,
    activeWorkspaces,
    archivedWorkspaces,
    totalMemberships,
    pendingInvitations,
    totalAuditEvents,
    planDistribution: orderPlans(plans).map((plan) => ({
      code: plan.code,
      name: plan.name,
      workspaces: plan._count.subscriptions,
    })),
    storage: input.includeStorageAnalytics
      ? {
          profilePhotos,
          signatures,
          workspaceLogos,
          total: profilePhotos + signatures + workspaceLogos,
        }
      : null,
    authentication: input.includeAuthAnalytics
      ? { passwordUsers, googleAccountLinks }
      : null,
  };
}

export async function listPlatformUsers() {
  const users = await db.user.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      passwordHash: true,
      accounts: {
        where: { provider: "google" },
        select: { provider: true },
        take: 1,
      },
      platformMembership: { select: { role: true, status: true } },
      _count: { select: { memberships: true } },
    },
  });

  return users.map(({ passwordHash, accounts, _count, ...user }) => ({
    ...user,
    hasPassword: passwordHash !== null,
    hasGoogle: accounts.length > 0,
    workspaceMemberships: _count.memberships,
  }));
}

export async function listPlatformWorkspaces() {
  const now = new Date();
  return db.workspace.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      name: true,
      type: true,
      createdAt: true,
      archivedAt: true,
      memberships: {
        where: { role: "OWNER", status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { user: { select: { name: true, email: true } } },
      },
      subscription: {
        select: { status: true, plan: { select: { code: true, name: true } } },
      },
      _count: {
        select: {
          memberships: { where: { status: "ACTIVE" } },
          invitations: {
            where: { status: "PENDING", expiresAt: { gt: now } },
          },
        },
      },
    },
  });
}

export async function listPlatformPlans() {
  const plans = await db.plan.findMany({
    select: {
      code: true,
      name: true,
      memberLimit: true,
      documentLimit: true,
      betaPrice: true,
      currency: true,
      isActive: true,
      isPublic: true,
      _count: { select: { subscriptions: true } },
    },
  });

  return orderPlans(plans).map(({ betaPrice, _count, ...plan }) => ({
    ...plan,
    betaPrice: betaPrice.toFixed(2),
    workspaces: _count.subscriptions,
  }));
}

async function assetAggregate(
  model: "profilePhoto" | "signatureProfile" | "workspaceLogo",
) {
  if (model === "profilePhoto") {
    return db.profilePhoto.aggregate({
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
  }
  if (model === "signatureProfile") {
    return db.signatureProfile.aggregate({
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
  }
  return db.workspaceLogo.aggregate({
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });
}

export async function getPlatformStorageAnalytics() {
  const [profilePhotos, signatures, workspaceLogos] = await Promise.all([
    assetAggregate("profilePhoto"),
    assetAggregate("signatureProfile"),
    assetAggregate("workspaceLogo"),
  ]);

  const categories = [
    {
      label: "Profile photos",
      count: profilePhotos._count._all,
      sizeBytes: profilePhotos._sum.sizeBytes ?? 0,
    },
    {
      label: "Personal signatures",
      count: signatures._count._all,
      sizeBytes: signatures._sum.sizeBytes ?? 0,
    },
    {
      label: "Workspace logos",
      count: workspaceLogos._count._all,
      sizeBytes: workspaceLogos._sum.sizeBytes ?? 0,
    },
  ];

  return {
    categories,
    totalCount: categories.reduce((total, category) => total + category.count, 0),
    totalSizeBytes: categories.reduce(
      (total, category) => total + category.sizeBytes,
      0,
    ),
  };
}

export async function getPlatformActivitySummary() {
  const [actionCounts, recentEvents, platformActionCounts, platformEvents] =
    await Promise.all([
    db.auditEvent.groupBy({
      by: ["action"],
      _count: { _all: true },
    }),
    db.auditEvent.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25,
      select: {
        id: true,
        action: true,
        createdAt: true,
        workspace: { select: { type: true } },
      },
    }),
    db.platformAuditEvent.groupBy({
      by: ["action"],
      _count: { _all: true },
    }),
    db.platformAuditEvent.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25,
      select: {
        id: true,
        action: true,
        actorDisplayName: true,
        resourceType: true,
        metadata: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    actionCounts: actionCounts
      .map((entry) => ({ action: entry.action, count: entry._count._all }))
      .sort((left, right) => right.count - left.count),
    recentEvents,
    platformActionCounts: platformActionCounts
      .map((entry) => ({ action: entry.action, count: entry._count._all }))
      .sort((left, right) => right.count - left.count),
    platformEvents: platformEvents.map(({ metadata, ...event }) => ({
      ...event,
      context: metadata,
    })),
  };
}

export async function getPlatformSystemStatus() {
  let databaseConnected = false;
  try {
    await db.$queryRaw<[{ connected: number }]>`SELECT 1 AS connected`;
    databaseConnected = true;
  } catch {
    databaseConnected = false;
  }

  let storageConfigured = false;
  try {
    readR2Config();
    storageConfigured = true;
  } catch {
    storageConfigured = false;
  }

  const appEnvironment =
    process.env.APP_ENV === "production" ? "Production" : "Development";

  return {
    appEnvironment,
    databaseConnected,
    storageConfigured,
    appVersion: packageJson.version,
    buildIdentifier:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "Development build",
  };
}
