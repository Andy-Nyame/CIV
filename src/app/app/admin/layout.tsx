import type { Metadata } from "next";
import type { ReactNode } from "react";

import { requireSuperAdminPageUser } from "@/features/platform-admin/super-admin-authorization";

export const metadata: Metadata = {
  title: { default: "Super Admin", template: "%s | CIV Super Admin" },
  robots: { index: false, follow: false },
};

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  await requireSuperAdminPageUser();
  return children;
}
