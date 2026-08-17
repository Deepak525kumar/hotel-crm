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

/** YYYY-MM-DD in the local timezone (matches the backend's date-only day field). */
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
