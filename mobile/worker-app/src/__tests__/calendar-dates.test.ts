import { isoDateInCalendarTimezone, formatDay } from '@/lib/calendar-dates';

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
