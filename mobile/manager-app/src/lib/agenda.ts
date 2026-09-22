import type { CalendarAbsence, CalendarEntry } from '@hotel-crm/mobile-shared';

/**
 * Calendar day arithmetic, kept as `YYYY-MM-DD` strings throughout.
 *
 * NEVER a `Date` for a calendar day. This codebase's most expensive date bug
 * is exactly that conversion: "today" here is Europe/Berlin
 * (`CALENDAR_TIMEZONE`), and `new Date('2026-09-22')` is midnight **UTC**, so
 * a night-shift manager in Berlin is handed yesterday. Every day value the
 * API speaks is already a string; keeping it one means no timezone
 * conversion can happen by accident in between.
 *
 * The arithmetic below uses Date only through `Date.UTC`, which is
 * timezone-free by construction, and converts straight back to a string.
 */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  const next = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The strip of days shown above the agenda, centred on `day`. */
export function dayStrip(day: string, before = 3, after = 3): string[] {
  const out: string[] = [];
  for (let i = -before; i <= after; i += 1) out.push(addDays(day, i));
  return out;
}

export type AgendaGroup = {
  hotelId: string;
  entries: CalendarEntry[];
};

/**
 * Placements for one day, grouped by hotel.
 *
 * Cancelled placements are KEPT, not filtered out. `assignment_status` exists
 * on list responses precisely so a cancelled placement renders distinctly
 * rather than silently vanishing (backend note, 2026-08-13) -- a shift that
 * disappears from the rota with no trace is indistinguishable from one that
 * was never made, and a manager cannot tell whether their cancel worked.
 */
export function groupByHotel(entries: readonly CalendarEntry[], day: string): AgendaGroup[] {
  const forDay = entries.filter((e) => e.day === day);
  const byHotel = new Map<string, CalendarEntry[]>();
  for (const entry of forDay) {
    const list = byHotel.get(entry.hotel_id);
    if (list) list.push(entry);
    else byHotel.set(entry.hotel_id, [entry]);
  }
  return [...byHotel.entries()].map(([hotelId, list]) => ({ hotelId, entries: list }));
}

export function absencesForDay(
  absences: readonly CalendarAbsence[],
  day: string
): CalendarAbsence[] {
  return absences.filter((a) => a.day === day);
}

/**
 * Which day cell a drag ended over, or null if the finger was outside them.
 *
 * Pure so the drop rule is testable without a gesture: a drag that lands
 * between cells, or off the strip entirely, must be a no-op rather than
 * snapping to the nearest day. This is a destructive write to a real
 * person's rota -- "nearest" is a guess, and a guess here moves the wrong
 * shift.
 */
export function dropTargetAt(
  x: number,
  cells: readonly { day: string; x: number; width: number }[]
): string | null {
  for (const cell of cells) {
    if (x >= cell.x && x < cell.x + cell.width) return cell.day;
  }
  return null;
}

/**
 * Whether a move is worth sending.
 *
 * A drag that ends on the day it started is not an error and not a write --
 * it is the most common way a long-press is released. Sending it would burn
 * a round trip on a hotel's mobile data and write an audit row saying
 * nothing happened.
 */
export function isRealMove(from: string, to: string | null): to is string {
  return to !== null && to !== from;
}
