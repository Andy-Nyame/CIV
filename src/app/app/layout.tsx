import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { requireUser } from "@/features/auth/session";
import { getWorkspaceCommercialSummary } from "@/features/commercial/workspace-summary";
import { getPersonalProfilePhotoUrl } from "@/features/profile/queries";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";

export default async function CivAppLayout({ children }: LayoutProps<"/app">) {
  const user = await requireUser();
  const workspaceContext = await getWorkspaceContextForUser(user.id);

  if (!workspaceContext.current) {
    redirect("/onboarding");
  }

  const privateProfilePhotoUrl = await getPersonalProfilePhotoUrl(user.id);
  const commercialSummary = await getWorkspaceCommercialSummary(
    workspaceContext.current.id,
  );
  const trialDaysRemaining = commercialSummary.activeTrial
    ? Math.max(
        1,
        Math.ceil(
          (commercialSummary.activeTrial.endsAt.getTime() -
            commercialSummary.resolvedAt.getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      )
    : null;
  const workspaceCommercialIndicator = {
    planLabel: commercialSummary.activeTrial
      ? `${commercialSummary.effectivePlan.name} Trial`
      : commercialSummary.effectivePlan.name,
    detail:
      trialDaysRemaining !== null
        ? trialDaysRemaining === 1
          ? "1 day remaining"
          : `${trialDaysRemaining} days remaining`
        : commercialSummary.totalAvailable === null
          ? "Unlimited available"
          : `${commercialSummary.totalAvailable.toLocaleString("en-GH")} available`,
  };

  return (
    <AppShell
      user={user}
      privateProfilePhotoUrl={privateProfilePhotoUrl}
      workspaceCommercialIndicator={workspaceCommercialIndicator}
      workspaceContext={workspaceContext}
      canViewTeam={hasCapability(
        workspaceContext.current,
        CAPABILITIES.VIEW_TEAM,
      )}
      canViewActivity={hasCapability(
        workspaceContext.current,
        CAPABILITIES.VIEW_AUDIT_LOG,
      )}
    >
      {children}
    </AppShell>
  );
}
