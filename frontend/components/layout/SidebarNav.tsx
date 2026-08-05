"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Megaphone,
  Users as UsersIcon,
  CalendarDays,
  ClipboardCheck,
  Clock,
  MapPin,
  BarChart3,
  Building2,
  Building,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { Badge } from "@/components/ui";
import type { Role } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** When set, the item only shows for these roles. */
  roles?: Role[];
}

// Feature routes are added here as modules land under app/(protected)/.
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/requests", label: "Work requests", icon: ClipboardList },
  // Job Dispatch Phase 2 (Epic 9 PRs 9.7/9.9/9.10, FEATURE_JOBDISPATCH_PHASE2):
  // broadcasts are a distinct JobRequest shape (skill x headcount, no
  // apply/approve step) from the marketplace `/requests` flow above — kept
  // as its own nav entry rather than a tab on `/requests` so the two
  // creation/detail flows don't get conflated.
  { href: "/requests/broadcasts", label: "Broadcasts", icon: Megaphone },
  { href: "/assignments", label: "Assignments", icon: ClipboardCheck },
  // Teams-style day-grid view of placements + absences (FEATURE_JOBDISPATCH_PHASE2
  // gates placement data server-side; absences are additionally manager/RM/admin-only
  // — a worker/checker still sees the page, just with an empty placements/absences
  // set until the flag is on, matching the "not visible to me, not an error" pattern
  // this app already uses elsewhere).
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/attendance", label: "Attendance", icon: Clock },
  // SPEC-GEO-001 (GD-14): regional_manager added per Regional Manager V1
  // Decision 3 (grant at group scope) — see GeoCheckinsGate for the backend
  // change this now matches.
  { href: "/geo-checkins", label: "Geo check-ins", icon: MapPin, roles: ["manager", "regional_manager", "admin"] },
  // regional_manager added (ADR-030 D-5/PR-3): RM holds the same operational
  // capability set as manager at group scope, so sees the same nav surface.
  { href: "/analytics", label: "Analytics", icon: BarChart3, roles: ["manager", "regional_manager", "admin"] },
  { href: "/hotels", label: "Hotels", icon: Building2, roles: ["manager", "regional_manager", "admin"] },
  { href: "/hotel-groups", label: "Hotel groups", icon: Building, roles: ["manager", "regional_manager", "admin"] },
  // Backend (GET /users, GET/PUT /users/:id) is scope-correct for manager
  // and regional_manager (2026-08-06 scope fixes) -- this nav entry was the
  // last remaining place a manager/RM had no way to browse or open their
  // own group's workers by name/email, despite the API already serving it.
  { href: "/users", label: "Users", icon: UsersIcon, roles: ["admin", "manager", "regional_manager"] },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

/**
 * The navigation link list, shared by the desktop sidebar and the mobile
 * drawer. `onNavigate` lets the mobile drawer close itself on selection.
 * `collapsed` renders an icon-only rail (labels/badges hidden) — the mobile
 * drawer never passes this, since it always shows full-width.
 */
export function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
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
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center rounded-md py-2 text-sm font-medium",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
              // Collapsed: no horizontal padding/gap at all, so the 20px
              // icon has the full 64px rail (minus the outer `nav` padding)
              // to center in -- `px-3` on top of that would leave only
              // 16px, clipping the icon on every render of the (default,
              // most-common) collapsed state.
              collapsed ? "justify-center px-0" : "justify-between gap-3 px-3",
              active
                ? "bg-blue-50 text-blue-700"
                : "text-gray-700 hover:bg-gray-100",
            )}
          >
            <span
              className={cn(
                "flex items-center overflow-hidden",
                collapsed ? "gap-0" : "gap-3",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span
                className={cn(
                  "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200",
                  collapsed ? "max-w-0 opacity-0" : "max-w-[10rem] opacity-100",
                )}
              >
                {item.label}
              </span>
            </span>
            {item.href === "/notifications" && unreadCount > 0 && !collapsed && (
              <Badge tone="info">{unreadCount}</Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
