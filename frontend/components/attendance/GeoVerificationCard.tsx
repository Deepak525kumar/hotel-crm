"use client";

import { useGeoCheckins } from "@/hooks/useGeoCheckins";
import { GeoCheckinsGate } from "@/components/auth/RoleGate";
import { GeofenceResultBadge } from "@/components/geo/GeofenceResultBadge";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  Skeleton,
} from "@/components/ui";
import type { Attendance } from "@/lib/types";

/**
 * Embeds the geofence-verification events tied to one attendance record's
 * shift, replacing the standalone /geo-checkins tab. Exact match via
 * WorkerGeoCheckin.attendance_id (OD-GEO-010, SPEC-GEO-001 amendment) — set
 * by AttendanceService whenever it calls GeoService.verifyGeofence() during
 * check-in/check-out, so no client-side heuristic is needed.
 */
export function GeoVerificationCard({ record }: { record: Attendance }) {
  const { records, isLoading, error } = useGeoCheckins({
    attendance_id: record.id,
    per_page: 20,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Geo verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 py-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Geo verification</CardTitle>
        </CardHeader>
        <CardContent className="py-2 text-sm text-red-600 dark:text-red-400">
          Failed to load geo verification data.
        </CardContent>
      </Card>
    );
  }

  if (records.length === 0) return null;

  return (
    <GeoCheckinsGate>
      <Card>
        <CardHeader>
          <CardTitle>Geo verification</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            {records.map((c) => (
              <DataRow
                key={c.id}
                label={formatDateTime(c.checked_at)}
                value={
                  <span className="flex items-center gap-2">
                    {Math.round(c.distance_meters)}m
                    <GeofenceResultBadge insideRadius={c.inside_radius} />
                  </span>
                }
              />
            ))}
          </DataList>
        </CardContent>
      </Card>
    </GeoCheckinsGate>
  );
}
