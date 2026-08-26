import {
  MAX_ABSENCE_RANGE_DAYS,
  resolveDaySelection,
  selectedDays,
} from '@/lib/absence-selection';

const TODAY = '2026-08-26';

describe('resolveDaySelection', () => {
  it('selects a single future day', () => {
    expect(resolveDaySelection({ current: { start: null, end: null }, tapped: '2026-08-28', today: TODAY }))
      .toEqual({ start: '2026-08-28', end: null });
  });

  it('allows today itself', () => {
    expect(resolveDaySelection({ current: { start: null, end: null }, tapped: TODAY, today: TODAY }))
      .toEqual({ start: TODAY, end: null });
  });

  // The backend anchors "today" to Europe/Berlin and refuses a past mark, so
  // this tap could only ever produce an error.
  it('ignores a past day', () => {
    const current = { start: '2026-08-28', end: null };
    expect(resolveDaySelection({ current, tapped: '2026-08-25', today: TODAY })).toEqual(current);
  });

  it('extends to a range when the second tap is later', () => {
    expect(resolveDaySelection({ current: { start: '2026-08-26', end: null }, tapped: '2026-08-30', today: TODAY }))
      .toEqual({ start: '2026-08-26', end: '2026-08-30' });
  });

  it('restarts when the second tap is earlier than the start', () => {
    expect(resolveDaySelection({ current: { start: '2026-08-30', end: null }, tapped: '2026-08-28', today: TODAY }))
      .toEqual({ start: '2026-08-28', end: null });
  });

  it('restarts once a range is already complete', () => {
    expect(resolveDaySelection({ current: { start: '2026-08-26', end: '2026-08-30' }, tapped: '2026-09-02', today: TODAY }))
      .toEqual({ start: '2026-09-02', end: null });
  });

  it('treats a second tap on the start as a restart, not a zero-length range', () => {
    expect(resolveDaySelection({ current: { start: '2026-08-28', end: null }, tapped: '2026-08-28', today: TODAY }))
      .toEqual({ start: '2026-08-28', end: null });
  });

  // submitMark issues one request per day, so an unbounded range would fire
  // hundreds of sequential writes.
  it('clamps an over-long range instead of accepting it', () => {
    const result = resolveDaySelection({
      current: { start: TODAY, end: null },
      tapped: '2028-08-26',
      today: TODAY,
    });
    expect(selectedDays(result, TODAY)).toHaveLength(MAX_ABSENCE_RANGE_DAYS);
  });
});

describe('selectedDays', () => {
  it('returns the single start day when no range is set', () => {
    expect(selectedDays({ start: '2026-08-28', end: null }, TODAY)).toEqual(['2026-08-28']);
  });

  it('falls back when nothing is selected at all', () => {
    expect(selectedDays({ start: null, end: null }, TODAY)).toEqual([TODAY]);
  });

  it('expands a range inclusively', () => {
    expect(selectedDays({ start: '2026-08-26', end: '2026-08-28' }, TODAY))
      .toEqual(['2026-08-26', '2026-08-27', '2026-08-28']);
  });
});
