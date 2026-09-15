/**
 * EVERY DATE IN A PROPOSED CHANGE MUST COME FROM THE PERSON.
 *
 * Replaying the owner's own conversation word for word, 2026-09-15:
 *
 *     > make me plans. for parveen 17 18 19 September      (scheduled)
 *     > add that another dates also
 *     Put several workers on the schedule:
 *       - Parveen Kumar, 2026-09-20
 *       - Parveen Kumar, 2026-09-21
 *       - Parveen Kumar, 2026-09-22
 *
 * Nobody said 20, 21 or 22. The model invented three days, the confirmation
 * showed them as fact, and a manager pressing Confirm out of habit would have
 * put a worker on three shifts nobody asked for. The prompt already says never
 * to guess a date; a prompt is a request, not a control, and another rule there
 * measurably costs routing accuracy.
 *
 * So before any confirmation is issued, each date in the proposed arguments is
 * traced back to the person's OWN words in this conversation (the current
 * message and the replayed earlier ones -- never the assistant's). A date is
 * supported when its day-of-month number was written, when the ISO date itself
 * was written, or when the text uses a relative or weekday word ("tomorrow",
 * "next week", "Monday", "heute") that a date table can legitimately resolve.
 * Anything else is a guess, and the person is asked instead.
 *
 * Deliberately lenient where it cannot be exact: relative words admit any
 * date, because "next week" does not name one day. It exists to stop dates
 * that came from nowhere, not to second-guess every calendar reading.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const RELATIVE_WORDS =
  /\b(today|tonight|tomorrow|yesterday|week|weekend|weeks|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|heute|morgen|uebermorgen|übermorgen|gestern|woche|wochenende|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i;

/** Every ISO date anywhere in a value, however deeply nested. */
export function collectDates(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectDates(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectDates(item, out);
  }
  return out;
}

/** The proposed dates the person's own words do not support. Empty when all are supported. */
export function unsupportedDates(args: unknown, userTexts: readonly string[]): string[] {
  const dates = [...new Set(collectDates(args))];
  if (dates.length === 0) return [];

  const text = userTexts.join(' \n ');
  if (RELATIVE_WORDS.test(text)) return [];

  // Numbers the person actually typed, as numbers: "07.09.2026" gives 7, 9 and
  // 2026; "17 18 19" gives 17, 18, 19; "2026-09-17" gives 2026, 9 and 17.
  const numbers = new Set((text.match(/\d+/g) ?? []).map((n) => Number(n)));

  return dates.filter((date) => {
    if (text.includes(date)) return false;
    const day = Number(date.slice(8, 10));
    return !numbers.has(day);
  });
}

export function renderUnsupportedDates(): string {
  return (
    'Which date do you mean? I would rather ask than guess -- tell me the days, for example ' +
    '"20 September" or "tomorrow", and I will show you the change to confirm.'
  );
}
