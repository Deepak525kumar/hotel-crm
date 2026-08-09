"use client";

import { useMemo, useState } from "react";
import { mutate } from "swr";
import { useHotelOptions } from "@/hooks/useWorkRequests";
import { useUserOptions, useUsersByIds } from "@/hooks/useHotels";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAssignment, useCalendarEntriesInRange } from "@/hooks/useAssignments";
import { useAbsencesInRange } from "@/hooks/useCalendar";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, assignmentsApi, calendarApi } from "@/lib/api";
import { StaffingWriteGate } from "@/components/auth/RoleGate";
import {
  Button,
  Card,
  Checkbox,
  FormError,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import type { AbsenceKind, Assignment, CalendarAbsence, CalendarEntryDto, RoomsCompletedEntry } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD in the local timezone (matches the backend's date-only day field). */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const dow = copy.getDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * The Monday-to-Sunday grid start for the calendar month containing `d` --
 * i.e. the Monday of the week the 1st falls in, which may be in the
 * previous month. Always produces exactly 6 weeks (42 days), the standard
 * fixed-size month-grid layout (matches Google/Outlook-style calendars) so
 * the grid's row count never shifts between months.
 */
function startOfMonthGrid(d: Date): Date {
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(firstOfMonth);
}

const WEEKDAY_LABEL = new Intl.DateTimeFormat("en", { weekday: "short" });
const DAY_LABEL = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
const MONTH_DAY_LABEL = new Intl.DateTimeFormat("en", { day: "numeric" });
const MONTH_TITLE_LABEL = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });

type CalendarView = "week" | "month";

export default function CalendarGridPage() {
  const { user } = useAuth();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [addDay, setAddDay] = useState<string | null>(null);
  const [markAbsenceDay, setMarkAbsenceDay] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<CalendarEntryDto | null>(null);

  // Month view always renders a fixed 6-week (42-day) grid; week view
  // renders exactly 7. Both are cheap to render outright (42 lightweight
  // cells is not a real virtualization case) -- the actual cost that scales
  // with range is the underlying data fetch, which useCalendarEntriesInRange
  // already pages through rather than truncate (see its own comment).
  const gridStart = useMemo(
    () => (view === "week" ? startOfWeek(anchor) : startOfMonthGrid(anchor)),
    [view, anchor],
  );
  const dayCount = view === "week" ? 7 : 42;
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => new Date(gridStart.getTime() + i * DAY_MS)),
    [gridStart, dayCount],
  );
  const from = toDateKey(days[0]);
  const to = toDateKey(days[days.length - 1]);
  const currentMonth = anchor.getMonth();

  const { data: entries, isLoading: entriesLoading, error: entriesError } =
    useCalendarEntriesInRange({ from, to });
  // Absences are manager/RM/admin-only server-side; a worker/checker viewing
  // this grid simply sees no absence tags (403 -> useAbsencesInRange's own
  // "not visible to me" treatment), not an error.
  const canSeeAbsences = user?.role === "admin" || user?.role === "manager" || user?.role === "regional_manager";
  const { data: absences, isLoading: absencesLoading } = useAbsencesInRange(
    canSeeAbsences ? { from, to } : null,
  );

  const entriesByDay = useMemo(() => groupByDay(entries ?? [], (e) => e.day), [entries]);
  const absencesByDay = useMemo(() => groupByDay(absences ?? [], (a) => a.day), [absences]);

  // Worker names for display -- the grid renders worker_id-keyed placements
  // and absences, but a Teams-style grid should show a name, not a raw id.
  // Resolved by id (useUsersByIds), not a flat capped role listing: a
  // fixed-size "first N workers" fetch silently misses anyone outside its
  // first page/sort order, which is exactly what surfaced this as a raw id
  // in the placement-details modal instead of a name.
  const visibleWorkerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries ?? []) ids.add(e.worker_id);
    for (const a of absences ?? []) ids.add(a.worker_id);
    return Array.from(ids);
  }, [entries, absences]);
  const usersById = useUsersByIds(visibleWorkerIds);
  const workerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, u] of usersById) map.set(id, `${u.first_name} ${u.last_name}`);
    return map;
  }, [usersById]);

  const isLoading = entriesLoading || (canSeeAbsences && absencesLoading);

  const [moveError, setMoveError] = useState<string | null>(null);
  const [movingEntryId, setMovingEntryId] = useState<string | null>(null);
  const [movingAbsenceId, setMovingAbsenceId] = useState<string | null>(null);
  const canWrite = user?.role === "admin" || user?.role === "manager" || user?.role === "regional_manager";

  const onMoveEntry = async (entryId: string, newDay: string) => {
    setMoveError(null);
    setMovingEntryId(entryId);
    // Optimistic move: the card visually jumps to its new day cell
    // immediately (matching a drag/drop gesture's own instant feedback)
    // rather than waiting on the round-trip; SWR rolls the cache back to
    // its pre-drop state automatically on failure.
    try {
      await mutate(
        ["calendar-entries-range", { from, to }],
        async (current: CalendarEntryDto[] = []) => {
          const moved = await assignmentsApi.moveCalendarEntry(entryId, newDay);
          return current.map((e) => (e.id === entryId ? moved : e));
        },
        {
          optimisticData: (current: CalendarEntryDto[] = []) =>
            current.map((e) => (e.id === entryId ? { ...e, day: newDay } : e)),
          rollbackOnError: true,
          revalidate: false,
        },
      );
    } catch (err) {
      setMoveError(err instanceof ApiError ? err.message : "Failed to move the placement. Please try again.");
    } finally {
      setMovingEntryId(null);
    }
  };

  // Drag-to-move an absence (2026-08-08 feature) -- same optimistic-mutate
  // shape as onMoveEntry above, against the absences cache key.
  const onMoveAbsence = async (absenceId: string, newDay: string) => {
    setMoveError(null);
    setMovingAbsenceId(absenceId);
    try {
      await mutate(
        ["calendar-absences", { from, to }],
        async (current: CalendarAbsence[] = []) => {
          const moved = await calendarApi.moveAbsence(absenceId, newDay);
          return current.map((a) => (a.id === absenceId ? moved : a));
        },
        {
          optimisticData: (current: CalendarAbsence[] = []) =>
            current.map((a) => (a.id === absenceId ? { ...a, day: newDay } : a)),
          rollbackOnError: true,
          revalidate: false,
        },
      );
    } catch (err) {
      setMoveError(
        err instanceof ApiError ? err.message : "Failed to move the absence. Please try again.",
      );
    } finally {
      setMovingAbsenceId(null);
    }
  };

  const goPrev = () =>
    setAnchor((a) =>
      view === "week"
        ? new Date(a.getTime() - 7 * DAY_MS)
        : new Date(a.getFullYear(), a.getMonth() - 1, 1),
    );
  const goNext = () =>
    setAnchor((a) =>
      view === "week"
        ? new Date(a.getTime() + 7 * DAY_MS)
        : new Date(a.getFullYear(), a.getMonth() + 1, 1),
    );
  const goToday = () => setAnchor(new Date());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description={
          view === "week"
            ? "Worker placements and absences, one week at a time."
            : MONTH_TITLE_LABEL.format(anchor)
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setView("week")}
                className={`px-3 py-1.5 text-sm font-medium ${view === "week" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"}`}
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => setView("month")}
                className={`px-3 py-1.5 text-sm font-medium ${view === "month" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"}`}
              >
                Month
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={goPrev}>
              ← Prev
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={goNext}>
              Next →
            </Button>
          </div>
        }
      />

      <FormError>{moveError}</FormError>

      {entriesError ? (
        <Card>
          <div className="p-6 text-center text-sm text-red-600 dark:text-red-400">Failed to load the calendar. Please try again.</div>
        </Card>
      ) : (
        <div
          className={
            view === "week"
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7"
              : "grid grid-cols-7 gap-1.5"
          }
        >
          {days.map((d) => {
            const key = toDateKey(d);
            return (
              <DayCell
                key={key}
                date={d}
                dayKey={key}
                view={view}
                outsideCurrentMonth={view === "month" && d.getMonth() !== currentMonth}
                entries={entriesByDay.get(key) ?? []}
                absences={absencesByDay.get(key) ?? []}
                workerNameById={workerNameById}
                loading={isLoading}
                canWrite={canWrite}
                movingEntryId={movingEntryId}
                movingAbsenceId={movingAbsenceId}
                onAdd={() => setAddDay(key)}
                onMarkAbsence={() => setMarkAbsenceDay(key)}
                onMoveEntry={onMoveEntry}
                onMoveAbsence={onMoveAbsence}
                onSelectEntry={setEditingEntry}
              />
            );
          })}
        </div>
      )}

      {addDay && <AddEntryModal day={addDay} range={{ from, to }} onClose={() => setAddDay(null)} />}
      {markAbsenceDay && (
        <MarkAbsenceForWorkerModal
          day={markAbsenceDay}
          range={{ from, to }}
          onClose={() => setMarkAbsenceDay(null)}
        />
      )}
      {editingEntry && (
        <EditEntryModal
          entry={editingEntry}
          range={{ from, to }}
          workerName={workerNameById.get(editingEntry.worker_id) ?? editingEntry.worker_id}
          canWrite={canWrite}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

function groupByDay<T>(items: T[], getDay: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const day = getDay(item);
    const bucket = map.get(day);
    if (bucket) bucket.push(item);
    else map.set(day, [item]);
  }
  return map;
}

const MONTH_VIEW_VISIBLE_ITEMS = 3;
/** dataTransfer MIME type for a dragged placement -- namespaced so a drop
 * handler never mistakes an unrelated browser drag (e.g. dragging text or a
 * link) for a calendar-entry move. */
const PLACEMENT_DRAG_TYPE = "application/x-calendar-entry-id";
/** Same namespacing for a dragged absence (2026-08-08 feature) -- a distinct
 * type from PLACEMENT_DRAG_TYPE so one drop handler can tell which kind of
 * item was dropped and call the matching endpoint, rather than guessing. */
const ABSENCE_DRAG_TYPE = "application/x-calendar-absence-id";

function DayCell({
  date,
  dayKey,
  view,
  outsideCurrentMonth,
  entries,
  absences,
  workerNameById,
  loading,
  canWrite,
  movingEntryId,
  movingAbsenceId,
  onAdd,
  onMarkAbsence,
  onMoveEntry,
  onMoveAbsence,
  onSelectEntry,
}: {
  date: Date;
  dayKey: string;
  view: "week" | "month";
  outsideCurrentMonth: boolean;
  entries: CalendarEntryDto[];
  absences: CalendarAbsence[];
  workerNameById: Map<string, string>;
  loading: boolean;
  canWrite: boolean;
  movingEntryId: string | null;
  movingAbsenceId: string | null;
  onAdd: () => void;
  onMarkAbsence: () => void;
  onMoveEntry: (entryId: string, newDay: string) => void;
  onMoveAbsence: (absenceId: string, newDay: string) => void;
  onSelectEntry: (entry: CalendarEntryDto) => void;
}) {
  const isToday = dayKey === toDateKey(new Date());
  const isMonth = view === "month";
  const [dragOver, setDragOver] = useState(false);

  // Month cells are small -- cap how many tags render inline and roll the
  // rest into a "+N more" count, rather than let a busy day blow out the
  // fixed-height row (the actual data is never truncated, only the display).
  const items = isMonth
    ? [
        ...entries.map((e) => ({ type: "entry" as const, id: e.id, workerId: e.worker_id, entry: e })),
        ...absences.map((a) => ({ type: "absence" as const, id: a.id, workerId: a.worker_id, absence: a })),
      ]
    : null;
  const visibleItems = items?.slice(0, MONTH_VIEW_VISIBLE_ITEMS);
  const hiddenCount = items ? items.length - (visibleItems?.length ?? 0) : 0;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // Two distinct namespaced types (2026-08-08 feature): read both rather
    // than assume, so a dropped absence never gets sent to the
    // move-placement endpoint or vice versa.
    const entryId = e.dataTransfer.getData(PLACEMENT_DRAG_TYPE);
    if (entryId) {
      onMoveEntry(entryId, dayKey);
      return;
    }
    const absenceId = e.dataTransfer.getData(ABSENCE_DRAG_TYPE);
    if (absenceId) onMoveAbsence(absenceId, dayKey);
  };

  return (
    <Card
      onDragOver={(e) => {
        if (!canWrite) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={canWrite ? onDrop : undefined}
      className={[
        isToday ? "ring-2 ring-blue-500 dark:ring-blue-500" : undefined,
        outsideCurrentMonth ? "opacity-50" : undefined,
        dragOver ? "bg-blue-50 dark:bg-blue-950" : undefined,
      ]
        .filter(Boolean)
        .join(" ") || undefined}
    >
      <div className={`flex items-center justify-between border-b border-gray-100 dark:border-gray-800 ${isMonth ? "px-2 py-1" : "px-3 py-2"}`}>
        <div>
          {!isMonth && <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{WEEKDAY_LABEL.format(date)}</div>}
          <div className={isMonth ? "text-xs font-semibold text-gray-900 dark:text-gray-100" : "text-sm font-semibold text-gray-900 dark:text-gray-100"}>
            {isMonth ? MONTH_DAY_LABEL.format(date) : DAY_LABEL.format(date)}
          </div>
        </div>
        <StaffingWriteGate>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onAdd}
              aria-label={`Add calendar entry for ${dayKey}`}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-blue-400"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
            </button>
            {/* Manager-on-behalf-of absence marking (2026-08-08 feature) --
                POST /calendar/absences, group-scoped server-side. Same
                StaffingWriteGate as the add-entry button beside it, since
                marking a worker's day unavailable is a scheduling write. */}
            <button
              type="button"
              onClick={onMarkAbsence}
              title="Mark a worker absent on this day"
              aria-label={`Mark a worker absent on ${dayKey}`}
              className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-amber-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-amber-400"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </StaffingWriteGate>
      </div>
      <div className={isMonth ? "min-h-[64px] space-y-1 p-1.5" : "min-h-[88px] space-y-1.5 p-2"}>
        {loading ? (
          <>
            <Skeleton className="h-5 w-full" />
            {!isMonth && <Skeleton className="h-5 w-2/3" />}
          </>
        ) : isMonth ? (
          <>
            {visibleItems?.map((item) =>
              item.type === "entry" ? (
                <PlacementTag
                  key={item.id}
                  entry={item.entry}
                  label={workerNameById.get(item.workerId) ?? item.workerId}
                  draggable={canWrite}
                  moving={movingEntryId === item.id}
                  size="sm"
                  onSelect={onSelectEntry}
                />
              ) : (
                <AbsenceTag
                  key={item.id}
                  absence={item.absence}
                  label={workerNameById.get(item.workerId) ?? item.workerId}
                  draggable={canWrite}
                  moving={movingAbsenceId === item.id}
                  size="sm"
                />
              ),
            )}
            {hiddenCount > 0 && <div className="text-[11px] text-gray-400 dark:text-gray-500">+{hiddenCount} more</div>}
          </>
        ) : (
          <>
            {entries.map((e) => (
              <PlacementTag
                key={e.id}
                entry={e}
                label={workerNameById.get(e.worker_id) ?? e.worker_id}
                draggable={canWrite}
                moving={movingEntryId === e.id}
                size="md"
                onSelect={onSelectEntry}
              />
            ))}
            {absences.map((a) => (
              <AbsenceTag
                key={a.id}
                absence={a}
                label={workerNameById.get(a.worker_id) ?? a.worker_id}
                draggable={canWrite}
                moving={movingAbsenceId === a.id}
                size="md"
              />
            ))}
            {entries.length === 0 && absences.length === 0 && (
              <div className="pt-2 text-center text-xs text-gray-400 dark:text-gray-500">No entries</div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * A single placement tag. Draggable (native HTML5 DnD) when `draggable` —
 * gated on the same StaffingWriteGate role set as the add-entry button,
 * since dragging is just another form of scheduling write. Clicking opens
 * the entry's detail/cancel modal for anyone who can see the grid, whether
 * or not they can write.
 */
function PlacementTag({
  entry,
  label,
  draggable,
  moving,
  size,
  onSelect,
}: {
  entry: CalendarEntryDto;
  label: string;
  draggable: boolean;
  moving: boolean;
  size: "sm" | "md";
  onSelect: (entry: CalendarEntryDto) => void;
}) {
  return (
    <button
      type="button"
      draggable={draggable}
      onClick={() => onSelect(entry)}
      onDragStart={(e) => {
        e.dataTransfer.setData(PLACEMENT_DRAG_TYPE, entry.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={[
        "block w-full truncate rounded bg-blue-50 text-left font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900/60",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "rounded-md px-2 py-1 text-xs",
        draggable ? "cursor-grab active:cursor-grabbing" : undefined,
        moving ? "opacity-50" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </button>
  );
}

/**
 * A single absence tag (2026-08-08 feature). Draggable on the same
 * `canWrite` role set PlacementTag uses -- moving a worker's declared
 * absence to a different day is a scheduling write, so it belongs to the
 * same gate. The backend's own ownership/group-scope check
 * (CalendarService.moveAbsence) is the authoritative one; a worker moving
 * their OWN absence is also permitted server-side, but the grid itself is a
 * manager surface, so this UI only offers the gesture to `canWrite` roles.
 *
 * Red/amber tone by kind so availability reads at a glance (SICK = red,
 * VACATION = amber) against a placement's blue -- see ABSENCE_TONE.
 */
function AbsenceTag({
  absence,
  label,
  draggable,
  moving,
  size,
}: {
  absence: CalendarAbsence;
  label: string;
  draggable: boolean;
  moving: boolean;
  size: "sm" | "md";
}) {
  const isSick = absence.kind === "SICK";
  const title = [
    `${label} · ${isSick ? "Sick" : "Vacation"}`,
    absence.reason ? `Reason: ${absence.reason}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      draggable={draggable}
      title={title}
      onDragStart={(e) => {
        e.dataTransfer.setData(ABSENCE_DRAG_TYPE, absence.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={[
        "block w-full truncate rounded text-left font-medium",
        isSick
          ? "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900/60"
          : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900/60",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "rounded-md px-2 py-1 text-xs",
        draggable ? "cursor-grab active:cursor-grabbing" : undefined,
        moving ? "opacity-50" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label} · {isSick ? "Sick" : "Vacation"}
    </div>
  );
}

/**
 * Search-as-you-type worker picker, scoped to workers eligible for
 * `hotelId` (backend resolves `hotel_id` -> hotel_group -> ACTIVE
 * EmploymentRecord in that group, same primitive the Users list page uses)
 * — narrower than the flat "all workers" list the modal shipped with
 * originally, and usable at any team size since the query is server-side.
 */
function WorkerPicker({
  hotelId,
  value,
  onChange,
}: {
  hotelId: string;
  value: string;
  onChange: (workerId: string, label: string) => void;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { users: workers, isLoading } = useUserOptions({
    role: "worker",
    hotel_id: hotelId || undefined,
    search: debouncedSearch || undefined,
    limit: 20,
  });

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Worker</label>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={hotelId ? "Search by name or email…" : "Select a hotel first"}
        disabled={!hotelId}
      />
      {hotelId && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-800">
          {isLoading ? (
            <div className="p-3 text-sm text-gray-400 dark:text-gray-500">Searching…</div>
          ) : workers.length === 0 ? (
            <div className="p-3 text-sm text-gray-400 dark:text-gray-500">No eligible workers found.</div>
          ) : (
            workers.map((w) => {
              const label = `${w.first_name} ${w.last_name}`;
              const selected = value === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onChange(w.id, label)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
                    selected ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  <span className="truncate">{label}</span>
                  <span className="truncate text-xs text-gray-400 dark:text-gray-500">{w.email}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/** YYYY-MM-DD + N weeks, in local-date arithmetic (matches toDateKey's own
 * local-component construction, never touches toISOString). */
function addWeeks(day: string, weeks: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d + weeks * 7);
  return toDateKey(date);
}

const MAX_RECURRING_OCCURRENCES = 26; // ~6 months weekly -- a sane upper bound, not a hard product limit

function AddEntryModal({
  day,
  range,
  onClose,
}: {
  day: string;
  range: { from: string; to: string };
  onClose: () => void;
}) {
  const { hotels, isLoading: hotelsLoading } = useHotelOptions();
  const [hotelId, setHotelId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [workerLabel, setWorkerLabel] = useState("");
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [occurrences, setOccurrences] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialFailures, setPartialFailures] = useState<string[]>([]);

  const valid = hotelId && workerId && (!repeatWeekly || (occurrences >= 1 && occurrences <= MAX_RECURRING_OCCURRENCES));

  const onHotelChange = (id: string) => {
    setHotelId(id);
    // The prior worker selection may not be eligible for the newly-selected
    // hotel — clear it rather than silently keep an invalid pairing shown as
    // "selected."
    setWorkerId("");
    setWorkerLabel("");
  };

  const rangeKey = ["calendar-entries-range", range];

  const createOne = async (targetDay: string) => {
    const tempId = `temp-${targetDay}-${Date.now()}`;
    const optimisticEntry: CalendarEntryDto = {
      id: tempId,
      assignment_id: tempId,
      worker_id: workerId,
      hotel_id: hotelId,
      day: targetDay,
      placed_by_id: "",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    // Optimistic insertion: show the placement on the grid immediately with
    // a temp id, swap it for the real row (or roll back just this one) once
    // the request resolves -- the visible range's own SWR key is mutated
    // directly (not a broad-match revalidation) so the update is
    // synchronous and doesn't wait on a network round-trip to refetch.
    return mutate(
      rangeKey,
      async (current: CalendarEntryDto[] = []) => {
        const entry = await assignmentsApi.createCalendarEntry({ hotel_id: hotelId, worker_id: workerId, day: targetDay });
        return [...current.filter((e) => e.id !== tempId), entry];
      },
      {
        optimisticData: (current: CalendarEntryDto[] = []) => [...current, optimisticEntry],
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  const onSubmit = async () => {
    if (!valid) return;
    setError(null);
    setPartialFailures([]);
    setSubmitting(true);

    if (!repeatWeekly) {
      try {
        await createOne(day);
        onClose();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        setSubmitting(false);
      }
      return;
    }

    // Recurring placement: each occurrence is created independently via the
    // same createCalendarEntry() call a single placement uses -- no batch
    // endpoint, no shared transaction, no bypass of per-occurrence
    // authorization/scope/duplicate-day checks (explicit product decision,
    // 2026-08-05). A failure on one occurrence (out of scope, already
    // occupied, etc.) does not roll back or block the others; every
    // attempted occurrence is reported, success or failure, so the manager
    // knows exactly what landed.
    const failures: string[] = [];
    for (let i = 0; i < occurrences; i++) {
      const targetDay = addWeeks(day, i);
      try {
        await createOne(targetDay);
      } catch (err) {
        failures.push(`${targetDay}: ${err instanceof ApiError ? err.message : "Failed"}`);
      }
    }

    setSubmitting(false);
    if (failures.length === 0) {
      onClose();
    } else if (failures.length === occurrences) {
      setError(`All ${occurrences} occurrences failed. ${failures[0]}`);
    } else {
      setPartialFailures(failures);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Place worker on calendar — ${day}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={submitting} disabled={submitting || !valid}>
            {repeatWeekly ? `Place worker (${occurrences}x)` : "Place worker"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Hotel"
          value={hotelId}
          onChange={(e) => onHotelChange(e.target.value)}
          placeholder={hotelsLoading ? "Loading…" : "Select a hotel"}
          disabled={hotelsLoading}
          options={hotels.map((h) => ({ value: h.id, label: h.name }))}
        />
        <WorkerPicker
          hotelId={hotelId}
          value={workerId}
          onChange={(id, label) => {
            setWorkerId(id);
            setWorkerLabel(label);
          }}
        />
        {workerId && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Selected worker: <span className="font-medium text-gray-700 dark:text-gray-300">{workerLabel}</span>
          </p>
        )}
        <Input label="Day" type="date" value={day} readOnly disabled />
        <Checkbox
          label="Repeat weekly"
          checked={repeatWeekly}
          onChange={(e) => setRepeatWeekly(e.target.checked)}
        />
        {repeatWeekly && (
          <Input
            label="Number of weeks"
            type="number"
            min={1}
            max={MAX_RECURRING_OCCURRENCES}
            value={occurrences}
            onChange={(e) => setOccurrences(Number(e.target.value))}
            hint={`Creates ${occurrences} separate placements (this day, then every 7 days after), each independently validated -- a placement that fails (e.g. the worker is already booked that day) is skipped, not blocked or rolled back.`}
          />
        )}
        <FormError>{error}</FormError>
        {partialFailures.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            <p className="font-medium">
              {occurrences - partialFailures.length} of {occurrences} placements created. {partialFailures.length}{" "}
              failed:
            </p>
            <ul className="mt-1 list-disc pl-4">
              {partialFailures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Manager/RM/admin marks a worker absent on a given day (2026-08-08
 * feature) -- the on-behalf-of counterpart to the worker's own
 * self-service AbsencesCard modal. Posts to /calendar/absences, which is
 * group-scoped server-side (isWorkerInGroupScope): a manager can only mark
 * workers on their own group's roster, and the server stays authoritative
 * regardless of what this picker offers.
 *
 * No hotel selector, unlike AddEntryModal: an absence is a property of the
 * worker's day, not of any hotel, and the backend resolves scope through
 * the worker's own EmploymentRecord. The worker list is likewise already
 * group-narrowed server-side by GET /users.
 */
function MarkAbsenceForWorkerModal({
  day,
  range,
  onClose,
}: {
  day: string;
  range: { from: string; to: string };
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { users: workers, isLoading: workersLoading } = useUserOptions({
    role: "worker",
    search: debouncedSearch || undefined,
    limit: 20,
  });
  const [workerId, setWorkerId] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("SICK");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the backend's MarkAbsenceSchema refine and the worker-facing
  // AbsencesCard modal: required for VACATION, optional for SICK (avoiding
  // an incentive to disclose health details -- see schema.prisma's
  // CalendarAbsence.reason).
  const reasonRequired = kind === "VACATION";
  const valid = workerId && (!reasonRequired || reason.trim().length > 0);

  const onSubmit = async () => {
    setError(null);
    if (!valid) return;
    setSubmitting(true);
    const trimmed = reason.trim();
    try {
      await mutate(
        ["calendar-absences", range],
        async (current: CalendarAbsence[] = []) => {
          const created = await calendarApi.markAbsenceForWorker({
            worker_id: workerId,
            day,
            kind,
            ...(trimmed ? { reason: trimmed } : {}),
          });
          // Upsert semantics server-side (re-marking an already-marked day
          // overwrites it), so replace a same-worker/same-day row rather
          // than appending a duplicate.
          return [...current.filter((a) => !(a.worker_id === workerId && a.day === day)), created];
        },
        { revalidate: false },
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to mark the absence. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Mark absent · ${day}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={submitting} disabled={!valid}>
            Mark absent
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Worker</label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
          />
          <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-800">
            {workersLoading ? (
              <div className="p-3 text-sm text-gray-400 dark:text-gray-500">Searching…</div>
            ) : workers.length === 0 ? (
              <div className="p-3 text-sm text-gray-400 dark:text-gray-500">No workers found.</div>
            ) : (
              workers.map((w) => {
                const label = `${w.first_name} ${w.last_name}`;
                const selected = workerId === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWorkerId(w.id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      selected ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    <span className="truncate">{label}</span>
                    <span className="truncate text-xs text-gray-400 dark:text-gray-500">{w.email}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <Select
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as AbsenceKind)}
          options={[
            { value: "SICK", label: "Sick" },
            { value: "VACATION", label: "Vacation" },
          ]}
        />
        <Textarea
          label={reasonRequired ? "Reason" : "Reason (optional)"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder={reasonRequired ? "e.g. approved leave, personal days" : "Optional"}
          // Shown in both states -- see AbsencesCard's matching hint for why
          // the warning is not conditional on SICK being selected.
          hint={`${reasonRequired ? "Required for vacation." : "Optional."} Do not enter medical details.`}
        />
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}

/**
 * Rooms-completed view/edit, shown inside EditEntryModal only once the
 * assignment is COMPLETED (2026-08-09) -- logging/editing a count before
 * the shift has finished doesn't describe anything real yet, and the
 * backend enforces the same rule (409 otherwise). Everyone who can open
 * the placement-details modal sees this if it applies to them (workers see
 * their own); only canWrite roles get the edit control, matching the
 * manager-only POST/PATCH /assignments/:id/rooms-completed routes.
 */
function RoomsCompletedSection({
  assignmentId,
  canWrite,
}: {
  assignmentId: string;
  canWrite: boolean;
}) {
  const { data: assignment, isLoading } = useAssignment(assignmentId);
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [rooms, setRooms] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !assignment || assignment.status !== "COMPLETED") return null;

  const existing = assignment.rooms_completed;

  const startEditing = () => {
    setRooms(existing ? String(existing.rooms_completed) : "");
    setNotes(existing?.notes ?? "");
    setError(null);
    setEditing(true);
  };

  // Optimistic save (review follow-up, PR #395 item B): the "Count"/"Notes"
  // display switches to the new values the instant Save is clicked, not
  // after the round-trip resolves -- same optimisticData/rollbackOnError
  // shape as onMoveEntry/onMoveAbsence above, applied to this key instead of
  // the calendar-entries-range one. On failure SWR reverts this cache entry
  // to its pre-save value automatically; `error` still surfaces why.
  const onSave = async () => {
    const parsed = Number(rooms);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("Enter a whole number of rooms (0 or more).");
      return;
    }
    setError(null);
    setSaving(true);
    const trimmedNotes = notes.trim();
    const input = { rooms_completed: parsed, notes: trimmedNotes || undefined };

    // Provisional row shown immediately. id/assignment_id/created_at are
    // placeholders (the create case has no real id yet) -- fine, since
    // nothing reads them before the real response replaces this optimistic
    // entry (success) or SWR rolls the whole assignment back (failure).
    const optimisticEntry: RoomsCompletedEntry = {
      id: existing?.id ?? `optimistic-${assignmentId}`,
      assignment_id: assignmentId,
      hotel_id: assignment.hotel_id,
      worker_id: assignment.worker_id,
      entered_by_id: existing?.entered_by_id ?? user?.id ?? "",
      entered_by_name:
        existing?.entered_by_name ?? (user ? `${user.first_name} ${user.last_name}` : null),
      rooms_completed: parsed,
      notes: trimmedNotes || null,
      created_at: existing?.created_at ?? new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    const optimisticAssignment: Assignment = { ...assignment, rooms_completed: optimisticEntry };

    try {
      await mutate(
        ["assignment", assignmentId],
        async (current: Assignment = assignment) => {
          const updated = existing
            ? await assignmentsApi.updateRoomsCompleted(assignmentId, input)
            : await assignmentsApi.logRoomsCompleted(assignmentId, input);
          return { ...current, rooms_completed: updated };
        },
        {
          optimisticData: optimisticAssignment,
          rollbackOnError: true,
          revalidate: false,
        },
      );
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <p className="mb-2 text-sm font-medium text-gray-700">Rooms completed</p>
      {editing ? (
        <div className="space-y-2">
          <Input
            label="Rooms completed"
            type="number"
            min={0}
            step={1}
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
          />
          <Textarea
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />
          <FormError>{error}</FormError>
          <div className="flex gap-2">
            <Button size="sm" onClick={onSave} loading={saving}>
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : existing ? (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Count</span>
            <span className="font-medium text-gray-900">{existing.rooms_completed}</span>
          </div>
          {existing.notes && (
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-gray-500">Notes</span>
              <span className="text-right text-gray-700">{existing.notes}</span>
            </div>
          )}
          {/* review follow-up (PR #395 item A): who logged this count, not
              just when -- resolved server-side (entered_by_name), falls
              back to the raw id on the rare chance the name failed to
              resolve rather than hiding the field entirely. */}
          <div className="flex justify-between gap-4">
            <span className="shrink-0 text-gray-500">Logged by</span>
            <span className="text-right text-gray-700">
              {existing.entered_by_name ?? existing.entered_by_id}
            </span>
          </div>
          {canWrite && (
            <Button size="sm" variant="outline" className="mt-1" onClick={startEditing}>
              Edit
            </Button>
          )}
        </div>
      ) : canWrite ? (
        <Button size="sm" variant="outline" onClick={startEditing}>
          Log rooms completed
        </Button>
      ) : (
        <p className="text-sm text-gray-500">Not yet logged.</p>
      )}
    </div>
  );
}

/**
 * Inline-edit affordance for an existing placement: shows its details and
 * offers to cancel it. Hotel and worker are never editable here (day-only
 * move is what drag/drop already covers, per the same product decision) --
 * this modal's only write is the existing generic assignment-cancel path
 * (PATCH /assignments/:id, status: CANCELLED), reused as-is rather than
 * building a calendar-specific delete endpoint.
 */
function EditEntryModal({
  entry,
  range,
  workerName,
  canWrite,
  onClose,
}: {
  entry: CalendarEntryDto;
  range: { from: string; to: string };
  workerName: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { hotels } = useHotelOptions();
  const hotelName = hotels.find((h) => h.id === entry.hotel_id)?.name ?? entry.hotel_id;
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCancelPlacement = async () => {
    setError(null);
    setCancelling(true);
    try {
      await assignmentsApi.cancel(entry.assignment_id);
      await mutate(
        ["calendar-entries-range", range],
        (current: CalendarEntryDto[] = []) => current.filter((e) => e.id !== entry.id),
        { revalidate: false },
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel this placement. Please try again.");
      setCancelling(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Placement details"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={cancelling}>
            Close
          </Button>
          {canWrite && (
            <Button variant="danger" onClick={onCancelPlacement} loading={cancelling}>
              Cancel placement
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Worker</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{workerName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Hotel</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{hotelName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Day</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{entry.day}</span>
        </div>
        {/* Gated on canWrite: dragging is only offered to the roles
            PlacementTag actually sets draggable for (same StaffingWriteGate
            set). A worker/checker sees this modal read-only, so the hint
            described a gesture they cannot perform. */}
        {canWrite && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            To move this placement to a different day, drag it to the destination day cell.
          </p>
        )}
        <RoomsCompletedSection assignmentId={entry.assignment_id} canWrite={canWrite} />
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}
