"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";
import { hashPassword } from "@/features/auth/password";
import { getSafeAppCallbackUrl } from "@/features/auth/redirects";
import type { AuthFormState } from "@/features/auth/types";
import { loginSchema, signupSchema } from "@/features/auth/validation";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

const invalidCredentialsMessage = "Invalid email or password.";
const accountExistsMessage =
  "An account with this email already exists. Sign in instead.";

export async function loginAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return {
      fieldErrors: result.error.flatten().fieldErrors,
      message: "Check the highlighted fields and try again.",
    };
  }

  try {
    await signIn("credentials", {
      ...result.data,
      redirectTo: getSafeAppCallbackUrl(formData.get("callbackUrl")),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { message: invalidCredentialsMessage };
    }

    throw error;
  }

  return {};
}

export async function signupAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return {
      fieldErrors: result.error.flatten().fieldErrors,
      message: "Check the highlighted fields and try again.",
    };
  }

  const existingUser = await db.user.findUnique({
    where: { email: result.data.email },
    select: { id: true },
  });

  if (existingUser) {
    return { message: accountExistsMessage };
  }

  const passwordHash = await hashPassword(result.data.password);

  try {
    await db.user.create({
      data: {
        name: result.data.name,
        email: result.data.email,
        passwordHash,
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { message: accountExistsMessage };
    }

    return { message: "Unable to create your account right now. Try again." };
  }

  try {
    await signIn("credentials", {
      email: result.data.email,
      password: result.data.password,
      redirectTo: "/app",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        message:
          "Your account was created, but sign-in failed. Sign in to continue.",
      };
    }

    throw error;
  }

  return {};
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function googleSignInAction(formData: FormData) {
  await signIn("google", {
    redirectTo: getSafeAppCallbackUrl(formData.get("callbackUrl")),
  });
}
