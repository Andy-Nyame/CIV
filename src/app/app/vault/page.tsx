import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/ui/feature-placeholder";

export const metadata: Metadata = { title: "Vault" };

export default function VaultPage() {
  return (
    <FeaturePlaceholder
      title="CIV Vault"
      description="Your issued CIV documents will be stored here."
      emptyTitle="Your Vault is empty"
    />
  );
}
