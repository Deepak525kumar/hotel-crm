import { isoDateInCalendarTimezone, formatDay, datesInRange, weekOf, addDays } from '@/lib/calendar-dates';

/**
 * GD-18 narrow slice (OD-CAL-04): the mobile "today"/"tomorrow" quick-mark
 * buttons must agree with the backend's Europe/Berlin-anchored "today"
 * (calendar/service.ts todayInCalendarTimezone()), not the device's local
 * timezone -- otherwise a worker near a date boundary could have a "today"
 * mark rejected by the server as a past day, or vice versa.
 */

describe('isoDateInCalendarTimezone', () => {
  it('returns a YYYY-MM-DD string', () => {
    const day = isoDateInCalendarTimezone(0);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('advances by exactly one calendar day for daysFromToday=1', () => {
    const today = isoDateInCalendarTimezone(0);
    const tomorrow = isoDateInCalendarTimezone(1);

    const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();
    const tomorrowMs = new Date(`${tomorrow}T00:00:00.000Z`).getTime();

    expect(tomorrowMs - todayMs).toBe(24 * 60 * 60 * 1000);
  });

  it('is independent of the JS process timezone (matches Europe/Berlin, not local)', () => {
    // Fixed instant: 2026-07-27T23:30:00Z is already 2026-07-28 in
    // Europe/Berlin (UTC+2 in July, DST) but still 2026-07-27 in most
    // timezones west of UTC -- pins that this helper follows Berlin, not the
    // ambient process/device timezone.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T23:30:00.000Z'));
    try {
      expect(isoDateInCalendarTimezone(0)).toBe('2026-07-28');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('formatDay', () => {
  it('formats a YYYY-MM-DD string for display without a local-timezone off-by-one', () => {
    expect(formatDay('2026-07-28')).toBe('Tue, Jul 28');
  });
});

describe('datesInRange', () => {
  it('includes both ends', () => {
    expect(datesInRange('2026-08-24', '2026-08-26')).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });

  it('returns a single day when start equals end', () => {
    expect(datesInRange('2026-08-24', '2026-08-24')).toEqual(['2026-08-24']);
  });

  it('returns nothing when the range is reversed', () => {
    expect(datesInRange('2026-08-26', '2026-08-24')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(datesInRange('2026-08-30', '2026-09-01')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  // 2028 is a leap year; a naive +1 day over Feb 28 loses the 29th.
  it('crosses a leap day', () => {
    expect(datesInRange('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
});

describe('weekOf', () => {
  it('starts the week on Monday', () => {
    // 2026-08-26 is a Wednesday.
    const week = weekOf('2026-08-26');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-08-24');
    expect(week[6]).toBe('2026-08-30');
  });

  // Sunday is the end of a Monday-based week, not the start of the next one.
  it('treats Sunday as the last day of the same week', () => {
    expect(weekOf('2026-08-30')[0]).toBe('2026-08-24');
  });
});

describe('addDays', () => {
  it('moves forward and backward across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });
});
