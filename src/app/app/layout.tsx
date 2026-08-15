import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { requireUser } from "@/features/auth/session";
import { getPersonalProfilePhotoUrl } from "@/features/profile/queries";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";

export default async function CivAppLayout({ children }: LayoutProps<"/app">) {
  const user = await requireUser();
  const workspaceContext = await getWorkspaceContextForUser(user.id);

  if (!workspaceContext.current) {
    redirect("/onboarding");
  }

  const privateProfilePhotoUrl = await getPersonalProfilePhotoUrl(user.id);

  return (
    <AppShell
      user={user}
      privateProfilePhotoUrl={privateProfilePhotoUrl}
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
