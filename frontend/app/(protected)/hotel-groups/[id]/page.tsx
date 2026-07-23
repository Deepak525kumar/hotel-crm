"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useHotelGroup,
  useHotels,
  useUserOptions,
} from "@/hooks/useHotels";
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
  const { users: managers } = useUserOptions({ role: "manager" });
  // Hotels carrying this group id (the list endpoint doesn't filter by group,
  // so we request a wide page and narrow client-side).
  const { hotels } = useHotels({ limit: 100 });

  const manager = useMemo(
    () => managers.find((m) => m.id === group?.regional_manager_user_id),
    [managers, group],
  );
  const groupHotels = useMemo(
    () => hotels.filter((h) => h.hotel_group_id === id),
    [hotels, id],
  );

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
              <RoleGate allow={["admin"]}>
                <Link href={`/hotel-groups/${id}/edit`}>
                  <Button variant="outline">Edit</Button>
                </Link>
              </RoleGate>
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
                    manager
                      ? `${manager.first_name} ${manager.last_name}`
                      : group.regional_manager_user_id
                  }
                />
                <DataRow
                  label="Billing info"
                  value={
                    group.billing_info || (
                      <span className="text-gray-400">Not set</span>
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
                <Table>
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
