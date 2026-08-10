import Link from "next/link";

import { CivLogo } from "@/components/brand/civ-logo";
import { ThemeControl } from "@/components/theme/theme-control";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-page text-text">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-18 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <CivLogo href="/" />
          <div className="flex items-center gap-3">
            <ThemeControl />
            <Link
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-hover hover:text-text sm:inline-flex"
              href="/login"
            >
              Sign In
            </Link>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto flex w-full max-w-6xl flex-1 items-center px-5 py-20 sm:px-8 sm:py-28"
      >
        <section className="max-w-2xl" aria-labelledby="landing-title">
          <CivLogo showMotto className="mb-10" />
          <h1
            id="landing-title"
            className="max-w-xl text-4xl font-bold tracking-tight text-text sm:text-5xl"
          >
            Business documents, made clear.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
            Create, issue, store and verify professional business documents.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-civ-blue px-6 py-3 font-semibold text-white hover:bg-civ-blue-hover"
              href="/signup"
            >
              Get Started
            </Link>
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border bg-surface px-6 py-3 font-semibold text-text hover:bg-hover"
              href="/login"
            >
              Sign In
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-5 py-6 text-sm text-muted sm:px-8">
        <div className="mx-auto w-full max-w-6xl">CIV — Create. Issue. Verify.</div>
      </footer>
    </div>
  );
}
