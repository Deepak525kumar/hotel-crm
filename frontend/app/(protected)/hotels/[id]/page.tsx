"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useHotel, useHotelGroup } from "@/hooks/useHotels";
import { ApiError, hotelsApi } from "@/lib/api";
import { RoleGate, ManagerAdminGate } from "@/components/auth/RoleGate";
import { formatDateTime } from "@/lib/format";
import {
  ActiveBadge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  Modal,
  PageHeader,
  Skeleton,
} from "@/components/ui";

export default function HotelDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { data: hotel, isLoading, error } = useHotel(id);
  const { data: group } = useHotelGroup(hotel?.hotel_group_id);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const deactivate = async () => {
    setActionError(null);
    setDeactivating(true);
    try {
      await hotelsApi.remove(id);
      await Promise.all([
        globalMutate(["hotel", id]),
        globalMutate((key) => Array.isArray(key) && key[0] === "hotels"),
      ]);
      setConfirmOpen(false);
      router.push("/hotels");
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setDeactivating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/hotels" className="text-sm text-blue-700 hover:underline">
        ← Back to hotels
      </Link>

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
              </span>
            }
            description={`${hotel.city}, ${hotel.country}`}
            actions={
              <ManagerAdminGate>
                <Link href={`/hotels/${id}/edit`}>
                  <Button variant="outline">Edit</Button>
                </Link>
              </ManagerAdminGate>
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
                      <Link
                        href={`/hotel-groups/${hotel.hotel_group_id}`}
                        className="text-blue-700 hover:underline"
                      >
                        {group?.name ?? "View group"}
                      </Link>
                    ) : (
                      <span className="text-gray-400">Unassigned</span>
                    )
                  }
                />
                <DataRow label="Created" value={formatDateTime(hotel.created_at)} />
                <DataRow label="Updated" value={formatDateTime(hotel.updated_at)} />
              </DataList>
            </CardContent>
          </Card>

          <RoleGate allow={["admin"]}>
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
          </RoleGate>
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => !deactivating && setConfirmOpen(false)}
        title="Deactivate hotel"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deactivating}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={deactivate} loading={deactivating}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          This deactivates <span className="font-medium">{hotel?.name}</span>. You
          can reactivate it later from the edit screen.
        </p>
        {actionError && (
          <p className="mt-3 text-sm text-red-600">{actionError}</p>
        )}
      </Modal>
    </div>
  );
}
