"use client";

import { useMyStats } from "@/hooks/useAnalytics";
import { BreakdownBar } from "@/components/analytics/BreakdownBar";
import { formatScore } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, Skeleton, StatTile } from "@/components/ui";

/**
 * GD-06 (`IF-ANALYTICS-GetMyStats`): a worker's own performance summary —
 * self-scoped, no `analytics:read` permission gate, distinct from the
 * manager-facing `/analytics` dashboard (`RoleGate allow={["manager",
 * "regional_manager", "admin"]}` there). Resolves the mobile-worker
 * dashboard's previously-silent 403 against that admin/manager-only route
 * (analytics/routes.ts's own comment on `/my-stats`) for the web app too.
 */
export function MyStatsCard() {
  const { data: stats, isLoading, error } = useMyStats();

  return (
    <Card>
      <CardHeader>
        <CardTitle>My performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="py-6 text-center text-sm text-red-600">
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
              <StatTile label="Completed shifts" value={stats.completed_assignments} />
              <StatTile label="Rooms completed" value={stats.rooms_completed} />
              <StatTile label="Average rating" value={formatScore(stats.average_rating, 2)} />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Attendance</p>
              <BreakdownBar
                segments={[
                  { label: "Present", value: stats.attendance.present, tone: "success" },
                  { label: "Late", value: stats.attendance.late, tone: "warning" },
                  { label: "Absent", value: stats.attendance.absent, tone: "danger" },
                ]}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
