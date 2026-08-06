"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useHotelGroup, useHotels, useUsersByIds } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
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
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: group, isLoading, error } = useHotelGroup(id);

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
          <CardContent className="py-10 text-center text-sm text-red-600">
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
                    <Button variant="outline">Org chart</Button>
                  </Link>
                </RoleGate>
                <RoleGate allow={["admin"]}>
                  <Link href={`/hotel-groups/${id}/edit`}>
                    <Button variant="outline">Edit</Button>
                  </Link>
                </RoleGate>
              </div>
            }
          />

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <DataList>
                <DataRow
                  label="Regional manager"
                  value={
                    group.regional_manager_user_id ? (
                      <TextLink href={`/users/${group.regional_manager_user_id}`}>
                        {manager
                          ? `${manager.first_name} ${manager.last_name}`
                          : "View regional manager"}
                      </TextLink>
                    ) : (
                      <span className="text-gray-500">
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
                  label="Billing info"
                  value={
                    group.billing_info || (
                      <span className="text-gray-500">Not set</span>
                    )
                  }
                />
                <DataRow label="Created" value={formatDateTime(group.created_at)} />
                <DataRow label="Updated" value={formatDateTime(group.updated_at)} />
              </DataList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hotels in this group</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {groupHotels.length === 0 ? (
                <EmptyState
                  title="No hotels assigned"
                  description="Assign hotels to this group from a hotel's edit screen."
                />
              ) : (
                <Table aria-label="Hotels in this group">
                  <THead>
                    <tr>
                      <TH>Name</TH>
                      <TH>Location</TH>
                      <TH>Status</TH>
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
        </>
      )}
    </div>
  );
}
