import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import {
  CAPABILITIES,
  hasCapability,
} from "@/features/authorization/capabilities";
import { requireUser } from "@/features/auth/session";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";

export default async function CivAppLayout({ children }: LayoutProps<"/app">) {
  const user = await requireUser();
  const workspaceContext = await getWorkspaceContextForUser(user.id);

  if (!workspaceContext.current) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      user={user}
      workspaceContext={workspaceContext}
      canViewTeam={hasCapability(
        workspaceContext.current,
        CAPABILITIES.VIEW_TEAM,
      )}
    >
      {children}
    </AppShell>
  );
}
