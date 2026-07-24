import { describe, it, expect } from '@jest/globals';
import { parseBackoffScheduleMs } from '../modules/notifications/outbox-backoff.js';

// The backoff schedule is the only non-trivial parsing in the Platform Worker
// config (ADR-029 §6): OUTBOX_BACKOFF_SCHEDULE_MS is a comma-separated ms list
// whose length also sets the retry count. env.ts wraps this pure parser inside
// its zod transform; the poll-interval / batch-size / timeout knobs are plain
// z.coerce.number defaults and need no bespoke coverage. env.ts itself cannot be
// imported under ts-jest (import.meta), so the parser is tested directly here.
describe('parseBackoffScheduleMs (OUTBOX_BACKOFF_SCHEDULE_MS, ADR-029 §6)', () => {
  it('parses the documented default into 1m/5m/15m/1h', () => {
    expect(parseBackoffScheduleMs('60000,300000,900000,3600000')).toEqual([
      60_000, 300_000, 900_000, 3_600_000,
    ]);
  });

  it('trims whitespace around entries', () => {
    expect(parseBackoffScheduleMs('1000, 2000 ,3000')).toEqual([1000, 2000, 3000]);
  });

  it('accepts a single-entry schedule', () => {
    expect(parseBackoffScheduleMs('5000')).toEqual([5000]);
  });

  it('fails closed on an empty schedule', () => {
    expect(() => parseBackoffScheduleMs('   ')).toThrow(/at least one delay/);
    expect(() => parseBackoffScheduleMs('')).toThrow(/at least one delay/);
  });

  it('fails closed on a non-positive or non-integer delay', () => {
    expect(() => parseBackoffScheduleMs('1000,-5')).toThrow(/positive integer/);
    expect(() => parseBackoffScheduleMs('1000,0')).toThrow(/positive integer/);
    expect(() => parseBackoffScheduleMs('1000,abc')).toThrow(/positive integer/);
    expect(() => parseBackoffScheduleMs('1.5')).toThrow(/positive integer/);
  });
});
