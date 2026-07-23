"use client";

import { useState } from "react";
import Link from "next/link";
import { useHotels } from "@/hooks/useHotels";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ManagerAdminGate } from "@/components/auth/RoleGate";
import {
  ActiveBadge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Pager,
  PageHeader,
  Select,
  Table,
  TBody,
  TableSkeleton,
  TD,
  TH,
  THead,
  TR,
  TextLink,
} from "@/components/ui";

const ACTIVE_FILTERS = [
  { value: "", label: "All hotels" },
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

const PER_PAGE = 20;

export default function HotelsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(searchInput.trim(), 300);

  // Reset to the first page whenever a filter changes.
  const onSearchChange = (value: string) => {
    setSearchInput(value);
    setPage(1);
  };
  const onActiveChange = (value: string) => {
    setActive(value);
    setPage(1);
  };

  const { hotels, isLoading, error, hasNext } = useHotels({
    search: search || undefined,
    is_active: (active || undefined) as "true" | "false" | undefined,
    page,
    limit: PER_PAGE,
  });

  const columns = 4;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hotels"
        description="Properties staffed through the platform."
        actions={
          <ManagerAdminGate>
            <Link href="/hotels/new">
              <Button>New hotel</Button>
            </Link>
          </ManagerAdminGate>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-xs">
          <Input
            label="Search"
            type="search"
            placeholder="Name or city…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            label="Status"
            value={active}
            onChange={(e) => onActiveChange(e.target.value)}
            options={ACTIVE_FILTERS}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load hotels. Please try again.
            </div>
          ) : (
            <Table aria-label="Hotels">
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Location</TH>
                  <TH>Timezone</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={columns} />
              ) : hotels.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={columns} className="p-0">
                      <EmptyState
                        title="No hotels found"
                        description={
                          search || active
                            ? "Try adjusting your search or filters."
                            : "Create your first hotel to start staffing shifts."
                        }
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {hotels.map((h) => (
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
                      <TD className="text-gray-500">{h.timezone}</TD>
                      <TD>
                        <ActiveBadge active={h.is_active} />
                      </TD>
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
