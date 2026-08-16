"use client";

import { useMyStats } from "@/hooks/useAnalytics";
import { BreakdownBar } from "@/components/analytics/BreakdownBar";
import { formatDate, formatPercent, formatScore } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, Skeleton, StatTile } from "@/components/ui";
import { useTranslation } from "react-i18next";

/**
 * GD-06 (`IF-ANALYTICS-GetMyStats`): a worker's own performance summary —
 * self-scoped, no `analytics:read` permission gate. Distinct from the
 * manager-facing `/analytics` dashboard, which is already correctly
 * `RoleGate`-restricted to `manager`/`regional_manager`/`admin` and was
 * never reachable by a worker — this card just gives workers their own
 * equivalent view, which had no home in the web app until now.
 *
 * 2026-08-09: extended with total_assignments/attendance_rate/current_month/
 * recent_ratings. Deliberately still nothing peer-identifying — no other
 * worker's name/rating, no rank/position, no leaderboard data — that
 * boundary is GD-06's whole point, re-confirmed rather than relaxed.
 */
export function MyStatsCard() {
  const { t } = useTranslation();
  const { data: stats, isLoading, error } = useMyStats();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("analytics.myPerformance")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load your stats.
          </p>
        ) : isLoading || !stats ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label={t("analytics.completedShifts")} value={stats.completed_assignments} />
              <StatTile label={t("analytics.totalShifts")} value={stats.total_assignments} />
              <StatTile label={t("assignments.roomsCompleted")} value={stats.rooms_completed} />
              <StatTile label={t("analytics.averageRating")} value={formatScore(stats.average_rating, 2)} />
              <StatTile label={t("analytics.attendanceRate")} value={formatPercent(stats.attendance_rate)} />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t("nav.attendance")}</p>
              <BreakdownBar
                segments={[
                  { label: "Present", value: stats.attendance.present, tone: "success" },
                  { label: "Late", value: stats.attendance.late, tone: "warning" },
                  { label: "Absent", value: stats.attendance.absent, tone: "danger" },
                ]}
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t("common.thisMonth")}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatTile label={t("analytics.shifts")} value={stats.current_month.assignments} />
                <StatTile label={t("status.completed")} value={stats.current_month.completed} />
                <StatTile
                  label={t("analytics.averageRating")}
                  value={formatScore(stats.current_month.average_rating, 2)}
                />
              </div>
            </div>

            {stats.recent_ratings.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t("analytics.recentRatings")}</p>
                <ul className="space-y-1">
                  {stats.recent_ratings.map((r) => (
                    <li
                      key={r.assignment_id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-gray-600 dark:text-gray-400">{formatDate(r.created_at)}</span>
                      <span className="font-medium">{formatScore(r.rating, 0)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
