"use client";

import { useState } from "react";
import Link from "next/link";
import { useCalendarEntries } from "@/hooks/useAssignments";
import { useHotel, useUsersByIds } from "@/hooks/useHotels";
import { StaffingWriteGate } from "@/components/auth/RoleGate";
import { formatDate } from "@/lib/format";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Pager,
  PageHeader,
  Table,
  THead,
  TBody,
  TableSkeleton,
  TR,
  TH,
  TD,
  TextLink,
} from "@/components/ui";
import type { CalendarEntryDto } from "@/lib/types";

const PER_PAGE = 20;
const COLUMNS = 4;

function CalendarEntryRow({ entry }: { entry: CalendarEntryDto }) {
  const { data: hotel } = useHotel(entry.hotel_id);
  const peopleById = useUsersByIds([entry.worker_id]);
  const worker = peopleById.get(entry.worker_id);

  return (
    <TR>
      <TD className="font-medium">
        <TextLink href={`/users/${entry.worker_id}`}>
          {worker ? `${worker.first_name} ${worker.last_name}` : "View worker"}
        </TextLink>
      </TD>
      <TD>
        <TextLink href={`/hotels/${entry.hotel_id}`}>{hotel?.name ?? "View hotel"}</TextLink>
      </TD>
      <TD>{formatDate(entry.day)}</TD>
      <TD>
        <TextLink href={`/assignments/${entry.assignment_id}`}>View assignment</TextLink>
      </TD>
    </TR>
  );
}

export default function CalendarEntriesPage() {
  const [page, setPage] = useState(1);

  const { calendarEntries, isLoading, error, hasNext } = useCalendarEntries({
    page,
    per_page: PER_PAGE,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar placements"
        description="Workers placed directly on a hotel's calendar — no broadcast, no accept step."
        actions={
          <StaffingWriteGate>
            <Link href="/assignments/calendar-entries/new">
              <Button>Place worker</Button>
            </Link>
          </StaffingWriteGate>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load calendar placements. Please try again.
            </div>
          ) : (
            <Table aria-label="Calendar placements">
              <THead>
                <tr>
                  <TH>Worker</TH>
                  <TH>Hotel</TH>
                  <TH>Day</TH>
                  <TH>Assignment</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : calendarEntries.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title="No calendar placements found"
                        description="Place a worker directly on the calendar to see it here."
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {calendarEntries.map((entry) => (
                    <CalendarEntryRow key={entry.id} entry={entry} />
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <Pager page={page} hasNext={hasNext} onPageChange={setPage} disabled={isLoading} />
    </div>
  );
}
