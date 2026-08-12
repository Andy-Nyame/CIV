import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthForm } from "@/components/ui/auth-form";
import { getSafeAppCallbackUrl } from "@/features/auth/redirects";

export const metadata: Metadata = {
  title: "Create Account",
};

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const session = await auth();

  if (session?.user) {
    redirect("/app");
  }

  const params = await searchParams;

  return (
    <AuthForm
      mode="signup"
      callbackUrl={getSafeAppCallbackUrl(params.callbackUrl)}
    />
  );
}
