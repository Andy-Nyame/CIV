import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";

export const authConfig = {
  // Next.js supplies the canonical request host through its server/proxy layer.
  // Auth.js requires this opt-in when the app is self-hosted outside a platform
  // that sets a recognized deployment environment variable.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request }) {
      const isAuthenticated = Boolean(auth?.user);
      const { pathname, search } = request.nextUrl;
      const isAppRoute = pathname === "/app" || pathname.startsWith("/app/");
      const isOnboardingRoute = pathname === "/onboarding";
      const isAuthRoute = pathname === "/login" || pathname === "/signup";

      if ((isAppRoute || isOnboardingRoute) && !isAuthenticated) {
        const loginUrl = new URL("/login", request.nextUrl);
        loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
        return NextResponse.redirect(loginUrl);
      }

      if (isAuthRoute && isAuthenticated) {
        return NextResponse.redirect(new URL("/app", request.nextUrl));
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
