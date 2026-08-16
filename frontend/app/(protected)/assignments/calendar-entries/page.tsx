"use client";

import { useState } from "react";
import { UserRef } from "@/components/users/UserRef";
import Link from "next/link";
import { useCalendarEntries } from "@/hooks/useAssignments";
import { useHotel } from "@/hooks/useHotels";
import { StaffingWriteGate } from "@/components/auth/RoleGate";
import { formatDate } from "@/lib/format";
import {
  Badge,
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
import { placementAbsenceLabel } from "@/lib/types";
import type { CalendarEntryDto } from "@/lib/types";
import { useTranslation } from "react-i18next";

const PER_PAGE = 20;
const COLUMNS = 4;

function CalendarEntryRow({ entry }: { entry: CalendarEntryDto }) {
  const { t } = useTranslation();
  const { data: hotel } = useHotel(entry.hotel_id);
  // The API returns cancelled placements on purpose so they can be shown as
  // cancelled rather than vanishing. Without this the row was indistinguishable
  // from a live shift.
  const absenceLabel = placementAbsenceLabel(entry);
  const cancelled = absenceLabel !== null;

  return (
    <TR className={cancelled ? "opacity-60" : undefined}>
      <TD className="font-medium">
        <span className={cancelled ? "line-through" : undefined}>
          <UserRef userId={entry.worker_id} fallback="The assigned worker" />
        </span>
        {cancelled && (
          <Badge tone="neutral" className="ms-2">
            {absenceLabel}
          </Badge>
        )}
      </TD>
      <TD>
        <TextLink href={`/hotels/${entry.hotel_id}`}>{hotel?.name ?? "View hotel"}</TextLink>
      </TD>
      <TD className={cancelled ? "line-through" : undefined}>{formatDate(entry.day)}</TD>
      <TD>
        <TextLink href={`/assignments/${entry.assignment_id}`}>{t("assignments.viewAssignment")}</TextLink>
      </TD>
    </TR>
  );
}

export default function CalendarEntriesPage() {
  const { t } = useTranslation();
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
              <Button>{t("assignments.placeWorker")}</Button>
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
                  <TH>{t("fields.worker")}</TH>
                  <TH>{t("fields.hotel")}</TH>
                  <TH>{t("common.day")}</TH>
                  <TH>{t("assignments.title")}</TH>
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
