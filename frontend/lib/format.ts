import { todayKeyInCalendarTimezone } from "@/lib/calendar";
/**
 * Presentation-layer formatting helpers. Centralised so date/number rendering
 * stays consistent across detail views and tables.
 */

/** Formats an ISO timestamp as a localized date + time, or "—" when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** Formats an ISO timestamp as a localized date, or "—" when absent/invalid. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/**
 * Today's date in the platform CALENDAR timezone (Europe/Berlin), as
 * YYYY-MM-DD -- for comparing against, and setting the `min` of, a
 * `type="date"` input.
 *
 * It used to return the BROWSER's local date, and the name still says so.
 * That was wrong in a way no timezone-agnostic reasoning catches: every
 * date-only field these inputs feed (`CalendarEntry.day`, absence days,
 * shift dates) is resolved server-side in Europe/Berlin, so a manager east
 * of Frankfurt saw a `min` of their own tomorrow and could submit a day the
 * backend then treated as the future. Reported from the field on 2026-08-29
 * at 03:12 IST, when Frankfurt was still on 2026-08-28: a shift placed on
 * "today" could not be checked into, because the server called it a future
 * day. See `todayKeyInCalendarTimezone()` in `lib/calendar.ts`.
 *
 * No timezone conversion happens at the input itself, which is why this is
 * the right fix rather than a papering-over: a date input's `.value` is a
 * bare calendar date with no instant behind it, and `min` is compared as
 * one. Handing it the Frankfurt day simply makes the floor agree with the
 * rule the server will apply.
 *
 * `new Date().toISOString().slice(0, 10)` remains the wrong shortcut for the
 * same underlying reason it always was -- it answers with the UTC date,
 * which is a third zone that matches neither the browser nor Frankfurt.
 */
export function localToday(): string {
  // Name kept only to avoid churning five call sites in a fix that needs to
  // ship; it is wrong and should follow.
  return todayKeyInCalendarTimezone();
}

/**
 * Formats a already-scaled percentage (0–100 from the analytics API) with a
 * `%` suffix, trimming a trailing `.0`. Returns "—" for nullish input.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/** Formats a numeric score to `digits` decimals, or "—" when nullish. */
export function formatScore(
  value: number | null | undefined,
  digits = 1,
): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}
