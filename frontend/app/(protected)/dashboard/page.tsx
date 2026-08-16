"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardStats, useLeaderboard } from "@/hooks/useAnalytics";
import { RoleGate, StaffingWriteGate } from "@/components/auth/RoleGate";
import { LeaderboardTable } from "@/components/analytics/LeaderboardTable";
import { MyStatsCard } from "@/components/analytics/MyStatsCard";
import { OnboardingCallout } from "@/components/onboarding/OnboardingCallout";
import { RoleBadge } from "@/components/users/RoleBadge";
import { formatPercent, formatScore } from "@/lib/format";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Skeleton,
  StatTile,
  TextLink,
} from "@/components/ui";
import { useDirectionalArrow } from "@/components/ui/BackLink";

/** Quick links surfaced to every user. */
const QUICK_LINKS = [
  { href: "/requests", label: "Work requests" },
  { href: "/assignments", label: "My assignments" },
  { href: "/attendance", label: "Attendance" },
  { href: "/notifications", label: "Notifications" },
];

function ManagerOverview() {
  const { t } = useTranslation();
  const forwardArrow = useDirectionalArrow("forward");
  const { data: stats, isLoading, error } = useDashboardStats();
  const { entries, isLoading: leaderboardLoading, error: leaderboardError } =
    useLeaderboard();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("analytics.platformOverview")}
        </h2>
        <TextLink
          href="/analytics"
          className="text-sm"
        >
          {t("analytics.viewAnalytics")} {forwardArrow}
        </TextLink>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-red-600 dark:text-red-400">
            {t("analytics.statsLoadFailedShort")}
          </CardContent>
        </Card>
      ) : isLoading || !stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={t("analytics.openRequests")}
            value={stats.work_requests.open}
            hint={`${stats.work_requests.total} total`}
          />
          <StatTile
            label={t("analytics.onTimeRate")}
            value={formatPercent(stats.attendance.on_time_rate)}
          />
          <StatTile
            label={t("analytics.qualityPassRate")}
            value={formatPercent(stats.quality.pass_rate)}
          />
          <StatTile
            label={t("analytics.avgRating")}
            value={formatScore(stats.ratings.average_score, 2)}
          />
        </div>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t("users.topWorkers")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LeaderboardTable
            entries={entries}
            isLoading={leaderboardLoading}
            error={leaderboardError}
            limit={5}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const forwardArrow = useDirectionalArrow("forward");
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.dashboard")}
        description={`Welcome back${user ? `, ${user.first_name}` : ""}.`}
      />

      {/* Owner decision 2026-08-12: a brand-new user had NO way to discover
          /onboarding in the UI — the route worked only if you typed it. This
          sits directly under the page header (above "Your account") because
          for an applicant it is the single most important action on the page.
          It self-hides once the record is ACTIVE, and renders nothing at all
          for a user with no onboarding record, so it costs an established
          employee or an Admin no vertical space. */}
      <OnboardingCallout />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("users.yourAccount")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            <p>{user?.email}</p>
            {user && <RoleBadge role={user.role} />}
            <p>
              <TextLink
                href="/profile"
              >
                {t("profile.viewProfile")} {forwardArrow}
              </TextLink>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("common.quickLinks")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {QUICK_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="block rounded-md border border-gray-200 px-3 py-2 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <StaffingWriteGate>
        <ManagerOverview />
      </StaffingWriteGate>

      {/* GD-06: worker-only, self-scoped equivalent of ManagerOverview above
          — no leaderboard, no other worker's data (see MyStatsCard's own
          comment). Previously only reachable from /profile. */}
      <RoleGate allow={["worker"]}>
        <MyStatsCard />
      </RoleGate>
    </div>
  );
}
