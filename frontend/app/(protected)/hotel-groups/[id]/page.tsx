"use client";

import Link from "next/link";
import { mutate as globalMutate } from "swr";
import { LifecycleCard } from "@/components/crm/LifecycleCard";
import { hotelGroupsApi } from "@/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useHotelGroup, useHotels, useUsersByIds } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
import { formatDateTime } from "@/lib/format";
import { useTranslation } from "react-i18next";
import {
  ActiveBadge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextLink,
} from "@/components/ui";

export default function HotelGroupDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: group, isLoading, error } = useHotelGroup(id);
  const router = useRouter();

  // Every lifecycle transition changes whether this group appears in
  // operational lists, so refresh the detail row and all list keys together.
  const runLifecycle = async (fn: () => Promise<unknown>, leavesPage = false) => {
    const result = await fn();
    await Promise.all([
      globalMutate(["hotel-group", id]),
      globalMutate((key) => Array.isArray(key) && key[0] === "hotel-groups"),
      // Member hotels' group association is unaffected by a soft delete, but
      // hotel lists surface group names -- keep them consistent.
      globalMutate((key) => Array.isArray(key) && key[0] === "hotels"),
    ]);
    if (leavesPage) router.push("/hotel-groups");
    return result;
  };

  // Server-side filtered by hotel_group_id — previously this fetched a flat
  // page of up to 100 hotels and filtered client-side, which silently
  // dropped a group's hotels once the platform had more than 100 hotels
  // total (or when they didn't happen to sort into that first page).
  const { hotels: groupHotels } = useHotels({ hotel_group_id: id, limit: 100 });

  // Person-centric assignment (2026-08-07): resolve the ASSIGNED regional
  // manager by id, not by searching a candidate list. useRegionalManagerCandidates()
  // returns users eligible to BE assigned; an already-assigned RM is not
  // guaranteed to appear in it, so the name silently failed to resolve and the
  // row fell back to rendering a raw user id. Same useUsersByIds pattern the
  // hotel detail page already uses for its Manager/Regional manager rows.
  const managerById = useUsersByIds(
    group?.regional_manager_user_id ? [group.regional_manager_user_id] : [],
  );
  const manager = group?.regional_manager_user_id
    ? managerById.get(group.regional_manager_user_id)
    : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <TextLink
        href="/hotel-groups"
        className="text-sm"
      >
        ← Back to hotel groups
      </TextLink>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load this hotel group.
          </CardContent>
        </Card>
      ) : isLoading || !group ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader
            title={group.name}
            actions={
              <div className="flex gap-2">
                <RoleGate allow={["admin", "regional_manager"]}>
                  <Link href={`/hotel-groups/${id}/org-chart`}>
                    <Button variant="outline">{t("hotels.orgChart")}</Button>
                  </Link>
                </RoleGate>
                <RoleGate allow={["admin"]}>
                  <Link href={`/hotel-groups/${id}/edit`}>
                    <Button variant="outline">{t("common.edit")}</Button>
                  </Link>
                </RoleGate>
              </div>
            }
          />

          <Card>
            <CardHeader>
              <CardTitle>{t("common.details")}</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <DataList>
                <DataRow
                  label={t("roles.regionalManager")}
                  value={
                    group.regional_manager_user_id ? (
                      <TextLink href={`/users/${group.regional_manager_user_id}`}>
                        {manager
                          ? `${manager.first_name} ${manager.last_name}`
                          : "View regional manager"}
                      </TextLink>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">
                        Vacant
                        {group.regional_manager_vacated_at &&
                          ` since ${formatDateTime(group.regional_manager_vacated_at)}`}
                        {group.regional_manager_vacancy_reason &&
                          group.regional_manager_vacancy_reason !== "NOT_ASSIGNED" &&
                          ` (${group.regional_manager_vacancy_reason.toLowerCase()})`}
                      </span>
                    )
                  }
                />
                <DataRow
                  label={t("hotelGroups.billingInfo")}
                  value={
                    group.billing_info || (
                      <span className="text-gray-500 dark:text-gray-400">{t("common.notSet")}</span>
                    )
                  }
                />
                <DataRow label={t("fields.created")} value={formatDateTime(group.created_at)} />
                <DataRow label={t("fields.updated")} value={formatDateTime(group.updated_at)} />
              </DataList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("hotels.inThisGroup")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {groupHotels.length === 0 ? (
                <EmptyState
                  title={t("hotelGroups.noHotelsAssigned")}
                  description={t("hotelGroups.assignHotelsHint")}
                />
              ) : (
                <Table aria-label={t("hotels.inThisGroup")}>
                  <THead>
                    <tr>
                      <TH>{t("fields.name")}</TH>
                      <TH>{t("fields.location")}</TH>
                      <TH>{t("fields.status")}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {groupHotels.map((h) => (
                      <TR key={h.id}>
                        <TD className="font-medium">
                          <TextLink
                            href={`/hotels/${h.id}`}
                            className="block"
                          >
                            {h.name}
                          </TextLink>
                        </TD>
                        <TD>
                          {h.city}, {h.country}
                        </TD>
                        <TD>
                          <ActiveBadge active={h.is_active} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Hotel groups had no lifecycle controls at all before 2026-08-07 --
              the only option was a hard delete that destroyed the row and
              silently detached every member hotel. */}
          <RoleGate allow={["admin"]}>
            <LifecycleCard
              label="hotel group"
              isActive={group.is_active}
              deletedAt={group.deleted_at ?? null}
              onDeactivate={() => runLifecycle(() => hotelGroupsApi.deactivate(id))}
              onReactivate={() => runLifecycle(() => hotelGroupsApi.reactivate(id))}
              onDelete={() => runLifecycle(() => hotelGroupsApi.remove(id), true)}
              onRestore={() => runLifecycle(() => hotelGroupsApi.restore(id))}
            />
          </RoleGate>
        </>
      )}
    </div>
  );
}
