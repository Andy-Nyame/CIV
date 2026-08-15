import Link from "next/link";
import type { ReactNode } from "react";

import { CivLogo } from "@/components/brand/civ-logo";
import { PlatformAdminNavigation } from "@/components/navigation/platform-admin-navigation";
import { ThemeControl } from "@/components/theme/theme-control";
import { signOutAction } from "@/features/auth/actions";
import type { PlatformCapability } from "@/features/platform-admin/capabilities";
import { platformRoleLabel } from "@/features/platform-admin/presentation";
import type { PlatformRole } from "@/generated/prisma/enums";

export function PlatformAdminShell({
  capabilities,
  children,
  role,
  user,
}: {
  capabilities: readonly PlatformCapability[];
  children: ReactNode;
  role: PlatformRole;
  user: { name?: string | null; email?: string | null };
}) {
  const displayName = user.name?.trim() || "CIV operator";

  const operatorPanel = (
    <div className="grid gap-3">
      <div className="min-w-0 rounded-lg bg-surface-muted px-3 py-3">
        <p className="truncate text-sm font-semibold text-text">{displayName}</p>
        {user.email ? (
          <p className="mt-0.5 truncate text-xs text-muted">{user.email}</p>
        ) : null}
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-link">
          {platformRoleLabel(role)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/app"
          className="min-h-11 rounded-lg border border-border px-3 py-2.5 text-center text-sm font-semibold text-text hover:bg-hover"
        >
          CIV App
        </Link>
        <form action={signOutAction}>
          <button className="min-h-11 w-full rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover">
            Sign Out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-page lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a className="skip-link" href="#platform-main-content">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-surface p-5 lg:flex">
        <CivLogo href="/civ-admin" showMotto />
        <div className="mt-6 rounded-lg border border-border bg-surface-muted px-3 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-link">
            Platform Control Center
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Private CIV operations
          </p>
        </div>
        <div className="mt-6">
          <PlatformAdminNavigation capabilities={capabilities} />
        </div>
        <div className="mt-auto grid gap-4 border-t border-border pt-5">
          <ThemeControl />
          {operatorPanel}
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <CivLogo href="/civ-admin" />
            <span className="truncate text-xs font-bold uppercase tracking-wide text-link">
              Control Center
            </span>
          </div>
          <ThemeControl />
        </header>
        <div className="overflow-x-auto border-b border-border bg-surface px-3 py-2 lg:hidden">
          <PlatformAdminNavigation capabilities={capabilities} compact />
        </div>
        <main
          id="platform-main-content"
          className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-9 lg:px-10"
        >
          <div className="mb-6 rounded-xl border border-border bg-surface p-4 lg:hidden">
            {operatorPanel}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
