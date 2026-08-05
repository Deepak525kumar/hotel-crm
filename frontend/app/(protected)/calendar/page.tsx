"use client";

import { useMemo, useState } from "react";
import { useHotelOptions } from "@/hooks/useWorkRequests";
import { useUserOptions } from "@/hooks/useHotels";
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

const WEEKDAY_LABEL = new Intl.DateTimeFormat("en", { weekday: "short" });
const DAY_LABEL = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

const ABSENCE_TONE: Record<AbsenceKind, "warning" | "neutral"> = {
  SICK: "warning",
  VACATION: "neutral",
};

export default function CalendarGridPage() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [addDay, setAddDay] = useState<string | null>(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS)),
    [weekStart],
  );
  const from = toDateKey(days[0]);
  const to = toDateKey(days[6]);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Worker placements and absences, one week at a time."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setWeekStart((w) => new Date(w.getTime() - 7 * DAY_MS))}>
              ← Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekStart((w) => new Date(w.getTime() + 7 * DAY_MS))}>
              Next →
            </Button>
          </div>
        }
      />

      {entriesError ? (
        <Card>
          <div className="p-6 text-center text-sm text-red-600">Failed to load the calendar. Please try again.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {days.map((d) => {
            const key = toDateKey(d);
            return (
              <DayCell
                key={key}
                date={d}
                dayKey={key}
                entries={entriesByDay.get(key) ?? []}
                absences={absencesByDay.get(key) ?? []}
                workerNameById={workerNameById}
                loading={isLoading}
                onAdd={() => setAddDay(key)}
              />
            );
          })}
        </div>
      )}

      {addDay && <AddEntryModal day={addDay} onClose={() => setAddDay(null)} />}
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

function DayCell({
  date,
  dayKey,
  entries,
  absences,
  workerNameById,
  loading,
  onAdd,
}: {
  date: Date;
  dayKey: string;
  entries: CalendarEntryDto[];
  absences: CalendarAbsence[];
  workerNameById: Map<string, string>;
  loading: boolean;
  onAdd: () => void;
}) {
  const isToday = dayKey === toDateKey(new Date());

  return (
    <Card className={isToday ? "ring-2 ring-blue-500" : undefined}>
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div>
          <div className="text-xs font-medium text-gray-500">{WEEKDAY_LABEL.format(date)}</div>
          <div className="text-sm font-semibold text-gray-900">{DAY_LABEL.format(date)}</div>
        </div>
        <StaffingWriteGate>
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add calendar entry for ${dayKey}`}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </StaffingWriteGate>
      </div>
      <div className="min-h-[88px] space-y-1.5 p-2">
        {loading ? (
          <>
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </>
        ) : (
          <>
            {entries.map((e) => (
              <div key={e.id} className="truncate rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                {workerNameById.get(e.worker_id) ?? e.worker_id}
              </div>
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

function AddEntryModal({ day, onClose }: { day: string; onClose: () => void }) {
  const { hotels, isLoading: hotelsLoading } = useHotelOptions();
  const { users: workers, isLoading: workersLoading } = useUserOptions({ role: "worker" });
  const [hotelId, setHotelId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = hotelId && workerId;

  const onSubmit = async () => {
    if (!valid) return;
    setError(null);
    setSubmitting(true);
    try {
      await assignmentsApi.createCalendarEntry({ hotel_id: hotelId, worker_id: workerId, day });
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
          onChange={(e) => setHotelId(e.target.value)}
          placeholder={hotelsLoading ? "Loading…" : "Select a hotel"}
          disabled={hotelsLoading}
          options={hotels.map((h) => ({ value: h.id, label: h.name }))}
        />
        <Select
          label="Worker"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          placeholder={workersLoading ? "Loading…" : "Select a worker"}
          disabled={workersLoading}
          options={workers.map((w) => ({ value: w.id, label: `${w.first_name} ${w.last_name}` }))}
        />
        <Input label="Day" type="date" value={day} readOnly disabled />
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}
