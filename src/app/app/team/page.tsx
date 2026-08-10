import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/ui/feature-placeholder";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <FeaturePlaceholder
      title="Team"
      description="Manage workspace members and roles."
      emptyTitle="No team members to show"
    />
  );
}
