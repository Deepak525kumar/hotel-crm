/**
 * Pure date helpers and view types shared by the calendar page and its
 * extracted components (components/calendar/CalendarFilters.tsx,
 * RangeBreakdown.tsx). Split out 2026-08-10 so those components don't need
 * to import from the page module itself.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarView = "day" | "week" | "month";

/**
 * `labelKey` is an i18n key, not copy -- resolve it with `t()` at the point of
 * render. Holding literal English here is what left the calendar's day/week/
 * month toggle in English in every locale, the same defect class already fixed
 * in `lib/skills.ts` and `useMyOnboarding`.
 */
export const VIEW_OPTIONS: { value: CalendarView; labelKey: string }[] = [
  { value: "day", labelKey: "calendar.viewDay" },
  { value: "week", labelKey: "calendar.viewWeek" },
  { value: "month", labelKey: "calendar.viewMonth" },
];

/**
 * The platform's calendar timezone.
 *
 * Every date-only field the API accepts or returns (`CalendarEntry.day`,
 * `WorkerAssignment.day`, absence days, shift dates) is interpreted by the
 * backend in this zone -- `todayInCalendarTimezone()` in
 * `backend/src/lib/utils.ts`, which every "is this today / in the past"
 * server-side rule is written against. Frankfurt is in Europe/Berlin, so this
 * is the operating timezone of the business, not a developer convenience.
 */
export const CALENDAR_TIMEZONE = "Europe/Berlin";

/**
 * Today's date key in the calendar timezone -- NOT the browser's.
 *
 * The difference is not cosmetic and it is not rare. A manager in IST
 * (UTC+5:30) between midnight and 03:30 local is still on the PREVIOUS day in
 * Frankfurt. Placing a shift on the cell their calendar called "today" then
 * sent tomorrow's date to a backend that disagreed, and the worker was
 * refused at check-in with "this calendar shift is scheduled for a future
 * day" -- for a shift they could see, on a day the app told them was today.
 * Reported from the field on 2026-08-29 at 03:12 IST, when Frankfurt was
 * still on 2026-08-28.
 *
 * The mobile apps have always done this correctly
 * (see each app's `src/lib/calendar-dates.ts`); only the web read the browser.
 */
export function todayKeyInCalendarTimezone(): string {
  // en-CA formats as YYYY-MM-DD, the shape every date-only API field uses.
  return new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIMEZONE }).format(new Date());
}

/**
 * Today in the calendar timezone, as a Date whose LOCAL y/m/d are that day.
 *
 * Deliberately not "the current instant": the grid navigates by local date
 * arithmetic (startOfWeek, startOfMonthGrid, +DAY_MS) and reads cells back
 * with toDateKey, so an anchor has to be a local midnight whose calendar day
 * is the one we mean. Passing a raw `new Date()` is what put the grid a day
 * ahead of the server.
 */
export function todayInCalendarTimezone(): Date {
  const [y, m, d] = todayKeyInCalendarTimezone().split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/**
 * The calendar day `d` represents, as YYYY-MM-DD.
 *
 * Reads the Date's own local y/m/d ON PURPOSE, and must keep doing so: grid
 * cells are constructed as local midnights standing for calendar days, so
 * re-projecting them through a timezone here would shift every cell by a day
 * for any viewer west or far east of Frankfurt. Use
 * todayKeyInCalendarTimezone() to ask what day it is NOW; this function only
 * names a day you already have.
 */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
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
export function startOfMonthGrid(d: Date): Date {
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(firstOfMonth);
}

export const WEEKDAY_LABEL = new Intl.DateTimeFormat("en", { weekday: "short" });
export const DAY_LABEL = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
export const MONTH_DAY_LABEL = new Intl.DateTimeFormat("en", { day: "numeric" });
export const MONTH_TITLE_LABEL = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
export const FULL_DAY_LABEL = new Intl.DateTimeFormat("en", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
