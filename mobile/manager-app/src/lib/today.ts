/**
 * Today, as the calendar means it.
 *
 * Europe/Berlin, not the device's timezone and not UTC. `CALENDAR_TIMEZONE`
 * is what the backend anchors a "day" to, and the mismatch is not academic:
 * a manager opening the app at 00:30 Berlin from a phone set to UTC would be
 * shown yesterday's rota and would place tomorrow's staff on the wrong date.
 *
 * `en-CA` because it formats as `YYYY-MM-DD` — the exact shape every calendar
 * endpoint speaks, produced without any string surgery on a localised date.
 */
export function todayInBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
