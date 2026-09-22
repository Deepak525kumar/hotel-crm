import {
  absencesForDay,
  addDays,
  dayStrip,
  dropTargetAt,
  groupByHotel,
  isRealMove,
} from '@/lib/agenda';
import type { CalendarAbsence, CalendarEntry } from '@hotel-crm/mobile-shared';
import { todayInBerlin } from '@/lib/today';

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({
  id: 'e1',
  assignment_id: 'a1',
  worker_id: 'w1',
  hotel_id: 'h1',
  day: '2026-09-22',
  placed_by_id: 'm1',
  created_at: '',
  updated_at: '',
  ...over,
});

describe('calendar day arithmetic', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('crosses a year boundary backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  /**
   * The regression this whole module is written in strings to avoid.
   *
   * `new Date('2026-09-22')` is midnight UTC. Read back in any timezone
   * behind UTC it is the 21st -- and "today" in this product is
   * Europe/Berlin, which is AHEAD of UTC, so the error surfaces for the
   * night shift rather than uniformly. A manager placing someone "tomorrow"
   * at 00:30 Berlin would have written today.
   *
   * Asserted by result rather than by implementation: if someone rewrites
   * these helpers with local-time Date maths, this fails.
   */
  it('is not affected by the running machine’s timezone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      expect(addDays('2026-09-22', 1)).toBe('2026-09-23');
      process.env.TZ = 'Pacific/Midway'; // UTC-11
      expect(addDays('2026-09-22', 1)).toBe('2026-09-23');
    } finally {
      process.env.TZ = original;
    }
  });

  it('builds a strip centred on the given day', () => {
    expect(dayStrip('2026-09-22', 1, 1)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23']);
  });
});

describe('agenda grouping', () => {
  it('groups a day’s placements by hotel', () => {
    const groups = groupByHotel(
      [
        entry({ id: 'a', hotel_id: 'h1' }),
        entry({ id: 'b', hotel_id: 'h2' }),
        entry({ id: 'c', hotel_id: 'h1' }),
      ],
      '2026-09-22'
    );
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.hotelId === 'h1')?.entries).toHaveLength(2);
  });

  it('excludes other days', () => {
    expect(groupByHotel([entry({ day: '2026-09-23' })], '2026-09-22')).toHaveLength(0);
  });

  // A cancelled shift that vanishes is indistinguishable from one that was
  // never made -- the manager cannot tell whether their cancel worked.
  it('keeps a cancelled placement rather than hiding it', () => {
    const groups = groupByHotel([entry({ assignment_status: 'CANCELLED' as never })], '2026-09-22');
    expect(groups[0].entries).toHaveLength(1);
  });

  it('filters absences to the day', () => {
    const absences = [
      { day: '2026-09-22' },
      { day: '2026-09-23' },
    ] as unknown as CalendarAbsence[];
    expect(absencesForDay(absences, '2026-09-22')).toHaveLength(1);
  });
});

describe('drag drop targets', () => {
  const cells = [
    { day: '2026-09-21', x: 0, width: 50 },
    { day: '2026-09-22', x: 50, width: 50 },
    { day: '2026-09-23', x: 100, width: 50 },
  ];

  it('resolves a drop inside a cell', () => {
    expect(dropTargetAt(75, cells)).toBe('2026-09-22');
  });

  it('is inclusive at the left edge and exclusive at the right', () => {
    expect(dropTargetAt(50, cells)).toBe('2026-09-22');
    expect(dropTargetAt(100, cells)).toBe('2026-09-23');
  });

  // "Nearest" is a guess, and a guess here moves the wrong person's shift.
  it('returns null outside the strip rather than snapping to the nearest day', () => {
    expect(dropTargetAt(-20, cells)).toBeNull();
    expect(dropTargetAt(400, cells)).toBeNull();
  });

  it('treats a release on the original day as no move at all', () => {
    expect(isRealMove('2026-09-22', '2026-09-22')).toBe(false);
    expect(isRealMove('2026-09-22', null)).toBe(false);
    expect(isRealMove('2026-09-22', '2026-09-23')).toBe(true);
  });
});

describe('today, as the calendar means it', () => {
  // The backend anchors a "day" to Europe/Berlin (CALENDAR_TIMEZONE). A
  // device set to UTC opening the app at 00:30 Berlin is in the previous UTC
  // day -- so a naive local "today" shows yesterday's rota and places
  // tomorrow's staff on the wrong date. Berlin is ahead of UTC, which is why
  // this surfaces for the night shift rather than uniformly.
  it('is the Berlin day, not the device’s', () => {
    // 2026-09-22T23:30Z is already the 23rd in Berlin (UTC+2 in September).
    expect(todayInBerlin(new Date('2026-09-22T23:30:00Z'))).toBe('2026-09-23');
  });

  it('is still the Berlin day when the device is far ahead', () => {
    // 2026-09-22T01:00Z is the 22nd in Berlin, whatever the device thinks.
    expect(todayInBerlin(new Date('2026-09-22T01:00:00Z'))).toBe('2026-09-22');
  });

  it('formats as YYYY-MM-DD, the shape every calendar endpoint speaks', () => {
    expect(todayInBerlin(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });
});
