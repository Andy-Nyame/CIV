import { PLATFORM_CAPABILITIES } from "@/features/platform-admin/capabilities";

export const platformNavigation = [
  {
    label: "Overview",
    href: "/civ-admin",
    capability: PLATFORM_CAPABILITIES.VIEW_PLATFORM_DASHBOARD,
  },
  {
    label: "Users",
    href: "/civ-admin/users",
    capability: PLATFORM_CAPABILITIES.VIEW_USERS,
  },
  {
    label: "Workspaces",
    href: "/civ-admin/workspaces",
    capability: PLATFORM_CAPABILITIES.VIEW_WORKSPACES,
  },
  {
    label: "Plans",
    href: "/civ-admin/plans",
    capability: PLATFORM_CAPABILITIES.VIEW_PLANS,
  },
  {
    label: "Credits",
    href: "/civ-admin/credits",
    capability: PLATFORM_CAPABILITIES.VIEW_PLANS,
  },
  {
    label: "Trials",
    href: "/civ-admin/trials",
    capability: PLATFORM_CAPABILITIES.VIEW_TRIALS,
  },
  {
    label: "Storage",
    href: "/civ-admin/storage",
    capability: PLATFORM_CAPABILITIES.VIEW_STORAGE_ANALYTICS,
  },
  {
    label: "Team",
    href: "/civ-admin/team",
    capability: PLATFORM_CAPABILITIES.MANAGE_PLATFORM_TEAM,
  },
  {
    label: "Activity",
    href: "/civ-admin/activity",
    capability: PLATFORM_CAPABILITIES.VIEW_PLATFORM_ACTIVITY,
  },
  {
    label: "System",
    href: "/civ-admin/system",
    capability: PLATFORM_CAPABILITIES.VIEW_SYSTEM_HEALTH,
  },
] as const;
