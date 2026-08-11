export function getSafeAppCallbackUrl(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/app";
  }

  const url = new URL(value, "https://civ.local");

  if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) {
    return "/app";
  }

  return `${url.pathname}${url.search}`;
}
