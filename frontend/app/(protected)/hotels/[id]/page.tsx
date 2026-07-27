"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useHotel, useHotelGroup } from "@/hooks/useHotels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { hotelsApi } from "@/lib/api";
import { HotelWriteGate } from "@/components/auth/RoleGate";
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

  const [confirmOpen, setConfirmOpen] = useState(false);
  const deactivate = useAsyncAction();

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
                <DataRow label="Created" value={formatDateTime(hotel.created_at)} />
                <DataRow label="Updated" value={formatDateTime(hotel.updated_at)} />
              </DataList>
            </CardContent>
          </Card>

          <HotelWriteGate>
            {hotel.is_active && (
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
