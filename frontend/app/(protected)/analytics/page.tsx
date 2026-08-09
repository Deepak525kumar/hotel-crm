"use client";

import { useState } from "react";
import { useDashboardStats, useLeaderboard } from "@/hooks/useAnalytics";
import { useHotels } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
import { BreakdownBar } from "@/components/analytics/BreakdownBar";
import { LeaderboardTable } from "@/components/analytics/LeaderboardTable";
import { formatPercent, formatScore } from "@/lib/format";
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
  const [hotelId, setHotelId] = useState("");
  const scope = hotelId || undefined;

  const { data: stats, isLoading, error } = useDashboardStats(scope);
  const { entries, isLoading: leaderboardLoading, error: leaderboardError } =
    useLeaderboard(scope);
  const { hotels } = useHotels({ is_active: "true", limit: 100 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Operational performance across staffing, attendance and quality."
        actions={
          <div className="w-full sm:w-64">
            <Select
              aria-label="Scope"
              value={hotelId}
              onChange={(e) => setHotelId(e.target.value)}
            >
              <option value="">All hotels</option>
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
            Failed to load analytics. Please try again.
          </CardContent>
        </Card>
      ) : isLoading || !stats ? (
        <StatTilesSkeleton />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Open requests"
              value={stats.work_requests.open}
              hint={`${stats.work_requests.total} total`}
            />
            <StatTile
              label="On-time rate"
              value={formatPercent(stats.attendance.on_time_rate)}
              hint={`${stats.attendance.total} check-ins`}
            />
            <StatTile
              label="Quality pass rate"
              value={formatPercent(stats.quality.pass_rate)}
              hint={`${stats.quality.total_verifications} verifications`}
            />
            <StatTile
              label="Avg rating"
              value={formatScore(stats.ratings.average_score, 2)}
              hint={`${stats.ratings.total} ratings`}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Assignments"
              value={stats.assignments.total}
              hint={`${stats.assignments.completed} completed`}
            />
            <StatTile
              label="In progress"
              value={stats.assignments.in_progress}
            />
            <StatTile
              label="No-shows"
              value={stats.assignments.no_show}
            />
            <StatTile
              label="Rooms completed"
              value={stats.rooms_completed.total}
              hint={`${stats.rooms_completed.entries} entries`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Work requests</CardTitle>
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
                <CardTitle>Assignments</CardTitle>
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
                <CardTitle>Attendance</CardTitle>
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
          <CardTitle>Worker leaderboard</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LeaderboardTable
            entries={entries}
            isLoading={leaderboardLoading}
            error={leaderboardError}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <RoleGate
      allow={["manager", "regional_manager", "admin"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500 dark:text-gray-400">
            Analytics are available to managers and admins.
          </CardContent>
        </Card>
      }
    >
      <AnalyticsDashboard />
    </RoleGate>
  );
}
