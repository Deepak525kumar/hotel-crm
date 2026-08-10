"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Users as UsersIcon,
  CalendarDays,
  ClipboardCheck,
  Clock,
  BarChart3,
  Building2,
  Archive,
  Building,
  Settings,
  FileSignature,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/useAuth";
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
  // Geo check-ins is no longer a standalone tab: geofence-verification
  // events now render inline on the attendance detail page
  // (GeoVerificationCard, gated by the same GeoCheckinsGate roles).
  // regional_manager added (ADR-030 D-5/PR-3): RM holds the same operational
  // capability set as manager at group scope, so sees the same nav surface.
  { href: "/analytics", label: "Analytics", icon: BarChart3, roles: ["manager", "regional_manager", "admin"] },
  { href: "/hotels", label: "Hotels", icon: Building2, roles: ["manager", "regional_manager", "admin"] },
  { href: "/hotel-groups", label: "Hotel groups", icon: Building, roles: ["manager", "regional_manager", "admin"] },
  // Document Templates + Digital Signature (2026-08-09): template authoring
  // entry point for the roles that can read templates at all
  // (document-templates/routes.ts's GET routes: admin/manager/
  // regional_manager). A worker's own instances-to-sign live on their own
  // `/users/[id]` profile instead (MyDocumentInstancesCard), not here — no
  // proxy-fill/proxy-authoring means a worker never picks a template from a
  // list, so a top-level nav entry for them would only ever be empty.
  { href: "/document-templates", label: "Document templates", icon: FileSignature, roles: ["manager", "regional_manager", "admin"] },
  // Deleted entities are invisible everywhere else by design, so the archive
  // is their only reachable surface. Admin-only, matching the backend gate.
  { href: "/archive", label: "Archive", icon: Archive, roles: ["admin"] },
  // Backend (GET /users, GET/PUT /users/:id) is scope-correct for manager
  // and regional_manager (2026-08-06 scope fixes) -- this nav entry was the
  // last remaining place a manager/RM had no way to browse or open their
  // own group's workers by name/email, despite the API already serving it.
  { href: "/users", label: "Users", icon: UsersIcon, roles: ["admin", "manager", "regional_manager"] },
  // Notifications moved to a navbar bell icon (AppShell) -- no longer a
  // sidebar entry.
  // Deliberately last and deliberately unrestricted: settings is per-user
  // (session info + a pointer to /profile), not an admin surface, so every
  // role sees it. Keep it at the bottom -- it's a destination users go
  // looking for, not one they navigate between like the feature routes above.
  { href: "/settings", label: "Settings", icon: Settings },
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

  const items = NAV.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  );
  // Settings is excluded from the scrolling feature list and rendered in its
  // own pinned footer below instead (see the `<footer>` below) — it's a
  // destination users go looking for, not one they navigate between like the
  // feature routes above, so it should never scroll out of reach and should
  // sit visually apart from them, not just last-in-list.
  const featureItems = items.filter((item) => item.href !== "/settings");
  const settingsItem = items.find((item) => item.href === "/settings");

  const renderLink = (item: NavItem) => {
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
          // Padding is transitioned, not snapped: previously `px-0` <-> `px-3`
          // changed instantly while the label eased over 200ms, so the icon
          // visibly jumped ahead of the text it was supposed to move with.
          // `justify-start` in BOTH states (rather than justify-center when
          // collapsed) keeps the icon's own box from being re-anchored
          // mid-animation -- the rail's px-3 is what centres it in the 64px
          // collapsed width, so it lands in the same place without a
          // justify-content switch to fight the width transition.
          "justify-start px-3 transition-[padding,background-color] duration-200 ease-out",
          active
            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Icon className="h-5 w-5 shrink-0" aria-hidden />
          {/* Grid-template-columns 0fr -> 1fr is the one way to animate
              "collapse to nothing" without guessing a max-width. The old
              `max-w-[10rem]` was an assumed label width: any label narrower
              than 10rem finished its transition early and then sat still
              while the rail kept widening, which is what read as stuttery.
              A 0fr/1fr grid interpolates to the text's OWN width, so label
              and rail finish together regardless of label length. */}
          <span
            className={cn(
              "grid transition-[grid-template-columns,opacity] duration-200 ease-out",
              collapsed ? "grid-cols-[0fr] opacity-0" : "grid-cols-[1fr] opacity-100",
            )}
          >
            <span className="overflow-hidden whitespace-nowrap">{item.label}</span>
          </span>
        </span>
      </Link>
    );
  };

  return (
    // The rail itself is `sticky`/fixed-height (AppShell); this wrapper
    // splits into a scrolling <nav> for feature routes and a separate,
    // never-scrolling <footer> for profile + Settings pinned to the very
    // bottom of the rail -- the divider border is the visual gap that keeps
    // it from reading as just another (last) nav item.
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {featureItems.map(renderLink)}
      </nav>
      <footer className="space-y-1 border-t border-gray-200 p-3 dark:border-gray-800">
        {user && (
          <Link
            href="/profile"
            onClick={onNavigate}
            aria-current={pathname === "/profile" ? "page" : undefined}
            title={collapsed ? "Profile" : undefined}
            className={cn(
              // Same transitioned-padding / justify-start treatment as
              // renderLink above -- see its comment for why.
              "flex items-center rounded-md py-2 text-sm font-medium",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
              "justify-start px-3 transition-[padding,background-color] duration-200 ease-out",
              pathname === "/profile"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                {user.first_name?.[0]}
                {user.last_name?.[0]}
              </span>
              <span
                className={cn(
                  "grid transition-[grid-template-columns,opacity] duration-200 ease-out",
                  collapsed ? "grid-cols-[0fr] opacity-0" : "grid-cols-[1fr] opacity-100",
                )}
              >
                <span className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                  {user.first_name} {user.last_name}
                  <Badge tone="info">{user.role}</Badge>
                </span>
              </span>
            </span>
          </Link>
        )}
        {settingsItem && renderLink(settingsItem)}
      </footer>
    </div>
  );
}
