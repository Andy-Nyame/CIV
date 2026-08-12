import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/ui/feature-placeholder";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { requirePageCapability } from "@/features/authorization/context";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePageCapability(CAPABILITIES.VIEW_WORKSPACE);

  return (
    <FeaturePlaceholder
      title="Settings"
      description="Manage your workspace and CIV preferences."
      emptyTitle="Workspace preferences"
    />
  );
}
