"use client";

import { useParams } from "next/navigation";
import { useGeoCheckin } from "@/hooks/useGeoCheckins";
import { useUser } from "@/hooks/useUsers";
import { useHotel } from "@/hooks/useHotels";
import { ApiError } from "@/lib/api";
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
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";

function GeoCheckinDetail({ id }: { id: string }) {
  const { data: checkin, isLoading, error } = useGeoCheckin(id);
  const { data: worker } = useUser(checkin?.worker_id);
  const { data: hotel } = useHotel(checkin?.hotel_id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-4 w-32" />
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !checkin) {
    return (
      <div className="space-y-4">
        <TextLink href="/geo-checkins" className="text-sm">
          ← Back to geo check-ins
        </TextLink>
        <Card>
          <CardContent className="text-sm text-red-600 dark:text-red-400">
            {error instanceof ApiError && error.status === 404
              ? "This geo check-in was not found."
              : "This geo check-in was not found or could not be loaded."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <TextLink href="/geo-checkins" className="text-sm">
          ← Back to geo check-ins
        </TextLink>
        <PageHeader
          className="mt-2"
          title={
            <span className="flex items-center gap-3">
              Geo check-in
              <GeofenceResultBadge insideRadius={checkin.inside_radius} />
            </span>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Verification</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow label="Checked at" value={formatDateTime(checkin.checked_at)} />
            <DataRow
              label="Distance from hotel"
              value={`${Math.round(checkin.distance_meters)}m`}
            />
            <DataRow
              label="Result"
              value={<GeofenceResultBadge insideRadius={checkin.inside_radius} />}
            />
          </DataList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow
              label="Worker"
              value={
                worker ? (
                  <TextLink href={`/users/${checkin.worker_id}`}>
                    {worker.first_name} {worker.last_name}
                  </TextLink>
                ) : (
                  checkin.worker_id
                )
              }
            />
            <DataRow
              label="Hotel"
              value={
                hotel ? (
                  <TextLink href={`/hotels/${checkin.hotel_id}`}>
                    {hotel.name}
                  </TextLink>
                ) : (
                  checkin.hotel_id
                )
              }
            />
          </DataList>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GeoCheckinDetailPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;

  return (
    <GeoCheckinsGate
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500 dark:text-gray-400">
            Geo check-ins are available to managers and admins.
          </CardContent>
        </Card>
      }
    >
      <GeoCheckinDetail id={id} />
    </GeoCheckinsGate>
  );
}
