import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export { auth as proxy };

export const config = {
  matcher: ["/app/:path*", "/login", "/signup"],
};
