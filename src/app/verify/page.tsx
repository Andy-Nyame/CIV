import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import { CivLogo } from "@/components/brand/civ-logo";
import { ThemeControl } from "@/components/theme/theme-control";
import { lookupPublicDocumentVerification, type PublicVerificationResult } from "@/features/documents/verification/service";

export const metadata: Metadata = {
  title: "Verify a CIV Document",
  description: "Check the CIV-native verification identity of an issued document.",
  robots: { index: false, follow: false },
};

// Verification reflects the current persisted lifecycle state (including VOID)
// and must not be served from a stale prerendered result.
export const dynamic = "force-dynamic";

type VerificationPageResult = PublicVerificationResult | { status: "UNAVAILABLE" };

function VerificationResult({ result }: { result: VerificationPageResult }) {
  if (result.status === "NOT_FOUND") {
    return <section className="mt-7 rounded-xl border border-danger/40 bg-surface p-5 sm:p-7" role="status"><p className="text-xs font-bold uppercase tracking-[0.16em] text-danger">Document Not Verified</p><h2 className="mt-2 text-xl font-bold text-text">No CIV document was found for this verification code.</h2><p className="mt-2 text-sm leading-6 text-muted">Check the characters and hyphens, then try again. CIV does not disclose document records for invalid codes.</p></section>;
  }
  if (result.status === "UNAVAILABLE") {
    return <section className="mt-7 rounded-xl border border-warning bg-surface p-5 sm:p-7" role="status"><p className="text-xs font-bold uppercase tracking-[0.16em] text-warning">Verification unavailable</p><h2 className="mt-2 text-xl font-bold text-text">CIV could not complete this check right now.</h2><p className="mt-2 text-sm leading-6 text-muted">Please try again later. No document information has been disclosed.</p></section>;
  }

  const isValid = result.status === "VALID";
  const heading = result.status === "TEST" ? "CIV Test Document" : result.status === "VOID" ? "VOID — This document is no longer valid" : "Verified CIV Document";
  return <section className={`mt-7 overflow-hidden rounded-xl border-2 bg-surface ${isValid ? "border-verification" : "border-danger"}`} role="status">
    {result.isTestDocument ? <div className="bg-danger px-5 py-4 text-center text-lg font-black tracking-wide text-white">TEST DOCUMENT — NOT VALID</div> : null}
    <div className="p-5 sm:p-7"><p className={`text-xs font-bold uppercase tracking-[0.16em] ${isValid ? "text-verification" : "text-danger"}`}>{result.status === "VALID" ? "CIV-native verification: valid" : result.status === "TEST" ? "Not valid for official use" : "Lifecycle status: void"}</p><h2 className="mt-2 text-2xl font-bold text-text">{heading}</h2><dl className="mt-6 grid gap-4 border-y border-border py-5 text-sm sm:grid-cols-2"><div><dt className="text-muted">Document type</dt><dd className="mt-1 font-semibold text-text">{result.documentType}</dd></div><div><dt className="text-muted">Document number</dt><dd className="mt-1 font-semibold text-text">{result.documentNumber}</dd></div><div><dt className="text-muted">Issuer</dt><dd className="mt-1 font-semibold text-text">{result.issuerName}</dd></div><div><dt className="text-muted">Issue date</dt><dd className="mt-1 font-semibold text-text">{result.issueDate}</dd></div><div><dt className="text-muted">Total</dt><dd className="mt-1 font-semibold text-text">{result.currency} {result.grandTotal}</dd></div><div><dt className="text-muted">Verification code</dt><dd className="mt-1 break-all font-mono font-bold text-text">{result.verificationCode}</dd></div></dl><p className="mt-5 text-sm leading-6 text-muted">This result confirms a CIV-native document identity. It does not represent GRA, VSDC, e-VAT, or government certification.</p></div>
  </section>;
}

export default async function VerifyPage({ searchParams }: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const rawCode = (await searchParams).code;
  const code = typeof rawCode === "string" ? rawCode.slice(0, 64) : "";
  let result: VerificationPageResult | null = null;
  if (code.trim()) {
    try {
      result = await lookupPublicDocumentVerification(code);
    } catch {
      result = { status: "UNAVAILABLE" };
    }
  }

  return <div className="min-h-screen bg-page text-text"><header className="border-b border-border bg-surface"><div className="mx-auto flex min-h-20 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8"><CivLogo href="/" showMotto/><div className="flex items-center gap-2"><ThemeControl/><Link className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-bold text-text hover:bg-hover" href="/login">Sign In</Link></div></div></header><main className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-20"><p className="text-xs font-bold uppercase tracking-[0.18em] text-link">Create. Issue. Verify.</p><h1 className="mt-4 text-3xl font-bold tracking-tight text-text sm:text-4xl">Verify a CIV Document</h1><p className="mt-4 max-w-2xl leading-7 text-muted">Enter the complete CIV verification code printed on the issued document or PDF. Verification does not require a CIV account.</p><Form action="/verify" className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-7"><label className="grid gap-2 text-sm font-bold text-text" htmlFor="verification-code">Verification code<input id="verification-code" className="min-h-12 rounded-lg border border-border bg-page px-4 font-mono text-base uppercase tracking-wide text-text outline-none focus:border-civ-blue" name="code" defaultValue={code} maxLength={64} placeholder="CIV-7K4M-92PX-H6Q2" autoCapitalize="characters" autoComplete="off" spellCheck={false} required/></label><button className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-civ-blue px-5 text-sm font-bold text-white hover:bg-civ-blue-hover sm:w-auto" type="submit">Verify Document</button></Form>{result ? <VerificationResult result={result}/> : <section className="mt-7 rounded-xl border border-dashed border-border p-5 sm:p-7"><h2 className="font-bold text-text">Ready to verify</h2><p className="mt-2 text-sm leading-6 text-muted">CIV performs an exact lookup. There is no public document directory or browsing endpoint.</p></section>}</main></div>;
}
