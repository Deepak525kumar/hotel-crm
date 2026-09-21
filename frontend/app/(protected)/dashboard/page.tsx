"use client";

import { useAuth } from "@/hooks/useAuth";
import { useDashboardStats, useLeaderboard } from "@/hooks/useAnalytics";
import { RoleGate, StaffingWriteGate } from "@/components/auth/RoleGate";
import { LeaderboardTable } from "@/components/analytics/LeaderboardTable";
import { MyStatsCard } from "@/components/analytics/MyStatsCard";
import { OnboardingCallout } from "@/components/onboarding/OnboardingCallout";
import { ManagerActionRequired } from "@/components/dashboard/ManagerActionRequired";
import { ManagerRecentActivity } from "@/components/dashboard/ManagerRecentActivity";
import { WorkerUpcomingSchedule } from "@/components/dashboard/WorkerUpcomingSchedule";
import { WorkerAlerts } from "@/components/dashboard/WorkerAlerts";
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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



      <StaffingWriteGate>
        {/* `grid-cols-1` IS THE FIX, not decoration. With no explicit column
            below `sm`, the grid gets one implicit `auto` track, and an auto
            track grows to fit its widest content -- so a single notification
            title with a long unbroken string (an email, an id, a German
            compound) widened the whole page past a phone's edge. Reported on
            the admin dashboard, whose notifications carry exactly that kind of
            text. `grid-cols-1` compiles to `minmax(0, 1fr)`, a track that is
            allowed to shrink.

            It also explains a second report: the Zelle launcher is `fixed` at
            `right: 1rem`, and once the page is wider than the screen that
            edge is off-screen. The launcher was never missing -- it was
            parked beyond the right-hand side of a page that had grown. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
          <ManagerActionRequired />
          <ManagerRecentActivity />
        </div>
        <ManagerOverview />
      </StaffingWriteGate>

      {/* GD-06: worker-only, self-scoped equivalent of ManagerOverview above
          — no leaderboard, no other worker's data (see MyStatsCard's own
          comment). Previously only reachable from /profile. */}
      {/* `checker` added 2026-09-22. A checker signing in got a BLANK page:
          the block above is gated to staffing-write roles and this one was
          gated to `worker`, so a checker matched neither and the dashboard
          rendered nothing at all.

          These three cards need no checker-specific version, which is why none
          was written. Each is self-scoped on the server and already serves the
          role: /assignments narrows to the caller for any self-scoped role and
          `isSelfScopedRole` counts `checker` (lib/scope.ts), /analytics/my-stats
          is deliberately ungated ("any authenticated role, no admin/manager
          permission gate"), and GET /hr/payroll lists `checker` among its
          allowed roles. The mobile checker home fetches this same trio. */}
      <RoleGate allow={["worker", "checker"]}>
        {/* Same flaw as the manager row above, not yet reported only because a
            worker's notifications happen to be short. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
          <WorkerUpcomingSchedule />
          <WorkerAlerts />
        </div>
        <MyStatsCard />
      </RoleGate>
    </div>
  );
}
