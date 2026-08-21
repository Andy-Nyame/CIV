import "server-only";

import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";
import { requirePlatformPageCapability } from "@/features/platform-admin/authorization";
import { db } from "@/lib/db";

export async function getPlatformTaxProfiles() {
  const context = await requirePlatformPageCapability(PLATFORM_CAPABILITIES.VIEW_PLATFORM_ANALYTICS);
  const profiles = await db.taxProfile.findMany({
    orderBy: [{ jurisdiction: "asc" }, { code: "asc" }],
    include: {
      versions: {
        orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        include: { components: { orderBy: [{ calculationOrder: "asc" }, { code: "asc" }] } },
      },
    },
  });
  return { context, profiles };
}
