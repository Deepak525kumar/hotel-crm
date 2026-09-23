"use client";

import { LifecycleCard } from "@/components/crm/LifecycleCard";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useHotel, useHotelGroup, useUsersByIds } from "@/hooks/useHotels";
import { ApiError } from "@/lib/api";
import { hotelsApi } from "@/lib/api";
import { HotelWriteGate, BlocklistReadGate, RoleGate } from "@/components/auth/RoleGate";
import { BlocklistCard } from "@/components/employees/BlocklistCard";
import { RoomsLoggedTodayCard } from "@/components/rooms/RoomsLoggedTodayCard";
import { formatDateTime } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/auth";
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
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";

export default function HotelDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const isWorker = currentUser?.role === "worker";

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

  // One invalidation set for every lifecycle transition: all four change
  // whether this hotel appears in operational lists, so the detail row and
  // every list key must both be refreshed.
  const runLifecycle = async (fn: () => Promise<unknown>, leavesPage = false) => {
    const result = await fn();
    await Promise.all([
      globalMutate(["hotel", id]),
      globalMutate((key) => Array.isArray(key) && key[0] === "hotels"),
    ]);
    // A deleted hotel is no longer visible on its own detail page, so stay
    // there only for the reversible transitions.
    if (leavesPage) router.push("/hotels");
    return result;
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackLink href="/hotels" className="text-sm" labelKey="common.backTo.hotels" />

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            {/*
              A 403 is not a deletion (2026-09-23).

              Every failure here rendered "It may have been removed", so a
              manager opening a hotel outside their scope was told the property
              had been deleted. Reported as "Failed to load this hotel" against
              a hotel that plainly still exists. Three distinct causes reach
              this branch and only one of them is a removal:
                403 -> not in your scope
                404 -> no such hotel, or soft-deleted
                anything else -> a real failure
            */}
            {error instanceof ApiError && error.status === 403
              ? t("errors.forbidden")
              : error instanceof ApiError && error.status === 404
                ? t("hotels.loadOneFailedRemoved")
                : t("hotels.loadOneFailed")}
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
                {hotel.is_active && !hotel.accepting_jobs ? (
                  <Badge tone="warning">{t("requests.notAcceptingNew")}</Badge>
                ) : (
                  <ActiveBadge active={hotel.is_active} />
                )}
              </span>
            }
            description={`${hotel.city}, ${hotel.country}`}
            actions={
              <HotelWriteGate>
                <Link href={`/hotels/${id}/edit`}>
                  <Button variant="outline">{t("common.edit")}</Button>
                </Link>
              </HotelWriteGate>
            }
          />

          <Card>
            <CardHeader>
              <CardTitle>{t("common.details")}</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <DataList>
                <DataRow label={t("fields.address")} value={hotel.address} />
                <DataRow label={t("fields.city")} value={hotel.city} />
                <DataRow label={t("fields.country")} value={hotel.country} />
                <DataRow label={t("fields.timezone")} value={hotel.timezone} />
                <DataRow
                  label={t("fields.hotelGroup")}
                  value={
                    hotel.hotel_group_id ? (
                      isWorker ? (
                        <span>{hotel.hotel_group_name ?? "View group"}</span>
                      ) : (
                        <TextLink
                          href={`/hotel-groups/${hotel.hotel_group_id}`}
                        >
                          {group?.name ?? "View group"}
                        </TextLink>
                      )
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">{t("status.unassigned")}</span>
                    )
                  }
                />
                <DataRow
                  label={t("roles.manager")}
                  value={
                    hotel.manager_user_id ? (
                      isWorker ? (
                        <span>{hotel.manager_name ?? "View manager"}</span>
                      ) : (
                        <TextLink href={`/users/${hotel.manager_user_id}`}>
                          {manager ? `${manager.first_name} ${manager.last_name}` : "View manager"}
                        </TextLink>
                      )
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">
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
                  label={t("roles.regionalManager")}
                  value={
                    hotel.hotel_group_id && hotel.regional_manager_name ? (
                      isWorker ? (
                        <span>{hotel.regional_manager_name}</span>
                      ) : group?.regional_manager_user_id ? (
                        <TextLink href={`/users/${group.regional_manager_user_id}`}>
                          {regionalManager
                            ? `${regionalManager.first_name} ${regionalManager.last_name}`
                            : "View regional manager"}
                        </TextLink>
                      ) : null
                    ) : hotel.hotel_group_id ? (
                      <span className="text-gray-500 dark:text-gray-400">
                        Vacant
                        {group?.regional_manager_vacated_at &&
                          ` since ${formatDateTime(group.regional_manager_vacated_at)}`}
                        {group?.regional_manager_vacancy_reason &&
                          group.regional_manager_vacancy_reason !== "NOT_ASSIGNED" &&
                          ` (${group.regional_manager_vacancy_reason.toLowerCase()})`}
                      </span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">{t("hotels.noGroup")}</span>
                    )
                  }
                />
                <DataRow
                  label={t("fields.geofence")}
                  value={
                    hotel.latitude != null && hotel.longitude != null ? (
                      <span className="text-green-700 dark:text-green-400">
                        Configured ({hotel.latitude.toFixed(4)}, {hotel.longitude.toFixed(4)})
                      </span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">
                        {t("hotels.geofenceNotSet")}
                      </span>
                    )
                  }
                />
                <DataRow label={t("fields.created")} value={formatDateTime(hotel.created_at)} />
                <DataRow label={t("fields.updated")} value={formatDateTime(hotel.updated_at)} />
              </DataList>
            </CardContent>
          </Card>

          {hotel.latitude != null && hotel.longitude != null && (
            <Card>
              <CardHeader>
                <CardTitle>{t("hotels.locationMap")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                  <iframe
                    width="100%"
                    height="300"
                    style={{ border: 0 }}
                    loading="lazy"
                    allowFullScreen
                    src={`https://maps.google.com/maps?q=${hotel.latitude},${hotel.longitude}&z=15&output=embed`}
                  ></iframe>
                </div>
                <div className="flex justify-end">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${hotel.latitude},${hotel.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    {t("common.getDirections")}
                  </a>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Roles match `GET /rooms/for-hotels` exactly
              (requireRole(['manager','regional_manager','admin']) +
              rooms:read), so no role that reaches this card gets a page of
              403s — a checker or worker sees their own rooms through /rooms
              instead, which is a different, self-scoped endpoint. */}
          <RoleGate allow={["admin", "manager", "regional_manager"]}>
            <RoomsLoggedTodayCard hotelId={id} />
          </RoleGate>

          <BlocklistReadGate>
            <BlocklistCard hotelId={id} />
          </BlocklistReadGate>

          <HotelWriteGate>
            <LifecycleCard
              entity="hotel"
              isActive={hotel.is_active}
              deletedAt={hotel.deleted_at ?? null}
              onDeactivate={() => runLifecycle(() => hotelsApi.deactivate(id))}
              onReactivate={() => runLifecycle(() => hotelsApi.reactivate(id))}
              onDelete={() => runLifecycle(() => hotelsApi.remove(id), true)}
              onRestore={() => runLifecycle(() => hotelsApi.restore(id))}
            />
          </HotelWriteGate>
        </>
      )}


    </div>
  );
}
