import Link from "next/link";

type AuthFormProps = {
  mode: "login" | "signup";
};

export function AuthForm({ mode }: AuthFormProps) {
  const isSignup = mode === "signup";

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

      <form className="grid gap-5">
        {isSignup ? (
          <label className="grid gap-2 text-sm font-semibold text-text">
            Name
            <input
              className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text placeholder:text-muted"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Your name"
            />
          </label>
        ) : null}

        <label className="grid gap-2 text-sm font-semibold text-text">
          Email
          <input
            className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text placeholder:text-muted"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-text">
          Password
          <input
            className="min-h-12 rounded-lg border border-border bg-surface px-3.5 font-normal text-text placeholder:text-muted"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder="Enter your password"
          />
        </label>

        <button
          type="button"
          className="min-h-12 rounded-lg bg-civ-blue px-4 font-semibold text-white hover:bg-civ-blue-hover"
        >
          {isSignup ? "Create Account" : "Sign In"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs font-medium text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        className="min-h-12 w-full rounded-lg border border-border bg-surface px-4 font-semibold text-text hover:bg-hover"
      >
        Continue with Google
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
      <p className="mt-4 text-center text-xs leading-5 text-muted">
        Authentication will be connected in a later phase.
      </p>
    </section>
  );
}
