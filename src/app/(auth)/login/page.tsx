import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthForm } from "@/components/ui/auth-form";
import { getSafeAppCallbackUrl } from "@/features/auth/redirects";

export const metadata: Metadata = {
  title: "Sign In",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const session = await auth();

  if (session?.user) {
    redirect("/app");
  }

  const params = await searchParams;

  return (
    <AuthForm
      mode="login"
      callbackUrl={getSafeAppCallbackUrl(params.callbackUrl)}
    />
  );
}
