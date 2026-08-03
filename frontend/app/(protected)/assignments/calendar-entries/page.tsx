"use client";

import { useState } from "react";
import Link from "next/link";
import { useCalendarEntries } from "@/hooks/useAssignments";
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

const PER_PAGE = 20;
const COLUMNS = 3;

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
                    <TR key={entry.id}>
                      <TD className="font-medium">{entry.worker_id}</TD>
                      <TD>{formatDate(entry.day)}</TD>
                      <TD>
                        <TextLink href={`/assignments/${entry.assignment_id}`}>
                          {entry.assignment_id}
                        </TextLink>
                      </TD>
                    </TR>
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
