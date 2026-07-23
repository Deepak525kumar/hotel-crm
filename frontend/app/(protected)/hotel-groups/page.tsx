"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useHotelGroups, useUserOptions } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Table,
  TBody,
  TableSkeleton,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

const PER_PAGE = 20;

export default function HotelGroupsPage() {
  const [page, setPage] = useState(1);
  const { groups, isLoading, error, hasNext } = useHotelGroups({
    page,
    limit: PER_PAGE,
  });
  const { users: managers } = useUserOptions({ role: "manager" });

  const managerName = useMemo(() => {
    const map = new Map(managers.map((m) => [m.id, `${m.first_name} ${m.last_name}`]));
    return (id: string) => map.get(id) ?? "—";
  }, [managers]);

  const columns = 2;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hotel groups"
        description="Regional groupings that scope managers and billing."
        actions={
          <RoleGate allow={["admin"]}>
            <Link href="/hotel-groups/new">
              <Button>New group</Button>
            </Link>
          </RoleGate>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load hotel groups. Please try again.
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Regional manager</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={columns} />
              ) : groups.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={columns} className="p-0">
                      <EmptyState
                        title="No hotel groups yet"
                        description="Groups let you assign a regional manager across several hotels."
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {groups.map((g) => (
                    <TR key={g.id}>
                      <TD className="font-medium">
                        <Link
                          href={`/hotel-groups/${g.id}`}
                          className="block text-blue-700 hover:underline"
                        >
                          {g.name}
                        </Link>
                      </TD>
                      <TD>{managerName(g.regional_manager_user_id)}</TD>
                    </TR>
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || isLoading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <span className="text-sm text-gray-500">Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext || isLoading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
