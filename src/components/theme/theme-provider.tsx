"use client";

import { useEffect, type ReactNode } from "react";

import { applyThemePreference, getThemePreference } from "./theme-store";

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const syncTheme = () => {
      applyThemePreference(getThemePreference());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "civ-theme") {
        syncTheme();
      }
    };

    syncTheme();
    mediaQuery.addEventListener("change", syncTheme);
    window.addEventListener("storage", handleStorage);

    return () => {
      mediaQuery.removeEventListener("change", syncTheme);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return children;
}
