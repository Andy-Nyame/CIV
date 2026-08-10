import type { Metadata } from "next";

import { AuthForm } from "@/components/ui/auth-form";

export const metadata: Metadata = {
  title: "Sign In",
};

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
