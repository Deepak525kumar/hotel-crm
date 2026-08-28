import type { CalendarAbsence, WorkerAssignment } from '@/types/api';

/**
 * The calendar's list: shifts and absences on one timeline.
 *
 * The screen used to load `GET /calendar/my-absences` and nothing else, so it
 * answered "which days did I mark off" but not "what am I doing this week".
 * A worker or checker looking at their own calendar could see the sick days
 * they had booked and no sign of the shifts those days were booked against —
 * the two halves of the same question lived on two different tabs.
 *
 * Pure and separate from the screen so it is testable: this project's jest
 * config collects logic from `.test.ts`, so merge/sort rules left inside a
 * component are untested by construction.
 */
export type AgendaEntry =
  | { kind: 'absence'; day: string; absence: CalendarAbsence }
  | { kind: 'shift'; day: string; shift: WorkerAssignment };

/**
 * The calendar day an assignment falls on, or null when it has none.
 *
 * `day` is the denormalized column every creation path writes (Epic 9 PR 9.6);
 * `work_request.shift_date` is the older lineage and is read only as a
 * fallback, because rows created before that migration may carry one and not
 * the other. Sliced rather than re-projected through a timezone: both are
 * date-only fields serialized as UTC midnight, so the first ten characters
 * ARE the calendar day. Converting them would shift the day backwards for any
 * viewer west of UTC.
 */
function dayOf(shift: WorkerAssignment): string | null {
  const raw = shift.day ?? shift.work_request?.shift_date ?? null;
  return raw ? raw.slice(0, 10) : null;
}

/**
 * REASSIGNED rows are superseded by another assignment for the same work —
 * listing them shows one shift twice, the second copy inert. Every other
 * status is kept, CANCELLED included: marking a day sick auto-cancels that
 * day's shift, and hiding the result would answer "where did my shift go?"
 * with silence. The status badge says which is which.
 */
const HIDDEN_STATUSES = new Set(['REASSIGNED']);

export function buildAgenda(
  absences: readonly CalendarAbsence[],
  shifts: readonly WorkerAssignment[],
  options: { from?: string } = {}
): AgendaEntry[] {
  const from = options.from ?? null;

  const entries: AgendaEntry[] = [];

  for (const absence of absences) {
    if (from && absence.day < from) continue;
    entries.push({ kind: 'absence', day: absence.day, absence });
  }

  for (const shift of shifts) {
    if (HIDDEN_STATUSES.has(shift.status)) continue;
    const day = dayOf(shift);
    // A shift with no resolvable day cannot be placed on a calendar. Dropped
    // rather than bucketed under today, which would put it on a date it is
    // not on and let someone plan around a fiction.
    if (!day) continue;
    if (from && day < from) continue;
    entries.push({ kind: 'shift', day, shift });
  }

  return entries.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    // Absence first on a shared day: it is the reason the shift next to it is
    // cancelled, so reading it second inverts cause and effect.
    if (a.kind !== b.kind) return a.kind === 'absence' ? -1 : 1;
    // Stable within a kind, so the list does not reshuffle between refreshes.
    const aId = a.kind === 'absence' ? a.absence.id : a.shift.id;
    const bId = b.kind === 'absence' ? b.absence.id : b.shift.id;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
}

/**
 * Which days carry a shift, for the month grid's dots.
 *
 * A Set rather than a count: the grid marks a day, it does not stack one dot
 * per shift.
 */
export function shiftDays(shifts: readonly WorkerAssignment[]): Set<string> {
  const days = new Set<string>();
  for (const shift of shifts) {
    if (HIDDEN_STATUSES.has(shift.status)) continue;
    const day = dayOf(shift);
    if (day) days.add(day);
  }
  return days;
}
