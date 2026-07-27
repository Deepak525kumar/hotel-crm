"use client";

import { useState } from "react";
import { useGeoCheckins } from "@/hooks/useGeoCheckins";
import { GeoCheckinsGate } from "@/components/auth/RoleGate";
import { GeofenceResultBadge } from "@/components/geo/GeofenceResultBadge";
import { formatDateTime } from "@/lib/format";
import {
  Card,
  CardContent,
  EmptyState,
  Pager,
  PageHeader,
  Table,
  THead,
  TBody,
  TableSkeleton,
  TR,
  TH,
  TD,
  TextLink,
} from "@/components/ui";


const PER_PAGE = 20;
const COLUMNS = 5;

function GeoCheckinsList() {
  const [page, setPage] = useState(1);

  const { records, isLoading, error, hasNext } = useGeoCheckins({
    page,
    per_page: PER_PAGE,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Geo check-ins"
        description="Geofence verification events recorded when a worker checks in from their device."
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load geo check-ins. Please try again.
            </div>
          ) : (
            <Table aria-label="Geo check-ins">
              <THead>
                <tr>
                  <TH>Worker</TH>
                  <TH>Hotel</TH>
                  <TH>Checked at</TH>
                  <TH>Distance</TH>
                  <TH>Result</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : records.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title="No geo check-ins found"
                        description="Events appear once a worker verifies their location from the mobile app."
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {records.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium">
                        <TextLink href={`/geo-checkins/${r.id}`} className="block">
                          {r.worker_id}
                        </TextLink>
                      </TD>
                      <TD>{r.hotel_id}</TD>
                      <TD>{formatDateTime(r.checked_at)}</TD>
                      <TD>{Math.round(r.distance_meters)}m</TD>
                      <TD>
                        <GeofenceResultBadge insideRadius={r.inside_radius} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <Pager page={page} hasNext={hasNext} onPageChange={setPage} disabled={isLoading} />
    </div>
  );
}

export default function GeoCheckinsPage() {
  return (
    <GeoCheckinsGate
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500">
            Geo check-ins are available to managers and admins.
          </CardContent>
        </Card>
      }
    >
      <GeoCheckinsList />
    </GeoCheckinsGate>
  );
}
