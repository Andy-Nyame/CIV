export type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "civ-theme";
const THEME_CHANGE_EVENT = "civ-theme-change";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getNextThemePreference(
  preference: ThemePreference,
): ThemePreference {
  if (preference === "system") {
    return "light";
  }

  if (preference === "light") {
    return "dark";
  }

  return "system";
}

export function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") {
    return;
  }

  const resolvedTheme =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;

  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // The selected theme still applies for the current page if storage is unavailable.
  }

  applyThemePreference(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function subscribeToThemePreference(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}
