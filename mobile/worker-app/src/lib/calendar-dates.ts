// GD-18 narrow slice (OD-CAL-04 implementation-time default): "today" is
// anchored to Europe/Berlin on the backend (matches Hotel.timezone's own
// default, SPEC-CRM-001) — mirrored here so the client's "today"/"tomorrow"
// quick-mark buttons agree with what the server will accept, rather than the
// device's local timezone potentially rejecting a mark as "past" (backend
// calendar/service.ts todayInCalendarTimezone()).
const CALENDAR_TIMEZONE = 'Europe/Berlin';

export function isoDateInCalendarTimezone(daysFromToday: number): string {
  const now = new Date();
  const base = new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TIMEZONE }).format(now);
  const shifted = new Date(`${base}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + daysFromToday);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The calendar-timezone date (YYYY-MM-DD) an instant falls on.
 *
 * Slicing the first ten characters off an ISO timestamp gives the UTC date,
 * which is a different day from ~22:00 Berlin onward: a shift checked into at
 * 00:30 local displayed as the previous day. Shifts are anchored to
 * Europe/Berlin (Hotel.timezone's default, SPEC-CRM-001), so that is the day
 * the worker means.
 */
export function calendarDateOf(iso: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: CALENDAR_TIMEZONE }).format(new Date(iso));
}

/** Wall-clock time in the calendar timezone, for the same reason. */
export function calendarTimeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CALENDAR_TIMEZONE,
  });
}

export function formatDay(day: string): string {
  // day is YYYY-MM-DD (date-only); parsing/formatting as UTC avoids a
  // local-timezone off-by-one when the device's own timezone differs.
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Every ISO day from `start` to `end` inclusive, in order. Empty if reversed. */
export function datesInRange(start: string, end: string): string[] {
  if (end < start) return [];
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Monday-based week containing `day`, as seven ISO dates. */
export function weekOf(day: string): string[] {
  const d = new Date(`${day}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  const monday = d.toISOString().slice(0, 10);
  return datesInRange(monday, addDays(monday, 6));
}

/** `day` shifted by `n` days, staying date-only. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
