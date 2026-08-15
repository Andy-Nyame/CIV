import "server-only";

import {
  PLATFORM_CAPABILITIES,
  hasPlatformCapability,
} from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { db } from "@/lib/db";

import { expireDueWorkspaceTrials } from "./entitlements";

export async function getTrialManagementPageData() {
  const context = await requirePlatformPageCapability(
    PLATFORM_CAPABILITIES.VIEW_TRIALS,
  );
  const now = new Date();
  await expireDueWorkspaceTrials(now);

  const [configuration, plans, trials, statusGroups, candidates, activeTrials] =
    await Promise.all([
      db.trialConfiguration.findUnique({
        where: { id: "GLOBAL" },
        include: {
          trialPlan: { select: { code: true, name: true } },
          fallbackPlan: { select: { code: true, name: true } },
        },
      }),
      db.plan.findMany({
        where: { isActive: true },
        select: { code: true, name: true, isAvailableForNewWorkspaces: true },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      }),
      db.workspaceTrial.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          grantSource: true,
          trialPlanCodeSnapshot: true,
          trialPlanNameSnapshot: true,
          fallbackPlanCodeSnapshot: true,
          workspace: { select: { id: true, name: true } },
          grantedBy: { select: { name: true, email: true } },
          fallbackPlan: { select: { memberLimit: true } },
        },
      }),
      db.workspaceTrial.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      db.workspace.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          name: true,
          subscription: { select: { plan: { select: { name: true } } } },
          _count: { select: { trials: true } },
        },
      }),
      db.workspaceTrial.findMany({
        where: { status: "ACTIVE", endsAt: { gt: now } },
        select: {
          workspaceId: true,
          fallbackPlan: { select: { memberLimit: true } },
        },
      }),
    ]);

  const activeWorkspaceIds = activeTrials.map((trial) => trial.workspaceId);
  const memberGroups = activeWorkspaceIds.length
    ? await db.membership.groupBy({
        by: ["workspaceId"],
        where: { workspaceId: { in: activeWorkspaceIds }, status: "ACTIVE" },
        _count: { _all: true },
      })
    : [];
  const memberCounts = new Map(
    memberGroups.map((group) => [group.workspaceId, group._count._all]),
  );

  const totals = Object.fromEntries(
    statusGroups.map((group) => [group.status, group._count._all]),
  ) as Partial<Record<"ACTIVE" | "EXPIRED" | "CANCELLED" | "CONVERTED", number>>;

  const trialsByPlan = await db.workspaceTrial.groupBy({
    by: ["trialPlanCodeSnapshot"],
    _count: { _all: true },
    orderBy: { trialPlanCodeSnapshot: "asc" },
  });

  return {
    configuration,
    plans,
    trials,
    candidates,
    canManage: hasPlatformCapability(
      context.membership,
      PLATFORM_CAPABILITIES.MANAGE_TRIALS,
    ),
    analytics: {
      total: statusGroups.reduce((sum, group) => sum + group._count._all, 0),
      active: totals.ACTIVE ?? 0,
      expired: totals.EXPIRED ?? 0,
      cancelled: totals.CANCELLED ?? 0,
      converted: totals.CONVERTED ?? 0,
      overFallbackMemberLimit: activeTrials.filter((trial) => {
        const limit = trial.fallbackPlan.memberLimit;
        return limit !== null && (memberCounts.get(trial.workspaceId) ?? 0) > limit;
      }).length,
      byPlan: trialsByPlan.map((group) => ({
        code: group.trialPlanCodeSnapshot,
        count: group._count._all,
      })),
    },
  };
}
