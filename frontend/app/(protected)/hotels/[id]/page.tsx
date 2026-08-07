"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useHotel, useHotelGroup, useUsersByIds } from "@/hooks/useHotels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { hotelsApi } from "@/lib/api";
import { HotelWriteGate } from "@/components/auth/RoleGate";
import { BlocklistCard } from "@/components/employees/BlocklistCard";
import { formatDateTime } from "@/lib/format";
import {
  ActiveBadge,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  FormError,
  Modal,
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";

export default function HotelDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { data: hotel, isLoading, error } = useHotel(id);
  const { data: group } = useHotelGroup(hotel?.hotel_group_id);
  const managerIds = [
    ...(hotel?.manager_user_id ? [hotel.manager_user_id] : []),
    ...(group?.regional_manager_user_id ? [group.regional_manager_user_id] : []),
  ];
  const managerById = useUsersByIds(managerIds);
  const manager = hotel?.manager_user_id ? managerById.get(hotel.manager_user_id) : undefined;
  const regionalManager = group?.regional_manager_user_id
    ? managerById.get(group.regional_manager_user_id)
    : undefined;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const deactivate = useAsyncAction();
  const reactivate = useAsyncAction();

  const onReactivate = () =>
    reactivate.run(
      async () => {
        await hotelsApi.reactivate(id);
        // Same invalidation set as deactivate: the detail row plus every
        // hotels list, since is_active/deleted_at change what those return.
        await Promise.all([
          globalMutate(["hotel", id]),
          globalMutate((key) => Array.isArray(key) && key[0] === "hotels"),
        ]);
      },
      { errorMessage: "Could not reactivate this hotel. Please try again." },
    );

  const onDeactivate = () =>
    deactivate.run(
      async () => {
        await hotelsApi.remove(id);
        await Promise.all([
          globalMutate(["hotel", id]),
          globalMutate((key) => Array.isArray(key) && key[0] === "hotels"),
        ]);
      },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          router.push("/hotels");
        },
      },
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <TextLink href="/hotels" className="text-sm">
        ← Back to hotels
      </TextLink>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
            Failed to load this hotel. It may have been removed.
          </CardContent>
        </Card>
      ) : isLoading || !hotel ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader
            title={
              <span className="flex items-center gap-3">
                {hotel.name}
                <ActiveBadge active={hotel.is_active} />
                {!hotel.accepting_jobs && (
                  <Badge tone="warning">Not accepting new work requests</Badge>
                )}
              </span>
            }
            description={`${hotel.city}, ${hotel.country}`}
            actions={
              <HotelWriteGate>
                <Link href={`/hotels/${id}/edit`}>
                  <Button variant="outline">Edit</Button>
                </Link>
              </HotelWriteGate>
            }
          />

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <DataList>
                <DataRow label="Address" value={hotel.address} />
                <DataRow label="City" value={hotel.city} />
                <DataRow label="Country" value={hotel.country} />
                <DataRow label="Timezone" value={hotel.timezone} />
                <DataRow
                  label="Hotel group"
                  value={
                    hotel.hotel_group_id ? (
                      <TextLink
                        href={`/hotel-groups/${hotel.hotel_group_id}`}
                      >
                        {group?.name ?? "View group"}
                      </TextLink>
                    ) : (
                      <span className="text-gray-500">Unassigned</span>
                    )
                  }
                />
                <DataRow
                  label="Manager"
                  value={
                    hotel.manager_user_id ? (
                      <TextLink href={`/users/${hotel.manager_user_id}`}>
                        {manager ? `${manager.first_name} ${manager.last_name}` : "View manager"}
                      </TextLink>
                    ) : (
                      <span className="text-gray-500">
                        Vacant
                        {hotel.manager_vacated_at && ` since ${formatDateTime(hotel.manager_vacated_at)}`}
                        {hotel.manager_vacancy_reason &&
                          hotel.manager_vacancy_reason !== "NOT_ASSIGNED" &&
                          ` (${hotel.manager_vacancy_reason.toLowerCase()})`}
                      </span>
                    )
                  }
                />
                <DataRow
                  label="Regional manager"
                  value={
                    group?.regional_manager_user_id ? (
                      <TextLink href={`/users/${group.regional_manager_user_id}`}>
                        {regionalManager
                          ? `${regionalManager.first_name} ${regionalManager.last_name}`
                          : "View regional manager"}
                      </TextLink>
                    ) : hotel.hotel_group_id ? (
                      <span className="text-gray-500">
                        Vacant
                        {group?.regional_manager_vacated_at &&
                          ` since ${formatDateTime(group.regional_manager_vacated_at)}`}
                        {group?.regional_manager_vacancy_reason &&
                          group.regional_manager_vacancy_reason !== "NOT_ASSIGNED" &&
                          ` (${group.regional_manager_vacancy_reason.toLowerCase()})`}
                      </span>
                    ) : (
                      <span className="text-gray-500">No hotel group assigned</span>
                    )
                  }
                />
                <DataRow
                  label="Geofence"
                  value={
                    hotel.latitude != null && hotel.longitude != null ? (
                      <span className="text-green-700">
                        Configured ({hotel.latitude.toFixed(4)}, {hotel.longitude.toFixed(4)})
                      </span>
                    ) : (
                      <span className="text-gray-500">
                        Not set — worker check-in unavailable
                      </span>
                    )
                  }
                />
                <DataRow label="Created" value={formatDateTime(hotel.created_at)} />
                <DataRow label="Updated" value={formatDateTime(hotel.updated_at)} />
              </DataList>
            </CardContent>
          </Card>

          <BlocklistCard hotelId={id} />

          <HotelWriteGate>
            {hotel.is_active ? (
              <Card className="border-red-100">
                <CardContent className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Deactivate hotel
                    </p>
                    <p className="text-sm text-gray-500">
                      Hides the hotel from workers and closes it to new staffing.
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    onClick={() => setConfirmOpen(true)}
                  >
                    Deactivate
                  </Button>
                </CardContent>
              </Card>
            ) : (
              /* Added 2026-08-07: deactivating was one-way from the UI. The
                 card above only renders while is_active, so once deactivated
                 there was no control left anywhere to bring the hotel back. */
              <Card>
                <CardContent className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Reactivate hotel
                    </p>
                    <p className="text-sm text-gray-500">
                      Makes the hotel visible to workers again and reopens it for
                      staffing and manager assignment.
                    </p>
                  </div>
                  <Button
                    onClick={onReactivate}
                    loading={reactivate.pending}
                    className="shrink-0"
                  >
                    Reactivate
                  </Button>
                </CardContent>
                <FormError className="px-6 pb-4">{reactivate.error}</FormError>
              </Card>
            )}
          </HotelWriteGate>
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => !deactivate.pending && setConfirmOpen(false)}
        title="Deactivate hotel"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deactivate.pending}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={onDeactivate} loading={deactivate.pending}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          This deactivates <span className="font-medium">{hotel?.name}</span>. You
          can reactivate it later from the edit screen.
        </p>
        <FormError className="mt-3">{deactivate.error}</FormError>
      </Modal>
    </div>
  );
}
