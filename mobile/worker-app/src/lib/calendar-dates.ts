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
