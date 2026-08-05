"use client";

import { useMemo, useState } from "react";
import { mutate } from "swr";
import { useHotelOptions } from "@/hooks/useWorkRequests";
import { useUserOptions } from "@/hooks/useHotels";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useCalendarEntriesInRange } from "@/hooks/useAssignments";
import { useAbsencesInRange } from "@/hooks/useCalendar";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, assignmentsApi } from "@/lib/api";
import { StaffingWriteGate } from "@/components/auth/RoleGate";
import {
  Badge,
  Button,
  Card,
  FormError,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui";
import type { AbsenceKind, CalendarAbsence, CalendarEntryDto } from "@/lib/types";

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

const ABSENCE_TONE: Record<AbsenceKind, "warning" | "neutral"> = {
  SICK: "warning",
  VACATION: "neutral",
};

type CalendarView = "week" | "month";

export default function CalendarGridPage() {
  const { user } = useAuth();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [addDay, setAddDay] = useState<string | null>(null);
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
  // A worker viewing their own grid only ever sees themself (isSelfScopedRole
  // on the backend), so this list is small even in the read-only case.
  const { users: workers } = useUserOptions({ role: "worker", limit: 200 });
  const workerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers) map.set(w.id, `${w.first_name} ${w.last_name}`);
    return map;
  }, [workers]);

  const isLoading = entriesLoading || (canSeeAbsences && absencesLoading);

  const [moveError, setMoveError] = useState<string | null>(null);
  const [movingEntryId, setMovingEntryId] = useState<string | null>(null);
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
            <div className="flex overflow-hidden rounded-md border border-gray-300">
              <button
                type="button"
                onClick={() => setView("week")}
                className={`px-3 py-1.5 text-sm font-medium ${view === "week" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => setView("month")}
                className={`px-3 py-1.5 text-sm font-medium ${view === "month" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
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
          <div className="p-6 text-center text-sm text-red-600">Failed to load the calendar. Please try again.</div>
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
                onAdd={() => setAddDay(key)}
                onMoveEntry={onMoveEntry}
                onSelectEntry={setEditingEntry}
              />
            );
          })}
        </div>
      )}

      {addDay && <AddEntryModal day={addDay} range={{ from, to }} onClose={() => setAddDay(null)} />}
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
  onAdd,
  onMoveEntry,
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
  onAdd: () => void;
  onMoveEntry: (entryId: string, newDay: string) => void;
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
        ...absences.map((a) => ({ type: "absence" as const, id: a.id, workerId: a.worker_id, kind: a.kind })),
      ]
    : null;
  const visibleItems = items?.slice(0, MONTH_VIEW_VISIBLE_ITEMS);
  const hiddenCount = items ? items.length - (visibleItems?.length ?? 0) : 0;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const entryId = e.dataTransfer.getData(PLACEMENT_DRAG_TYPE);
    if (entryId) onMoveEntry(entryId, dayKey);
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
        isToday ? "ring-2 ring-blue-500" : undefined,
        outsideCurrentMonth ? "opacity-50" : undefined,
        dragOver ? "bg-blue-50" : undefined,
      ]
        .filter(Boolean)
        .join(" ") || undefined}
    >
      <div className={`flex items-center justify-between border-b border-gray-100 ${isMonth ? "px-2 py-1" : "px-3 py-2"}`}>
        <div>
          {!isMonth && <div className="text-xs font-medium text-gray-500">{WEEKDAY_LABEL.format(date)}</div>}
          <div className={isMonth ? "text-xs font-semibold text-gray-900" : "text-sm font-semibold text-gray-900"}>
            {isMonth ? MONTH_DAY_LABEL.format(date) : DAY_LABEL.format(date)}
          </div>
        </div>
        <StaffingWriteGate>
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add calendar entry for ${dayKey}`}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
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
                <div key={item.id} className="truncate rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  {workerNameById.get(item.workerId) ?? item.workerId} · {item.kind === "SICK" ? "Sick" : "Vacation"}
                </div>
              ),
            )}
            {hiddenCount > 0 && <div className="text-[11px] text-gray-400">+{hiddenCount} more</div>}
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
              <div key={a.id} className="flex items-center justify-between gap-1">
                <span className="truncate text-xs text-gray-600">{workerNameById.get(a.worker_id) ?? a.worker_id}</span>
                <Badge tone={ABSENCE_TONE[a.kind]}>{a.kind === "SICK" ? "Sick" : "Vacation"}</Badge>
              </div>
            ))}
            {entries.length === 0 && absences.length === 0 && (
              <div className="pt-2 text-center text-xs text-gray-400">No entries</div>
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
        "block w-full truncate rounded bg-blue-50 text-left font-medium text-blue-700 hover:bg-blue-100",
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
      <label className="text-sm font-medium text-gray-700">Worker</label>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={hotelId ? "Search by name or email…" : "Select a hotel first"}
        disabled={!hotelId}
      />
      {hotelId && (
        <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200">
          {isLoading ? (
            <div className="p-3 text-sm text-gray-400">Searching…</div>
          ) : workers.length === 0 ? (
            <div className="p-3 text-sm text-gray-400">No eligible workers found.</div>
          ) : (
            workers.map((w) => {
              const label = `${w.first_name} ${w.last_name}`;
              const selected = value === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onChange(w.id, label)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                    selected ? "bg-blue-50 text-blue-700" : "text-gray-900"
                  }`}
                >
                  <span className="truncate">{label}</span>
                  <span className="truncate text-xs text-gray-400">{w.email}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = hotelId && workerId;

  const onHotelChange = (id: string) => {
    setHotelId(id);
    // The prior worker selection may not be eligible for the newly-selected
    // hotel — clear it rather than silently keep an invalid pairing shown as
    // "selected."
    setWorkerId("");
    setWorkerLabel("");
  };

  const onSubmit = async () => {
    if (!valid) return;
    setError(null);
    setSubmitting(true);

    // Optimistic insertion: show the placement on the grid immediately with
    // a temp id, swap it for the real row (or roll back) once the request
    // resolves -- the visible range's own SWR key is mutated directly
    // (not the earlier broad-match revalidation) so the update is
    // synchronous and doesn't wait on a network round-trip to refetch.
    const tempId = `temp-${Date.now()}`;
    const optimisticEntry: CalendarEntryDto = {
      id: tempId,
      assignment_id: tempId,
      worker_id: workerId,
      hotel_id: hotelId,
      day,
      placed_by_id: "",
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    const rangeKey = ["calendar-entries-range", range];

    try {
      const created = await mutate(
        rangeKey,
        async (current: CalendarEntryDto[] = []) => {
          const entry = await assignmentsApi.createCalendarEntry({ hotel_id: hotelId, worker_id: workerId, day });
          return [...current.filter((e) => e.id !== tempId), entry];
        },
        {
          optimisticData: (current: CalendarEntryDto[] = []) => [...current, optimisticEntry],
          rollbackOnError: true,
          revalidate: false,
        },
      );
      void created;
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
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
            Place worker
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
          <p className="text-xs text-gray-500">
            Selected worker: <span className="font-medium text-gray-700">{workerLabel}</span>
          </p>
        )}
        <Input label="Day" type="date" value={day} readOnly disabled />
        <FormError>{error}</FormError>
      </div>
    </Modal>
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
          <span className="text-gray-500">Worker</span>
          <span className="font-medium text-gray-900">{workerName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Hotel</span>
          <span className="font-medium text-gray-900">{hotelName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Day</span>
          <span className="font-medium text-gray-900">{entry.day}</span>
        </div>
        <p className="text-xs text-gray-400">
          To move this placement to a different day, drag it to the destination day cell.
        </p>
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}
