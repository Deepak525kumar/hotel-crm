"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useHotelGroups, useRegionalManagerCandidates } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Pager,
  PageHeader,
  Table,
  TBody,
  TableSkeleton,
  TD,
  TH,
  THead,
  TR,
  TextLink,
} from "@/components/ui";

const PER_PAGE = 20;

export default function HotelGroupsPage() {
  const [page, setPage] = useState(1);
  const { groups, isLoading, error, hasNext } = useHotelGroups({
    page,
    limit: PER_PAGE,
  });
  const { users: managers } = useRegionalManagerCandidates();

  const managerName = useMemo(() => {
    const map = new Map(managers.map((m) => [m.id, `${m.first_name} ${m.last_name}`]));
    // Vacancy model (2026-08-06): null means the group has no RM assigned
    // right now, distinct from "assigned but not found in the candidate list".
    return (id: string | null) => (id ? map.get(id) ?? "—" : "Vacant");
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
            <Table aria-label="Hotel groups">
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
                        <TextLink
                          href={`/hotel-groups/${g.id}`}
                          className="block"
                        >
                          {g.name}
                        </TextLink>
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

      <Pager
        page={page}
        hasNext={hasNext}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
