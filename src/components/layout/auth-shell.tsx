import type { ReactNode } from "react";

import { CivLogo } from "@/components/brand/civ-logo";
import { ThemeControl } from "@/components/theme/theme-control";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="flex min-h-18 items-center justify-between border-b border-border bg-surface px-5 sm:px-8">
        <CivLogo href="/" />
        <ThemeControl />
      </header>
      <main
        id="main-content"
        className="grid flex-1 place-items-center px-5 py-10 sm:px-8"
      >
        {children}
      </main>
    </div>
  );
}
