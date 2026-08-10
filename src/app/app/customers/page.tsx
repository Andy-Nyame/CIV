import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/ui/feature-placeholder";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <FeaturePlaceholder
      title="Customers"
      description="Save customers for faster document creation."
      emptyTitle="No saved customers"
    />
  );
}
