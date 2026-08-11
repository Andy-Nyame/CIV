"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction, signupAction } from "@/features/auth/actions";
import { initialAuthFormState } from "@/features/auth/types";

type AuthFormProps = {
  mode: "login" | "signup";
  callbackUrl?: string;
};

export function AuthForm({ mode, callbackUrl = "/app" }: AuthFormProps) {
  const isSignup = mode === "signup";
  const action = isSignup ? signupAction : loginAction;
  const [state, formAction, pending] = useActionState(
    action,
    initialAuthFormState,
  );

  return (
    <section
      className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 sm:p-8"
      aria-labelledby="auth-title"
    >
      <div className="mb-7">
        <p className="text-sm font-semibold text-link">CIV account</p>
        <h1 id="auth-title" className="mt-2 text-2xl font-bold tracking-tight text-text">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {isSignup
            ? "Set up your CIV account to get started."
            : "Sign in to continue to your CIV workspace."}
        </p>
      </div>

      <form action={formAction} className="grid gap-5" noValidate>
        {!isSignup ? (
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
        ) : null}
        {isSignup ? (
          <label
            className="grid gap-2 text-sm font-semibold text-text"
            htmlFor="auth-name"
          >
            Full name
            <input
              id="auth-name"
              className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text placeholder:text-muted"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Your full name"
              required
              minLength={2}
              maxLength={200}
              aria-invalid={Boolean(state.fieldErrors?.name)}
              aria-describedby={state.fieldErrors?.name ? "auth-name-error" : undefined}
            />
            {state.fieldErrors?.name ? (
              <span id="auth-name-error" className="text-sm font-normal text-danger">
                {state.fieldErrors.name[0]}
              </span>
            ) : null}
          </label>
        ) : null}

        <label
          className="grid gap-2 text-sm font-semibold text-text"
          htmlFor="auth-email"
        >
          Email
          <input
            id="auth-email"
            className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text placeholder:text-muted"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            maxLength={320}
            aria-invalid={Boolean(state.fieldErrors?.email)}
            aria-describedby={state.fieldErrors?.email ? "auth-email-error" : undefined}
          />
          {state.fieldErrors?.email ? (
            <span id="auth-email-error" className="text-sm font-normal text-danger">
              {state.fieldErrors.email[0]}
            </span>
          ) : null}
        </label>

        <label
          className="grid gap-2 text-sm font-semibold text-text"
          htmlFor="auth-password"
        >
          Password
          <input
            id="auth-password"
            className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text placeholder:text-muted"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder="Enter your password"
            required
            minLength={8}
            maxLength={128}
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby={
              state.fieldErrors?.password ? "auth-password-error" : undefined
            }
          />
          {state.fieldErrors?.password ? (
            <span
              id="auth-password-error"
              className="text-sm font-normal text-danger"
            >
              {state.fieldErrors.password[0]}
            </span>
          ) : null}
        </label>

        {state.message ? (
          <p className="text-sm leading-6 text-danger" role="alert" aria-live="polite">
            {state.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded-lg bg-civ-blue px-4 font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70"
        >
          {pending
            ? isSignup
              ? "Creating account…"
              : "Signing in…"
            : isSignup
              ? "Create Account"
              : "Sign In"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs font-medium text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        disabled
        className="min-h-12 w-full cursor-not-allowed rounded-lg border border-border bg-surface px-4 font-semibold text-muted opacity-70"
        title="Google authentication will be added in a later phase."
      >
        Continue with Google — Coming soon
      </button>

      <p className="mt-6 text-center text-sm text-muted">
        {isSignup ? "Already have an account?" : "New to CIV?"}{" "}
        <Link
          className="font-semibold text-link underline-offset-4 hover:underline"
          href={isSignup ? "/login" : "/signup"}
        >
          {isSignup ? "Sign in" : "Create account"}
        </Link>
      </p>
    </section>
  );
}
