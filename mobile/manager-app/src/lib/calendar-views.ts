import { addDays } from './agenda';

export type CalendarView = 'day' | 'week' | 'month';

/** Monday-first, matching how a European rota is read. */
export function startOfWeek(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  // getUTCDay() is timezone-free; the value is a calendar day, never a moment.
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  return addDays(day, -backToMonday);
}

export function weekDays(day: string): string[] {
  const start = startOfWeek(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/**
 * The 6x7 grid a month view needs, padded with the surrounding days.
 *
 * Always 42 cells so the grid does not change height between months — a
 * calendar that grows and shrinks as you page through it is unpleasant to
 * use and makes the row under it jump.
 */
export function monthGrid(day: string): string[] {
  const first = startOfMonth(day);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function isSameMonth(day: string, reference: string): boolean {
  return day.slice(0, 7) === reference.slice(0, 7);
}

/** How far one tap of the arrows moves, per view. */
export function step(view: CalendarView, day: string, direction: 1 | -1): string {
  if (view === 'day') return addDays(day, direction);
  if (view === 'week') return addDays(day, 7 * direction);
  // Months vary in length, so stepping by 28-31 days drifts. Anchor to the
  // first of the month, move one month, and keep the day-of-month clamped by
  // construction (the 1st always exists).
  const [y, m] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + direction, 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-01`;
}
