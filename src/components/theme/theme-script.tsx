const themeScript = `
(() => {
  const getPreference = () => {
    try {
      const stored = localStorage.getItem("civ-theme");
      return stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
    } catch {
      return "system";
    }
  };

  const preference = getPreference();
  const resolved = preference === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;

  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
