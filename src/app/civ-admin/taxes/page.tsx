import type { Metadata } from "next";
import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { getPlatformTaxProfiles } from "@/features/tax/platform-queries";

export const metadata: Metadata = { title: "Tax profiles" };

export default async function PlatformTaxesPage() {
  const { profiles } = await getPlatformTaxProfiles();
  return <div><PlatformPageHeading title="Tax profiles" description="Read-only visibility into CIV-controlled, effective-dated tax configuration."/><p className="mt-6 border-l-4 border-civ-blue bg-soft-blue p-4 text-sm text-text dark:bg-surface-muted">Workspace Custom Rates are separate. Workspace users cannot modify these trusted statutory rules.</p><div className="mt-7 grid gap-6">{profiles.map((profile)=><section key={profile.id} className="rounded-xl border border-border bg-surface p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-text">{profile.name}</h2><p className="mt-1 text-sm text-muted">{profile.jurisdiction} · {profile.code}</p></div><span className="text-xs font-bold uppercase tracking-wide text-muted">Trusted system profile</span></div><div className="mt-5 grid gap-4">{profile.versions.map((version)=><article key={version.id} className="border-t border-border pt-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-text">Version {version.version}</h3><p className="text-sm text-muted">{version.effectiveFrom.toISOString().slice(0,10)} – {version.effectiveTo?.toISOString().slice(0,10) ?? "current"}</p></div><ul className="mt-3 grid gap-2 sm:grid-cols-2">{version.components.map((component)=><li key={component.id} className="text-sm text-text"><strong>{component.code}</strong> · {component.rate.toString()}% · {component.baseStrategy === "ORIGINAL_BASE" ? "original base" : "base plus levies"}</li>)}</ul></article>)}</div></section>)}</div></div>;
}
