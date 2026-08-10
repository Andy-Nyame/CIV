import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/ui/feature-placeholder";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <FeaturePlaceholder
      title="Documents"
      description="Your issued and draft documents will appear here."
      emptyTitle="No documents yet"
    />
  );
}
