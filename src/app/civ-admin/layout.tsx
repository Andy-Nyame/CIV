import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PlatformAdminShell } from "@/components/layout/platform-admin-shell";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";

export const metadata: Metadata = {
  title: { default: "Platform Control Center", template: "%s | CIV Control Center" },
  robots: { index: false, follow: false },
};

export default async function PlatformAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const context = await requirePlatformPageCapability(
    PLATFORM_CAPABILITIES.VIEW_PLATFORM_DASHBOARD,
  );

  return (
    <PlatformAdminShell
      capabilities={context.capabilities}
      role={context.membership.role}
      user={context.user}
    >
      {children}
    </PlatformAdminShell>
  );
}
