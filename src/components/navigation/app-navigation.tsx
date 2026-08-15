"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { appNavigation } from "@/lib/navigation";

export function AppNavigation({
  canViewActivity,
  canViewTeam,
  onNavigate,
}: {
  canViewActivity: boolean;
  canViewTeam: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const visibleNavigation = appNavigation.filter((item) => {
    if (!("requiredCapability" in item)) return true;
    if (item.requiredCapability === "VIEW_TEAM") return canViewTeam;
    if (item.requiredCapability === "VIEW_AUDIT_LOG") return canViewActivity;
    return false;
  });

  return (
    <nav aria-label="Main navigation">
      <ul className="grid gap-1">
        {visibleNavigation.map((item) => {
          const isActive =
            item.href === "/app"
              ? pathname === item.href
              : pathname.startsWith(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold ${
                  isActive
                    ? "bg-active text-link"
                    : "text-muted hover:bg-hover hover:text-text"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
