"use client";

import { useSyncExternalStore } from "react";

import {
  getNextThemePreference,
  getThemePreference,
  setThemePreference,
  subscribeToThemePreference,
  type ThemePreference,
} from "./theme-store";

const themeLabels: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  if (theme === "light") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
      </svg>
    );
  }

  if (theme === "dark") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.5 15.4A8.5 8.5 0 0 1 8.6 3.5a8.5 8.5 0 1 0 11.9 11.9Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

export function ThemeControl() {
  const theme = useSyncExternalStore<ThemePreference>(
    subscribeToThemePreference,
    getThemePreference,
    () => "system",
  );

  const label = themeLabels[theme];

  return (
    <button
      type="button"
      className="grid size-11 place-items-center rounded-lg border border-border bg-surface text-text hover:bg-hover"
      aria-label={`Theme: ${label}. Change theme.`}
      title={label}
      onClick={() => setThemePreference(getNextThemePreference(theme))}
    >
      <ThemeIcon theme={theme} />
    </button>
  );
}
