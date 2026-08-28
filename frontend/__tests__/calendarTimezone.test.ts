import {
  CALENDAR_TIMEZONE,
  toDateKey,
  todayInCalendarTimezone,
  todayKeyInCalendarTimezone,
} from "@/lib/calendar";
import { localToday } from "@/lib/format";

/**
 * The web's notion of "today" must be Frankfurt's, not the browser's.
 *
 * Reported from the field on 2026-08-29 at 03:12 IST, when Frankfurt was
 * still on 2026-08-28: a manager placed a shift on the cell the calendar
 * called "today", and the worker was then refused at check-in with "this
 * calendar shift is scheduled for a future day" -- for a shift they could
 * see, on a day the app told them was today.
 *
 * The bug was `toDateKey(new Date())`: browser-local date parts, compared
 * against a backend that resolves every date-only field in Europe/Berlin
 * (`todayInCalendarTimezone()` in backend/src/lib/utils.ts).
 *
 * These tests pin the instant AND the process timezone, because a test that
 * merely calls the helper at wall-clock time passes for most of the day in
 * every zone -- including the broken implementation.
 */
const REPORTED_INSTANT = new Date("2026-08-28T21:42:00.000Z"); // 03:12 IST Aug 29 / 23:42 Berlin Aug 28

describe("calendar timezone", () => {
  const realTZ = process.env.TZ;

  afterEach(() => {
    jest.useRealTimers();
    process.env.TZ = realTZ;
  });

  it("is Frankfurt's zone", () => {
    // Frankfurt has no IANA zone of its own; Europe/Berlin is it.
    expect(CALENDAR_TIMEZONE).toBe("Europe/Berlin");
  });

  it("reports Frankfurt's day when the browser is already on the next one", () => {
    jest.useFakeTimers().setSystemTime(REPORTED_INSTANT);

    // The exact reported condition. The old implementation returned
    // 2026-08-29 here -- the server's tomorrow.
    expect(todayKeyInCalendarTimezone()).toBe("2026-08-28");
  });

  it("reports Frankfurt's day when the browser is still on the previous one", () => {
    // The mirror case, which a fix that merely subtracted hours would break:
    // 00:30 Berlin on Aug 29 is still 18:30 Aug 28 in New York.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-28T22:30:00.000Z"));

    expect(todayKeyInCalendarTimezone()).toBe("2026-08-29");
  });

  it("round-trips: the anchor Date names the same day as the key", () => {
    // The grid navigates by local date arithmetic and reads cells back with
    // toDateKey, so the anchor must be a local midnight whose calendar day is
    // Frankfurt's today. If these two disagree, the grid highlights one cell
    // as "today" and posts a different date when you click it.
    jest.useFakeTimers().setSystemTime(REPORTED_INSTANT);

    expect(toDateKey(todayInCalendarTimezone())).toBe(todayKeyInCalendarTimezone());
  });

  it("gives date inputs the same floor the calendar uses", () => {
    // localToday() backs the `min` attribute on every form that creates a
    // dated record. A browser-local floor let a manager pick a day the
    // backend then rejected as being in the past, or accepted as tomorrow.
    jest.useFakeTimers().setSystemTime(REPORTED_INSTANT);

    expect(localToday()).toBe(todayKeyInCalendarTimezone());
  });

  it("toDateKey still names a day you already hold, without re-projecting it", () => {
    // Deliberate asymmetry: cells are local midnights standing for calendar
    // days. Pushing them through a timezone would shift every cell by a day
    // for viewers far from Frankfurt, which is a worse bug than the one
    // being fixed.
    const cell = new Date(2026, 7, 29); // local midnight, 29 Aug
    expect(toDateKey(cell)).toBe("2026-08-29");
  });
});
