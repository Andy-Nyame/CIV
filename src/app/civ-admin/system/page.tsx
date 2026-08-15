import type { Metadata } from "next";

import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { getPlatformSystemStatus } from "@/features/platform-admin/queries";

export const metadata: Metadata = { title: "System" };

export default async function PlatformSystemPage() {
  await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_SYSTEM_HEALTH);
  const system = await getPlatformSystemStatus();
  const rows = [
    ["Application environment", system.appEnvironment],
    ["Database connectivity", system.databaseConnected ? "Connected" : "Unavailable"],
    ["Private storage configuration", system.storageConfigured ? "Configured" : "Unavailable"],
    ["Application version", system.appVersion],
    ["Build identifier", system.buildIdentifier],
  ];
  return (
    <div>
      <PlatformPageHeading title="System" description="Safe, read-only environment and service status. Secrets and connection details are never displayed." />
      <section className="mt-8 max-w-3xl overflow-hidden rounded-xl border border-border bg-surface">
        <dl className="divide-y divide-border">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-5 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6"><dt className="text-sm font-semibold text-muted">{label}</dt><dd className="text-sm font-semibold text-text">{value}</dd></div>
          ))}
        </dl>
      </section>
      <p className="mt-5 max-w-3xl text-sm leading-6 text-muted">No database URL, storage credential, authentication secret, OAuth token, or private object reference is queried for presentation.</p>
    </div>
  );
}
