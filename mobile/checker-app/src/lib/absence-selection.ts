import { datesInRange } from '@/lib/calendar-dates';

/**
 * Day selection for marking sick/vacation.
 *
 * The screen used to offer exactly two fixed buttons (today, tomorrow), so
 * neither of these cases could arise. Allowing an arbitrary date introduces
 * both:
 *
 *  - A past day. The backend anchors "today" to Europe/Berlin and refuses a
 *    past mark, so tapping one could only ever produce an error.
 *  - An unbounded range. `submitMark` issues one request per day, so a stray
 *    two-year selection would fire ~700 sequential writes.
 */

/** Longest range that can be marked at once. */
export const MAX_ABSENCE_RANGE_DAYS = 62;

export interface DaySelection {
  start: string | null;
  end: string | null;
}

/**
 * Applies a tap. Returns the unchanged selection when the tap is not allowed,
 * so the caller can treat "no change" as "rejected" without a second concept.
 */
export function resolveDaySelection(args: {
  current: DaySelection;
  tapped: string;
  /** Today in the calendar's timezone, from isoDateInCalendarTimezone(0). */
  today: string;
}): DaySelection {
  const { current, tapped, today } = args;
  if (tapped < today) return current;

  const extending = current.start !== null && current.end === null && tapped > current.start;
  if (!extending) return { start: tapped, end: null };

  // Clamp rather than reject: the worker's intent is clear, and silently
  // dropping the tap would look like the screen had frozen.
  const capped = datesInRange(current.start!, tapped).slice(0, MAX_ABSENCE_RANGE_DAYS);
  return { start: current.start, end: capped[capped.length - 1] ?? tapped };
}

/** The days a selection covers. */
export function selectedDays(selection: DaySelection, fallback: string): string[] {
  if (selection.start && selection.end) return datesInRange(selection.start, selection.end);
  return [selection.start ?? fallback];
}
