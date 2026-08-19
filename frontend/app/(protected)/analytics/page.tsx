"use client";

import { useState } from "react";
import Link from "next/link";
import { useDashboardStats, useLeaderboard } from "@/hooks/useAnalytics";
import { useHotels } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
import { BreakdownBar } from "@/components/analytics/BreakdownBar";
import { LeaderboardTable } from "@/components/analytics/LeaderboardTable";
import { formatPercent, formatScore } from "@/lib/format";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Select,
  Skeleton,
  StatTile,
} from "@/components/ui";

function StatTilesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function AnalyticsDashboard() {
  const { t } = useTranslation();
  const [hotelId, setHotelId] = useState("");
  const scope = hotelId || undefined;

  const { data: stats, isLoading, error } = useDashboardStats(scope);
  const { entries, isLoading: leaderboardLoading, error: leaderboardError } =
    useLeaderboard(scope);
  const { hotels } = useHotels({ is_active: "true", limit: 100 });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.analytics")}
        description={t("analytics.description")}
        actions={
          <div className="w-full sm:w-64">
            <Select
              aria-label={t("analytics.scope")}
              value={hotelId}
              onChange={(e) => setHotelId(e.target.value)}
            >
              <option value="">{t("filters.allHotels")}</option>
              {hotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            {t("analytics.loadFailed")}
          </CardContent>
        </Card>
      ) : isLoading || !stats ? (
        <StatTilesSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t("analytics.openRequests")}
              value={stats.work_requests.open}
              hint={`${stats.work_requests.total} total`}
            />
            <StatTile
              label={t("analytics.onTimeRate")}
              value={formatPercent(stats.attendance.on_time_rate)}
              hint={`${stats.attendance.total} check-ins`}
            />
            <StatTile
              label={t("analytics.qualityPassRate")}
              value={formatPercent(stats.quality.pass_rate)}
              hint={`${stats.quality.total_verifications} verifications`}
            />
            <StatTile
              label={t("analytics.avgRating")}
              value={formatScore(stats.ratings.average_score, 2)}
              hint={`${stats.ratings.total} ratings`}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t("nav.assignments")}
              value={stats.assignments.total}
              hint={`${stats.assignments.completed} completed`}
            />
            <StatTile
              label={t("status.inProgress")}
              value={stats.assignments.in_progress}
            />
            <StatTile
              label={t("analytics.noShows")}
              value={stats.assignments.no_show}
            />
            <StatTile
              label={t("assignments.roomsCompleted")}
              value={stats.rooms_completed.total}
              hint={`${stats.rooms_completed.entries} entries`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>{t("nav.requests")}</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownBar
                  segments={[
                    { label: "Open", value: stats.work_requests.open, tone: "info" },
                    {
                      label: "Partial",
                      value: stats.work_requests.partially_filled,
                      tone: "warning",
                    },
                    {
                      label: "Filled",
                      value: stats.work_requests.filled,
                      tone: "success",
                    },
                    {
                      label: "Cancelled",
                      value: stats.work_requests.cancelled,
                      tone: "neutral",
                    },
                    {
                      label: "Expired",
                      value: stats.work_requests.expired,
                      tone: "neutral",
                    },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("nav.assignments")}</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownBar
                  segments={[
                    {
                      label: "Completed",
                      value: stats.assignments.completed,
                      tone: "success",
                    },
                    {
                      label: "In progress",
                      value: stats.assignments.in_progress,
                      tone: "info",
                    },
                    {
                      label: "No-show",
                      value: stats.assignments.no_show,
                      tone: "danger",
                    },
                    {
                      label: "Cancelled",
                      value: stats.assignments.cancelled,
                      tone: "neutral",
                    },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("nav.attendance")}</CardTitle>
              </CardHeader>
              <CardContent>
                <BreakdownBar
                  segments={[
                    {
                      label: "Present",
                      value: stats.attendance.present,
                      tone: "success",
                    },
                    {
                      label: "Late",
                      value: stats.attendance.late,
                      tone: "warning",
                    },
                    {
                      label: "Absent",
                      value: stats.attendance.absent,
                      tone: "danger",
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("users.leaderboard")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LeaderboardTable
            entries={entries}
            isLoading={leaderboardLoading}
            error={leaderboardError}
            limit={5}
          />
          <div className="border-t border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-800 dark:bg-gray-900/50">
            <Link href="/leaderboard" className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400">
              View full leaderboard &rarr;
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  const { t } = useTranslation();
  return (
    <RoleGate
      allow={["manager", "regional_manager", "admin"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500 dark:text-gray-400">
            {t("analytics.noPermission")}
          </CardContent>
        </Card>
      }
    >
      <AnalyticsDashboard />
    </RoleGate>
  );
}
