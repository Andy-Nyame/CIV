import type { Metadata } from "next";
import Link from "next/link";

import { CivLogo } from "@/components/brand/civ-logo";
import { ThemeControl } from "@/components/theme/theme-control";

export const metadata: Metadata = {
  title: "CIV — Create. Issue. Verify.",
  description:
    "CIV helps individuals, businesses and organizations create, issue, store and manage professional business documents from one secure workspace.",
  openGraph: {
    title: "CIV — Create. Issue. Verify.",
    description:
      "Professional business documents and organized records from one secure workspace.",
    siteName: "CIV",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CIV — Create. Issue. Verify.",
    description:
      "Professional business documents and organized records from one secure workspace.",
  },
};

const currentYear = new Date().getUTCFullYear();

const audiences = [
  ["Individuals", "Independent professionals who need records that look considered and stay organized."],
  ["Small businesses", "Teams replacing scattered files and chat attachments with one working space."],
  ["Growing businesses", "Businesses that need more people, clearer roles and dependable activity history."],
  ["Organizations", "Structured teams managing workspace-specific records with controlled access."],
] as const;

const trustPrinciples = [
  "Authenticated personal accounts",
  "Role-based workspace access",
  "Private storage for controlled assets",
  "Workspace isolation",
  "Activity history for important actions",
] as const;

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7.5" />
      <path d="m6.8 10.1 2.1 2.1 4.4-4.5" />
    </svg>
  );
}

function SectionLabel({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p className={`text-xs font-bold uppercase tracking-[0.18em] ${light ? "text-blue-200" : "text-link"}`}>
      {children}
    </p>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-civ-blue px-5 py-3 text-sm font-bold text-white hover:bg-civ-blue-hover">
      {children}
      <ArrowIcon />
    </Link>
  );
}

function SecondaryLink({ href, children, inverse = false }: { href: string; children: React.ReactNode; inverse?: boolean }) {
  return (
    <Link href={href} className={`inline-flex min-h-12 items-center justify-center rounded-lg border px-5 py-3 text-sm font-bold ${inverse ? "border-white/35 text-white hover:bg-white/10" : "border-border bg-surface text-text hover:bg-hover"}`}>
      {children}
    </Link>
  );
}

function ProductPreview() {
  return (
    <figure className="relative" aria-labelledby="product-preview-caption">
      <div className="absolute -top-3 right-5 z-10 border border-civ-blue bg-surface px-3 py-1.5 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-link shadow-sm">
        Product direction
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_70px_rgba(16,42,67,0.14)]">
        <div className="flex min-h-12 items-center justify-between border-b border-border px-4 sm:px-5">
          <span className="text-sm font-extrabold tracking-[-0.05em] text-text">CI<span className="text-verification">✓</span></span>
          <span className="text-xs font-semibold text-muted">Your Business Workspace</span>
        </div>
        <div className="grid sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <div className="hidden border-r border-border bg-page p-4 sm:block">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-muted">Workspace</p>
            <ul className="mt-4 grid gap-1 text-xs font-semibold text-muted" aria-label="Preview navigation">
              <li className="rounded-md bg-active px-3 py-2 text-link">Home</li>
              <li className="px-3 py-2">Documents</li>
              <li className="px-3 py-2">Vault</li>
              <li className="px-3 py-2">Team</li>
            </ul>
          </div>
          <div className="p-5 sm:p-6 lg:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-link">Document workflow preview</p>
                <h2 className="mt-2 text-xl font-bold text-text sm:text-2xl">Prepare a business document</h2>
              </div>
              <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wide text-muted">In development</span>
            </div>
            <div className="mt-6 border-y border-border">
              {["Invoice", "Receipt", "Quotation", "VAT / Tax Invoice"].map((type, index) => (
                <div key={type} className={`flex min-h-12 items-center justify-between gap-4 py-3 text-sm ${index ? "border-t border-border" : ""}`}>
                  <span className="font-semibold text-text">{type}</span>
                  <span className="text-xs text-muted">Select type <span aria-hidden="true">→</span></span>
                </div>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-3 gap-2" aria-label="CIV document workflow">
              {["Create", "Issue", "Verify"].map((step, index) => (
                <div key={step} className="border-t-2 border-civ-blue pt-2">
                  <span className="block text-[0.65rem] font-bold text-muted">0{index + 1}</span>
                  <span className="mt-1 block text-xs font-bold text-text sm:text-sm">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption id="product-preview-caption" className="mt-4 max-w-xl text-xs leading-5 text-muted">
        An interface preview using CIV&apos;s real design language. Workspace, team, plans and account foundations are available; document creation and verification tools are being built.
      </figcaption>
    </figure>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-page text-text">
      <a className="skip-link" href="#main-content">Skip to content</a>

      <header className="sticky top-0 z-50 border-b border-border bg-surface">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
          <CivLogo href="/" showMotto />

          <nav className="hidden items-center gap-7 lg:flex" aria-label="Public navigation">
            <a className="text-sm font-semibold text-muted hover:text-text" href="#product">Product</a>
            <a className="text-sm font-semibold text-muted hover:text-text" href="#how-it-works">How it works</a>
            <a className="text-sm font-semibold text-muted hover:text-text" href="#security">Security</a>
            <a className="text-sm font-semibold text-muted hover:text-text" href="#plans">Plans</a>
          </nav>

          <div className="hidden items-center gap-2 sm:flex">
            <ThemeControl />
            <Link className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-bold text-text hover:bg-hover" href="/login">Sign In</Link>
            <Link className="inline-flex min-h-11 items-center rounded-lg bg-civ-blue px-4 text-sm font-bold text-white hover:bg-civ-blue-hover" href="/signup">Get Started</Link>
          </div>

          <div className="flex items-center gap-2 sm:hidden">
            <ThemeControl />
            <details className="group relative">
              <summary className="flex min-h-11 list-none items-center rounded-lg border border-border px-3 text-sm font-bold text-text hover:bg-hover [&::-webkit-details-marker]:hidden">Menu</summary>
              <nav className="absolute right-0 mt-2 grid w-64 gap-1 rounded-xl border border-border bg-surface p-2 shadow-xl" aria-label="Mobile public navigation">
                <a className="min-h-11 rounded-lg px-3 py-3 text-sm font-semibold text-text hover:bg-hover" href="#product">Product</a>
                <a className="min-h-11 rounded-lg px-3 py-3 text-sm font-semibold text-text hover:bg-hover" href="#how-it-works">How it works</a>
                <a className="min-h-11 rounded-lg px-3 py-3 text-sm font-semibold text-text hover:bg-hover" href="#security">Security</a>
                <a className="min-h-11 rounded-lg px-3 py-3 text-sm font-semibold text-text hover:bg-hover" href="#plans">Plans</a>
                <span className="my-1 border-t border-border" />
                <Link className="min-h-11 rounded-lg px-3 py-3 text-sm font-semibold text-text hover:bg-hover" href="/login">Sign In</Link>
                <Link className="min-h-11 rounded-lg bg-civ-blue px-3 py-3 text-sm font-bold text-white" href="/signup">Get Started Free</Link>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="border-b border-border bg-surface" aria-labelledby="hero-title">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:py-28">
            <div className="max-w-2xl">
              <SectionLabel>Create. Issue. Verify.</SectionLabel>
              <h1 id="hero-title" className="mt-5 text-4xl font-bold leading-[1.06] tracking-[-0.045em] text-text sm:text-5xl lg:text-[3.65rem]">
                Professional business documents, without the paperwork headache.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
                CIV helps individuals, businesses and organizations create, issue, store and manage professional business documents from one secure workspace.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <PrimaryLink href="/signup">Get Started Free</PrimaryLink>
                <SecondaryLink href="/login">Sign In</SecondaryLink>
              </div>
              <ul className="mt-10 grid gap-3 border-t border-border pt-6 text-sm text-muted sm:grid-cols-3" aria-label="CIV foundations">
                <li>One personal account</li>
                <li>Multiple workspaces</li>
                <li>Records kept in context</li>
              </ul>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 border-b border-border" aria-labelledby="civ-method-title">
          <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-10">
            <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
              <div>
                <SectionLabel>The CIV method</SectionLabel>
                <h2 id="civ-method-title" className="mt-4 text-3xl font-bold tracking-tight text-text sm:text-4xl">Three words. One clear record journey.</h2>
              </div>
              <p className="max-w-2xl text-base leading-8 text-muted sm:text-lg">
                CIV is being built around the full life of a business document—from preparation to a dependable issued record and, ultimately, recipient verification.
              </p>
            </div>

            <ol className="mt-14 border-y border-border">
              <li className="grid gap-4 py-8 sm:grid-cols-[5rem_12rem_1fr] sm:items-start">
                <span className="font-mono text-sm font-bold text-link">01</span>
                <h3 className="text-2xl font-bold text-text">Create</h3>
                <div><p className="max-w-2xl leading-7 text-muted">Prepare invoices, receipts, quotations and VAT/tax invoices in a consistent professional format.</p><p className="mt-2 text-xs font-semibold uppercase tracking-wide text-link">Document tools in development</p></div>
              </li>
              <li className="grid gap-4 border-t border-border py-8 sm:grid-cols-[5rem_12rem_1fr] sm:items-start">
                <span className="font-mono text-sm font-bold text-link">02</span>
                <h3 className="text-2xl font-bold text-text">Issue</h3>
                <div><p className="max-w-2xl leading-7 text-muted">Finalize documents, preserve the business record and provide a clear customer copy. PDF sharing and download are part of the document roadmap.</p><p className="mt-2 text-xs font-semibold uppercase tracking-wide text-link">Product direction</p></div>
              </li>
              <li className="grid gap-4 border-t border-border py-8 sm:grid-cols-[5rem_12rem_1fr] sm:items-start">
                <span className="font-mono text-sm font-bold text-link">03</span>
                <h3 className="text-2xl font-bold text-text">Verify</h3>
                <div><p className="max-w-2xl leading-7 text-muted">Give CIV-issued records a structured identity so recipients can check authenticity. Verification services are being developed and do not imply government or GRA certification.</p><p className="mt-2 text-xs font-semibold uppercase tracking-wide text-link">Product vision</p></div>
              </li>
            </ol>
          </div>
        </section>

        <section id="product" className="scroll-mt-24 bg-surface" aria-labelledby="workspaces-title">
          <div className="mx-auto grid w-full max-w-7xl gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-2 lg:gap-24 lg:px-10">
            <div>
              <SectionLabel>Workspaces make the difference</SectionLabel>
              <h2 id="workspaces-title" className="mt-4 max-w-xl text-3xl font-bold tracking-tight text-text sm:text-4xl">Your account is you. A workspace is where the work belongs.</h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-muted">
                One CIV account can belong to multiple Individual, Business or Organization workspaces. Each workspace keeps its own members, roles, plan and records—without confusing personal identity with business identity.
              </p>
              <dl className="mt-10 border-y border-border">
                <div className="grid gap-2 py-5 sm:grid-cols-[9rem_1fr]"><dt className="font-bold text-text">Individual</dt><dd className="text-sm leading-6 text-muted">A focused space for your own professional work.</dd></div>
                <div className="grid gap-2 border-t border-border py-5 sm:grid-cols-[9rem_1fr]"><dt className="font-bold text-text">Business</dt><dd className="text-sm leading-6 text-muted">A shared business environment with identity and team controls.</dd></div>
                <div className="grid gap-2 border-t border-border py-5 sm:grid-cols-[9rem_1fr]"><dt className="font-bold text-text">Organization</dt><dd className="text-sm leading-6 text-muted">A structured home for a larger team and its records.</dd></div>
              </dl>
            </div>

            <div className="border-l-2 border-civ-blue pl-6 sm:pl-10">
              <p className="text-sm font-bold text-link">Available now</p>
              <h3 className="mt-3 text-2xl font-bold text-text">Collaboration with clear boundaries.</h3>
              <p className="mt-4 leading-7 text-muted">Invite trusted people and assign the level of access that matches their work.</p>
              <ul className="mt-8 grid gap-5">
                {["OWNER, ADMIN, MANAGER and STAFF roles", "Controlled workspace permissions", "Invitation and member management", "Activity history for important workspace changes"].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm font-semibold leading-6 text-text"><span className="mt-0.5 text-verification"><CheckIcon /></span>{item}</li>
                ))}
              </ul>
              <Link href="/signup" className="mt-10 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-link underline-offset-4 hover:underline">Create your first workspace <ArrowIcon /></Link>
            </div>
          </div>
        </section>

        <section className="border-y border-border" aria-labelledby="audience-title">
          <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-10">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
              <div><SectionLabel>Who CIV is for</SectionLabel><h2 id="audience-title" className="mt-4 text-3xl font-bold tracking-tight text-text sm:text-4xl">Built for the people who keep business moving.</h2></div>
              <p className="max-w-xl text-base leading-8 text-muted lg:justify-self-end">CIV starts simple for one professional and keeps the same clear structure as a team grows.</p>
            </div>
            <div className="mt-12 grid border-y border-border md:grid-cols-2">
              {audiences.map(([title, description], index) => (
                <article key={title} className={`py-7 md:px-8 ${index > 0 ? "border-t border-border md:border-t-0" : ""} ${index % 2 ? "md:border-l md:border-border" : ""} ${index > 1 ? "md:border-t md:border-border" : ""}`}>
                  <h3 className="text-lg font-bold text-text">{title}</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-surface" aria-labelledby="records-title">
          <div className="mx-auto grid w-full max-w-7xl gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:gap-24 lg:px-10">
            <div>
              <SectionLabel>Records, not loose files</SectionLabel>
              <h2 id="records-title" className="mt-4 max-w-2xl text-3xl font-bold tracking-tight text-text sm:text-4xl">The Vault is CIV&apos;s home for issued business records.</h2>
              <p className="mt-6 max-w-2xl text-base leading-8 text-muted">As document tools roll out, issued records will stay organized inside the workspace that created them—not scattered across phones, laptops and chat threads. Storage and document allowances remain plan-based.</p>
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-link">Vault document storage is part of the document roadmap</p>
            </div>
            <div className="border-t-4 border-civ-navy bg-page p-6 sm:p-8 dark:border-blue-300">
              <p className="text-sm font-bold text-text">Professional presentation</p>
              <p className="mt-4 text-xl font-semibold leading-8 text-text">Your business identity should travel with the document—not disappear in a generic file.</p>
              <p className="mt-5 text-sm leading-7 text-muted">Workspace names and private logos are available today. Custom document branding and templates are planned for the document-design phase.</p>
            </div>
          </div>
        </section>

        <section id="security" className="scroll-mt-24 bg-civ-navy text-white" aria-labelledby="security-title">
          <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24 lg:px-10">
            <div>
              <SectionLabel light>Trust by design</SectionLabel>
              <h2 id="security-title" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">Business records deserve clear boundaries.</h2>
              <p className="mt-6 max-w-lg leading-8 text-blue-100">CIV&apos;s foundation is designed to keep personal identity, workspace access and private assets under deliberate control—without making claims beyond the protections built today.</p>
            </div>
            <ul className="grid border-y border-white/20 sm:grid-cols-2">
              {trustPrinciples.map((principle, index) => (
                <li key={principle} className={`flex min-h-20 items-center gap-3 py-5 text-sm font-semibold text-white sm:px-5 ${index > 0 ? "border-t border-white/20 sm:border-t-0" : ""} ${index % 2 ? "sm:border-l" : ""} ${index > 1 ? "sm:border-t" : ""}`}><span className="text-green-300"><CheckIcon /></span>{principle}</li>
              ))}
            </ul>
          </div>
        </section>

        <section id="plans" className="scroll-mt-24 border-b border-border" aria-labelledby="plans-title">
          <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 sm:py-28 lg:px-10">
            <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-end">
              <div>
                <SectionLabel>Plans and document capacity</SectionLabel>
                <h2 id="plans-title" className="mt-4 max-w-xl text-3xl font-bold tracking-tight text-text sm:text-4xl">Start free. Add room as the work grows.</h2>
                <p className="mt-6 max-w-2xl text-base leading-8 text-muted">CIV has a Free plan and additional plans designed for growing teams. Plans include document allowances, with additional document credits available when needed.</p>
              </div>
              <div className="border-l-2 border-civ-blue pl-6 sm:pl-8">
                <p className="font-bold text-text">Free trials may be available</p>
                <p className="mt-2 text-sm leading-6 text-muted">Trial availability, plan and duration follow CIV&apos;s current configuration. Final paid pricing has not been announced.</p>
              </div>
            </div>
            <div className="mt-10 flex flex-col items-start justify-between gap-5 border-t border-border pt-7 sm:flex-row sm:items-center">
              <p className="max-w-xl text-sm leading-6 text-muted">Create an account and begin with CIV&apos;s Free plan. Additional options can grow with your workspace.</p>
              <PrimaryLink href="/signup">Explore CIV free</PrimaryLink>
            </div>
          </div>
        </section>

        <section className="bg-surface" aria-labelledby="final-cta-title">
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_auto] lg:items-center lg:px-10">
            <div>
              <SectionLabel>Begin with one workspace</SectionLabel>
              <h2 id="final-cta-title" className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-text sm:text-4xl">Start creating better business records with CIV.</h2>
              <p className="mt-4 max-w-2xl leading-7 text-muted">Create your account, choose how you work and set up a workspace for the records that matter.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <PrimaryLink href="/signup">Get Started Free</PrimaryLink>
              <SecondaryLink href="/login">Sign In</SecondaryLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-page">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1fr_auto] lg:px-10">
          <div><CivLogo href="/" showMotto /><p className="mt-4 max-w-md text-sm leading-6 text-muted">Professional business documents and organized records from one secure workspace.</p></div>
          <nav className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm" aria-label="Footer navigation">
            <a className="font-semibold text-muted hover:text-text" href="#product">Product</a>
            <a className="font-semibold text-muted hover:text-text" href="#how-it-works">How it works</a>
            <a className="font-semibold text-muted hover:text-text" href="#security">Security</a>
            <a className="font-semibold text-muted hover:text-text" href="#plans">Plans</a>
            <Link className="font-semibold text-muted hover:text-text" href="/login">Sign In</Link>
            <Link className="font-semibold text-link hover:underline" href="/signup">Create Account</Link>
          </nav>
        </div>
        <div className="border-t border-border px-5 py-5 sm:px-8 lg:px-10"><p className="mx-auto w-full max-w-7xl text-xs text-muted">© {currentYear} CIV. Create. Issue. Verify.</p></div>
      </footer>
    </div>
  );
}
