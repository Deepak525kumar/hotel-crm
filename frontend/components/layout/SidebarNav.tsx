"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { Badge } from "@/components/ui";
import type { Role } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  /** When set, the item only shows for these roles. */
  roles?: Role[];
}

// Feature routes are added here as modules land under app/(protected)/.
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/requests", label: "Work requests" },
  // Job Dispatch Phase 2 (Epic 9 PRs 9.7/9.9/9.10, FEATURE_JOBDISPATCH_PHASE2):
  // broadcasts are a distinct JobRequest shape (skill x headcount, no
  // apply/approve step) from the marketplace `/requests` flow above — kept
  // as its own nav entry rather than a tab on `/requests` so the two
  // creation/detail flows don't get conflated.
  { href: "/requests/broadcasts", label: "Broadcasts" },
  { href: "/assignments", label: "Assignments" },
  { href: "/attendance", label: "Attendance" },
  // SPEC-GEO-001 (GD-14): regional_manager added per Regional Manager V1
  // Decision 3 (grant at group scope) — see GeoCheckinsGate for the backend
  // change this now matches.
  { href: "/geo-checkins", label: "Geo check-ins", roles: ["manager", "regional_manager", "admin"] },
  // regional_manager added (ADR-030 D-5/PR-3): RM holds the same operational
  // capability set as manager at group scope, so sees the same nav surface.
  { href: "/analytics", label: "Analytics", roles: ["manager", "regional_manager", "admin"] },
  { href: "/hotels", label: "Hotels", roles: ["manager", "regional_manager", "admin"] },
  { href: "/hotel-groups", label: "Hotel groups", roles: ["manager", "regional_manager", "admin"] },
  { href: "/users", label: "Users", roles: ["admin"] },
  { href: "/notifications", label: "Notifications" },
];

/**
 * The navigation link list, shared by the desktop sidebar and the mobile
 * drawer. `onNavigate` lets the mobile drawer close itself on selection.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { unreadCount } = useNotifications();

  return (
    <nav className="flex-1 space-y-1 p-3">
      {NAV.filter(
        (item) => !item.roles || (user && item.roles.includes(user.role)),
      ).map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
              active
                ? "bg-blue-50 text-blue-700"
                : "text-gray-700 hover:bg-gray-100",
            )}
          >
            <span>{item.label}</span>
            {item.href === "/notifications" && unreadCount > 0 && (
              <Badge tone="info">{unreadCount}</Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
