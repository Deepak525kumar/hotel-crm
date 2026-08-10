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
 * shift, replacing the standalone /geo-checkins tab (SPEC-GEO-001 data has
 * no attendance_id/assignment_id link, so events are matched client-side by
 * worker_id + hotel_id, narrowed to the shift's check-in/check-out window).
 */
export function GeoVerificationCard({ record }: { record: Attendance }) {
  const { records, isLoading, error } = useGeoCheckins({
    worker_id: record.worker_id,
    hotel_id: record.hotel_id,
    per_page: 100,
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

  if (error) return null;

  const windowStart = record.check_in_at ?? record.expected_start;
  const windowEnd = record.check_out_at ?? record.expected_end;
  const inWindow = (checkedAt: string) => {
    if (!windowStart) return true;
    const t = new Date(checkedAt).getTime();
    const start = new Date(windowStart).getTime() - 30 * 60 * 1000;
    const end = windowEnd
      ? new Date(windowEnd).getTime() + 30 * 60 * 1000
      : Date.now();
    return t >= start && t <= end;
  };

  const shiftCheckins = records.filter((r) => inWindow(r.checked_at));

  if (shiftCheckins.length === 0) return null;

  return (
    <GeoCheckinsGate>
      <Card>
        <CardHeader>
          <CardTitle>Geo verification</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            {shiftCheckins.map((c) => (
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
