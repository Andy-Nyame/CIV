import { CAPABILITIES } from "@/features/authorization/capabilities";

export const appNavigation = [
  { label: "Home", href: "/app" },
  { label: "Documents", href: "/app/documents" },
  { label: "Customers", href: "/app/customers" },
  { label: "Vault", href: "/app/vault" },
  {
    label: "Team",
    href: "/app/team",
    requiredCapability: CAPABILITIES.VIEW_TEAM,
  },
  { label: "Settings", href: "/app/settings" },
] as const;
