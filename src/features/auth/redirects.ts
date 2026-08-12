export function getSafeAppCallbackUrl(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/app";
  }

  const url = new URL(value, "https://civ.local");
  const isInvitationRoute = /^\/invite\/[A-Za-z0-9_-]{43}$/.test(
    url.pathname,
  );

  if (
    url.pathname !== "/app" &&
    !url.pathname.startsWith("/app/") &&
    !isInvitationRoute
  ) {
    return "/app";
  }

  return `${url.pathname}${url.search}`;
}
