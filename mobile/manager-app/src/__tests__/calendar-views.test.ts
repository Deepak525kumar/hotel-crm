import {
  isSameMonth,
  monthGrid,
  startOfMonth,
  startOfWeek,
  step,
  weekDays,
} from '@/lib/calendar-views';

describe('week boundaries', () => {
  // Monday-first: this is a European rota, and a week that starts on Sunday
  // puts the weekend in the wrong half of the grid.
  it('starts a week on Monday', () => {
    // 2026-09-23 is a Wednesday.
    expect(startOfWeek('2026-09-23')).toBe('2026-09-21');
  });

  it('treats Monday itself as the start', () => {
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21');
  });

  // The case an off-by-one produces: Sunday belongs to the week that is
  // ending, not the one beginning the next day.
  it('puts Sunday at the END of its week', () => {
    expect(startOfWeek('2026-09-27')).toBe('2026-09-21');
    expect(weekDays('2026-09-27')[6]).toBe('2026-09-27');
  });

  it('gives seven consecutive days', () => {
    const week = weekDays('2026-09-23');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-09-21');
    expect(week[6]).toBe('2026-09-27');
  });
});

describe('month grid', () => {
  // Always 42 cells so the grid does not change height between months. A
  // calendar that grows and shrinks as you page makes the content below jump.
  it('is always six weeks, whatever the month', () => {
    for (const day of ['2026-02-10', '2026-09-23', '2028-02-10']) {
      expect(monthGrid(day)).toHaveLength(42);
    }
  });

  it('starts on the Monday on or before the 1st', () => {
    // 2026-09-01 is a Tuesday, so the grid opens on Monday the 31st of August.
    expect(monthGrid('2026-09-23')[0]).toBe('2026-08-31');
  });

  it('knows which cells belong to the month being shown', () => {
    expect(isSameMonth('2026-08-31', '2026-09-23')).toBe(false);
    expect(isSameMonth('2026-09-01', '2026-09-23')).toBe(true);
  });

  it('anchors to the first of the month', () => {
    expect(startOfMonth('2026-09-23')).toBe('2026-09-01');
  });
});

describe('stepping between periods', () => {
  it('moves one day, one week, one month', () => {
    expect(step('day', '2026-09-23', 1)).toBe('2026-09-24');
    expect(step('week', '2026-09-23', 1)).toBe('2026-09-30');
    expect(step('month', '2026-09-23', 1)).toBe('2026-10-01');
  });

  /**
   * The bug a naive implementation has.
   *
   * Stepping a month by adding 30 days drifts: from 31 January it lands in
   * March, skipping February entirely. Anchoring to the 1st and moving the
   * month index cannot drift, and the 1st always exists so nothing needs
   * clamping.
   */
  it('does not skip February when stepping from the 31st', () => {
    expect(step('month', '2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year in both directions', () => {
    expect(step('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(step('month', '2026-01-15', -1)).toBe('2025-12-01');
  });

  it('steps backwards', () => {
    expect(step('day', '2026-09-01', -1)).toBe('2026-08-31');
    expect(step('week', '2026-09-23', -1)).toBe('2026-09-16');
  });
});
