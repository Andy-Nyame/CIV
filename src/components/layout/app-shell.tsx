"use client";

import { useEffect, useState, type ReactNode } from "react";

import { CivLogo } from "@/components/brand/civ-logo";
import { AppNavigation } from "@/components/navigation/app-navigation";
import { ThemeControl } from "@/components/theme/theme-control";
import { CreateDocumentMenu } from "@/components/ui/create-document-menu";

import { UserProfile } from "./profile-placeholder";
import { WorkspaceSwitcher } from "./workspace-switcher";

type AppShellProps = {
  children: ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export function AppShell({ children, user }: AppShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavigationOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const desktopQuery = window.matchMedia("(min-width: 64rem)");

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavigationOpen(false);
      }
    };

    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setMobileNavigationOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    desktopQuery.addEventListener("change", closeAtDesktop);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      desktopQuery.removeEventListener("change", closeAtDesktop);
    };
  }, [mobileNavigationOpen]);

  return (
    <div className="min-h-screen bg-page lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-surface p-5 lg:flex">
        <CivLogo href="/app" showMotto />
        <div className="mt-8 grid gap-4">
          <WorkspaceSwitcher />
          <CreateDocumentMenu />
        </div>
        <div className="mt-6">
          <AppNavigation />
        </div>
        <div className="mt-auto grid gap-4 border-t border-border pt-5">
          <ThemeControl />
          <UserProfile user={user} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <CivLogo href="/app" />
          <div className="flex items-center gap-2">
            <CreateDocumentMenu compact />
            <button
              type="button"
              className="grid size-11 place-items-center rounded-lg border border-border bg-surface text-text hover:bg-hover"
              aria-label="Open navigation"
              aria-expanded={mobileNavigationOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileNavigationOpen(true)}
            >
              <span aria-hidden="true" className="grid gap-1">
                <span className="block h-0.5 w-5 rounded bg-current" />
                <span className="block h-0.5 w-5 rounded bg-current" />
                <span className="block h-0.5 w-5 rounded bg-current" />
              </span>
            </button>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-9 lg:px-10">
          {children}
        </main>
      </div>

      {mobileNavigationOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-civ-navy/55"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavigationOpen(false)}
          />
          <aside
            id="mobile-navigation"
            className="absolute inset-y-0 right-0 flex w-[min(22rem,88vw)] flex-col overflow-y-auto border-l border-border bg-surface p-5"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <div className="flex items-center justify-between gap-4">
              <CivLogo href="/app" showMotto />
              <button
                type="button"
                className="grid size-11 shrink-0 place-items-center rounded-lg text-2xl text-text hover:bg-hover"
                aria-label="Close navigation"
                onClick={() => setMobileNavigationOpen(false)}
                autoFocus
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="mt-7 grid gap-5">
              <WorkspaceSwitcher />
              <CreateDocumentMenu />
              <AppNavigation onNavigate={() => setMobileNavigationOpen(false)} />
            </div>
            <div className="mt-auto grid gap-4 border-t border-border pt-5">
              <ThemeControl />
              <UserProfile user={user} />
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
