import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthForm } from "@/components/ui/auth-form";

export const metadata: Metadata = {
  title: "Create Account",
};

export default async function SignupPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/app");
  }

  return <AuthForm mode="signup" />;
}
