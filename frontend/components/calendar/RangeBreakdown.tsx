"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton, StatTile } from "@/components/ui";
import { FULL_DAY_LABEL, toDateKey, type CalendarView } from "@/lib/calendar";
import { isActivePlacement } from "@/lib/types";
import type { CalendarAbsence, CalendarEntryDto } from "@/lib/types";

/** A day's placements/absences regrouped by hotel, for the breakdown panel. */
interface HotelDayBucket {
  hotelId: string;
  entries: CalendarEntryDto[];
}

/**
 * "Everything happening in the visible range, hotel by hotel."
 *
 * The grid above answers "which days are busy"; this answers "who exactly is
 * where, and who is off" — the question the compact day-cell tags can't
 * carry. Rendered for every view: it IS the day view's content, and
 * summarises week/month.
 *
 * Absences are listed per DAY rather than per hotel, because a
 * CalendarAbsence has no hotel_id (schema.prisma) — a worker is absent from
 * their day, not from a particular hotel. Presenting them under a hotel
 * heading would invent an association the data doesn't have.
 */
export function RangeBreakdown({
  days,
  view,
  entriesByDay,
  absencesByDay,
  workerNameById,
  hotelNameById,
  loading,
  canSeeAbsences,
  onSelectEntry,
}: {
  days: Date[];
  view: CalendarView;
  entriesByDay: Map<string, CalendarEntryDto[]>;
  absencesByDay: Map<string, CalendarAbsence[]>;
  workerNameById: Map<string, string>;
  hotelNameById: Map<string, string>;
  loading: boolean;
  canSeeAbsences: boolean;
  onSelectEntry: (entry: CalendarEntryDto) => void;
}) {
  // Only days that actually have something to show. In month view this keeps
  // a 42-cell range from rendering 42 mostly-empty sections.
  // Cancelled placements are returned by the API on purpose (so the grid can
  // show them struck-through) but must not count as staffing anywhere in this
  // summary — see isActivePlacement().
  const activeEntriesOn = (d: Date) =>
    (entriesByDay.get(toDateKey(d)) ?? []).filter(isActivePlacement);

  const activeDays = days.filter(
    (d) =>
      activeEntriesOn(d).length > 0 ||
      (absencesByDay.get(toDateKey(d))?.length ?? 0) > 0,
  );

  const totalPlacements = days.reduce((n, d) => n + activeEntriesOn(d).length, 0);
  const allAbsences = days.flatMap((d) => absencesByDay.get(toDateKey(d)) ?? []);
  const sickCount = allAbsences.filter((a) => a.kind === "SICK").length;
  const vacationCount = allAbsences.filter((a) => a.kind === "VACATION").length;
  const distinctWorkers = new Set(
    days.flatMap((d) => activeEntriesOn(d).map((e) => e.worker_id)),
  ).size;

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {view === "day" ? "This day in detail" : "Range breakdown"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Placements" value={String(totalPlacements)} />
          <StatTile label="Workers placed" value={String(distinctWorkers)} />
          {canSeeAbsences && <StatTile label="Sick" value={String(sickCount)} />}
          {canSeeAbsences && <StatTile label="On vacation" value={String(vacationCount)} />}
        </div>

        {activeDays.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            description={
              view === "day"
                ? "No placements or absences recorded for this day."
                : "No placements or absences in this range."
            }
          />
        ) : (
          <div className="space-y-6">
            {activeDays.map((d) => {
              const key = toDateKey(d);
              const dayEntries = activeEntriesOn(d);
              const dayAbsences = absencesByDay.get(key) ?? [];

              // Regroup this day's placements by hotel.
              const byHotel = new Map<string, HotelDayBucket>();
              for (const e of dayEntries) {
                const bucket = byHotel.get(e.hotel_id) ?? { hotelId: e.hotel_id, entries: [] };
                bucket.entries.push(e);
                byHotel.set(e.hotel_id, bucket);
              }
              const hotelBuckets = Array.from(byHotel.values()).sort((a, b) =>
                (hotelNameById.get(a.hotelId) ?? a.hotelId).localeCompare(
                  hotelNameById.get(b.hotelId) ?? b.hotelId,
                ),
              );

              return (
                <div key={key} className="space-y-3">
                  {/* In day view the page header already names the date, so a
                      second identical heading would be pure noise. */}
                  {view !== "day" && (
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {FULL_DAY_LABEL.format(d)}
                    </h3>
                  )}

                  {hotelBuckets.map((bucket) => (
                    <div
                      key={bucket.hotelId}
                      className="rounded-md border border-gray-200 dark:border-gray-700"
                    >
                      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {hotelNameById.get(bucket.hotelId) ?? bucket.hotelId}
                        </span>
                        <Badge tone="info">
                          {bucket.entries.length}{" "}
                          {bucket.entries.length === 1 ? "worker" : "workers"}
                        </Badge>
                      </div>
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {bucket.entries.map((e) => (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() => onSelectEntry(e)}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                              <span className="truncate text-gray-900 dark:text-gray-100">
                                {workerNameById.get(e.worker_id) ?? e.worker_id}
                              </span>
                              <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                                Details →
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}

                  {canSeeAbsences && dayAbsences.length > 0 && (
                    <div className="rounded-md border border-gray-200 dark:border-gray-700">
                      <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          Unavailable
                        </span>
                      </div>
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {dayAbsences.map((a) => (
                          <li
                            key={a.id}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                          >
                            <span className="truncate text-gray-900 dark:text-gray-100">
                              {workerNameById.get(a.worker_id) ?? a.worker_id}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {a.reason && (
                                <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                                  {a.reason}
                                </span>
                              )}
                              <Badge tone={a.kind === "SICK" ? "danger" : "warning"}>
                                {a.kind === "SICK" ? "Sick" : "Vacation"}
                              </Badge>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
