import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/ui/feature-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <FeaturePlaceholder
      title="Settings"
      description="Manage your workspace and CIV preferences."
      emptyTitle="Workspace preferences"
    />
  );
}
