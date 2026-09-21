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
  ClipboardList,
  ListChecks,
  Trophy,
  DoorOpen,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/useAuth";
import { useMyOnboarding } from "@/hooks/useMyOnboarding";
import { useOnboardingLockout } from "@/hooks/useOnboardingLockout";
import { Badge } from "@/components/ui";
import type { Role } from "@/lib/types";

export interface NavItem {
  href: string;
  /**
   * English fallback, kept so this exported array stays usable outside a
   * React tree (tests, route metadata) where a `t()` call is not available.
   * Rendering always prefers `labelKey`.
   */
  label: string;
  /** i18n key resolved at render time; see `label`. */
  labelKey: string;
  icon: LucideIcon;
  /** When set, the item only shows for these roles. */
  roles?: Role[];
  /**
   * When true, the item is additionally gated on the signed-in user actually
   * HAVING an onboarding record (any status). Role alone is not enough: every
   * applicant role also contains fully-onboarded staff, for whom a permanent
   * "My Onboarding" entry is dead weight. See the `/onboarding` entry below.
   */
  requiresOwnOnboarding?: boolean;
}

// Feature routes are added here as modules land under app/(protected)/.
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  // Self-service onboarding entry point (owner decision, 2026-08-12). Shown to
  // every role that can BE an applicant — worker, checker, manager AND
  // regional_manager (a Manager/RM onboards through the same six-document gate;
  // ADR-065 §6 item 2 grants them no exemption).
  //
  // `requiresOwnOnboarding` is what keeps this from becoming permanent clutter:
  // the roles above also contain long-since-activated staff. The item stays
  // visible once ACTIVE (a neutral "view my onboarding" link, per the owner's
  // "don't nag an active employee" requirement) but disappears for anyone with
  // no record at all. Status is resolved from `useMyOnboarding`, NOT from any
  // scope claim — an unassigned Manager/RM applicant has no scope, which is the
  // bug class two earlier visibility guards hit.
  {
    href: "/onboarding",
    label: "My Onboarding",
    labelKey: "nav.myOnboarding",
    icon: ClipboardList,
    roles: ["worker", "checker", "manager", "regional_manager"],
    requiresOwnOnboarding: true,
  },
  { href: "/onboarding/review-queue", label: "Review Queue", labelKey: "nav.reviewQueue", icon: ListChecks, roles: ["manager", "regional_manager", "admin"] },
  // Job Dispatch Phase 2 (Epic 9 PRs 9.7/9.9/9.10, FEATURE_JOBDISPATCH_PHASE2):
  // broadcasts are a distinct JobRequest shape (skill x headcount, no
  // apply/approve step) from the marketplace `/requests` flow above — kept
  // as its own nav entry rather than a tab on `/requests` so the two
  // creation/detail flows don't get conflated.
  // `checker` added 2026-09-01 (web/app parity audit): a JobRequest carries a
  // target_role, the backend picks the side from the CALLER's role
  // (job-requests/service.ts: "a worker must never see a checker-targeted
  // request and vice versa"), and the accept route carries no role gate at
  // all. The checker app has shipped a Jobs tab against those same endpoints
  // since target_role landed -- so a checker-targeted broadcast was
  // acceptable on a phone and invisible on the web purely because this list
  // omitted the role.
  { href: "/requests/broadcasts", label: "Broadcasts", labelKey: "nav.broadcasts", icon: Megaphone, roles: ["worker", "checker", "manager", "regional_manager", "admin"] },
  { href: "/assignments", label: "Assignments", labelKey: "nav.assignments", icon: ClipboardCheck },
  // The worker's own room log (owner decision, 2026-09-01) — web parity with
  // the mobile Rooms tab. `worker` only: logging a room is
  // `requireRole('worker')` server-side, and every other role's view of room
  // activity is a different, hotel-scoped surface (the "Rooms logged today"
  // card on a hotel's page), not this self-scoped one.
  { href: "/rooms", label: "Rooms", labelKey: "nav.rooms", icon: DoorOpen, roles: ["worker"] },
  // Teams-style day-grid view of placements + absences (FEATURE_JOBDISPATCH_PHASE2
  // gates placement data server-side; absences are additionally manager/RM/admin-only
  // — a worker/checker still sees the page, just with an empty placements/absences
  // set until the flag is on, matching the "not visible to me, not an error" pattern
  // this app already uses elsewhere).
  { href: "/calendar", label: "Calendar", labelKey: "nav.calendar", icon: CalendarDays },
  { href: "/attendance", label: "Attendance", labelKey: "nav.attendance", icon: Clock },
  // The checker's own record of what they have checked. `GET
  // /quality/my-inspections` had no web route at all until 2026-09-22: a
  // checker could record an inspection from the assignment page and then never
  // see it again, while both mobile apps have had this list since the Rating
  // merge. Self-scoped server-side from req.auth, so `admin` sees only the
  // checks it recorded rather than everyone's -- it is here for the same
  // reason admin appears on every other quality surface, to support checkers
  // in the field, not to supervise them.
  { href: "/inspections", label: "History", labelKey: "nav.history", icon: ClipboardCheck, roles: ["checker", "admin"] },
  // Geo check-ins is no longer a standalone tab: geofence-verification
  // events now render inline on the attendance detail page
  // (GeoVerificationCard, gated by the same GeoCheckinsGate roles).
  { href: "/payslips", label: "Payslips", labelKey: "hr.payslipRequests", icon: ClipboardList, roles: ["manager", "regional_manager", "admin"] },
  { href: "/hotels", label: "Hotels", labelKey: "nav.hotels", icon: Building2, roles: ["manager", "regional_manager", "admin"] },
  { href: "/hotel-groups", label: "Hotel groups", labelKey: "nav.hotelGroups", icon: Building, roles: ["manager", "regional_manager", "admin"] },
  // Deleted entities are invisible everywhere else by design, so the archive
  // is their only reachable surface. Admin-only, matching the backend gate.
  { href: "/archive", label: "Archive", labelKey: "nav.archive", icon: Archive, roles: ["admin"] },
  // Backend (GET /users, GET/PUT /users/:id) is scope-correct for manager
  // and regional_manager (2026-08-06 scope fixes) -- this nav entry was the
  // last remaining place a manager/RM had no way to browse or open their
  // own group's workers by name/email, despite the API already serving it.
  { href: "/users", label: "Users", labelKey: "nav.users", icon: UsersIcon, roles: ["admin", "manager", "regional_manager"] },
  // Same class of gap as /users above: /analytics has existed (with the
  // worker leaderboard and platform stats) with no nav entry pointing at it,
  // so it was reachable only by typing the URL. Roles match the backend gate
  // exactly -- GET /analytics/leaderboard and /analytics/stats are
  // requireRole(['admin','manager','regional_manager']) + analytics:read, so
  // showing it to a worker or checker would render a page of 403s.
  { href: "/analytics", label: "Analytics", labelKey: "nav.analytics", icon: BarChart3, roles: ["admin", "manager", "regional_manager"] },
  { href: "/leaderboard", label: "Leaderboard", labelKey: "nav.leaderboard", icon: Trophy, roles: ["admin", "manager", "regional_manager", "worker", "checker"] },
  // Notifications moved to a navbar bell icon (AppShell) -- no longer a
  // sidebar entry.
  // Deliberately last and deliberately unrestricted: settings is per-user
  // (session info + a pointer to /profile), not an admin surface, so every
  // role sees it. Keep it at the bottom -- it's a destination users go
  // looking for, not one they navigate between like the feature routes above.
  { href: "/settings", label: "Settings", labelKey: "nav.settings", icon: Settings },
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
  const { t } = useTranslation();
  const pathname = usePathname();
  const { user } = useAuth();
  const onboarding = useMyOnboarding();
  const { isPathAllowed } = useOnboardingLockout();

  const items = NAV.filter((item) => {
    // Owner decision (2026-08-13): a user who is not yet active sees only
    // their own onboarding, plus Settings and Profile (both of which live in
    // the pinned footer below, not in this list, so they are unaffected by
    // this filter). Fails open — see useOnboardingLockout for why "no
    // employment record" must NOT lock (admins and 12 pre-ADR-065 accounts).
    // The route guard in AppShell enforces the same rule, so hiding a link
    // here is never the only thing standing between a locked user and a page.
    if (!isPathAllowed(item.href)) return false;
    if (item.roles && !(user && item.roles.includes(user.role))) return false;
    // Hide onboarding-gated items only once we KNOW there is no record.
    // While `phase === "loading"` the item is withheld rather than shown-then-
    // removed: a nav entry that appears and vanishes a moment later is worse
    // than one that arrives a moment late.
    if (item.requiresOwnOnboarding && onboarding.phase !== "active" && !onboarding.needsAttention) {
      return false;
    }
    return true;
  });
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
        title={collapsed ? t(item.labelKey) : undefined}
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
            <span className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
              {t(item.labelKey)}
              {/* Live onboarding status, only while it still needs action.
                  Once ACTIVE this renders nothing, so the entry degrades to a
                  plain "view my onboarding" link instead of a standing
                  reminder. Suppressed when collapsed for the same reason the
                  label is: the 64px rail has no room for it. */}
              {item.requiresOwnOnboarding && onboarding.needsAttention && (
                <Badge tone={onboarding.tone}>{onboarding.label}</Badge>
              )}
            </span>
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
