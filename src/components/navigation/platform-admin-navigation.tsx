"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PlatformCapability } from "@/features/platform-admin/capabilities";
import { platformNavigation } from "@/lib/platform-navigation";

export function PlatformAdminNavigation({
  capabilities,
  compact = false,
}: {
  capabilities: readonly PlatformCapability[];
  compact?: boolean;
}) {
  const pathname = usePathname();
  const visibleItems = platformNavigation.filter((item) =>
    capabilities.includes(item.capability),
  );

  return (
    <nav aria-label="Platform administration">
      <ul className={compact ? "flex gap-1" : "grid gap-1"}>
        {visibleItems.map((item) => {
          const active =
            item.href === "/civ-admin"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          return (
            <li key={item.href} className={compact ? "shrink-0" : undefined}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold ${
                  active
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
