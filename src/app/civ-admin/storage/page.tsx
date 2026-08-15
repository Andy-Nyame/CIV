import type { Metadata } from "next";

import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PlatformStatCard } from "@/components/ui/platform-stat-card";
import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { formatBytes } from "@/features/platform-admin/presentation";
import { getPlatformStorageAnalytics } from "@/features/platform-admin/queries";

export const metadata: Metadata = { title: "Storage" };

export default async function PlatformStoragePage() {
  await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_STORAGE_ANALYTICS);
  const storage = await getPlatformStorageAnalytics();
  return (
    <div>
      <PlatformPageHeading title="Storage" description="Private asset metadata totals from PostgreSQL. This view does not enumerate or expose R2 object keys." />
      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PlatformStatCard label="Tracked private assets" value={storage.totalCount.toLocaleString()} />
        <PlatformStatCard label="Approximate tracked bytes" value={formatBytes(storage.totalSizeBytes)} detail="Metadata totals, not a live R2 scan" />
        {storage.categories.map((category) => (
          <PlatformStatCard key={category.label} label={category.label} value={category.count.toLocaleString()} detail={formatBytes(category.sizeBytes)} />
        ))}
      </section>
    </div>
  );
}
