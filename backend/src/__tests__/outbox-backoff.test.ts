import { describe, it, expect } from '@jest/globals';
import { computeBackoff } from '../modules/notifications/outbox-backoff.js';

// ADR-029 §6: default schedule 1m/5m/15m/1h, then dead-letter.
const SCHEDULE = [60_000, 300_000, 900_000, 3_600_000];
const NOW = new Date('2026-07-24T00:00:00.000Z');

describe('computeBackoff (ADR-029 §6 exponential backoff)', () => {
  it('schedules the first retry after schedule[0] following the first failure', () => {
    const outcome = computeBackoff(1, SCHEDULE, NOW);
    expect(outcome.deadLetter).toBe(false);
    expect(outcome.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it('walks the schedule for each subsequent failure', () => {
    expect(computeBackoff(2, SCHEDULE, NOW).nextAttemptAt).toEqual(new Date(NOW.getTime() + 300_000));
    expect(computeBackoff(3, SCHEDULE, NOW).nextAttemptAt).toEqual(new Date(NOW.getTime() + 900_000));
    expect(computeBackoff(4, SCHEDULE, NOW).nextAttemptAt).toEqual(new Date(NOW.getTime() + 3_600_000));
  });

  it('dead-letters once attempts exceed the schedule length', () => {
    const outcome = computeBackoff(5, SCHEDULE, NOW);
    expect(outcome.deadLetter).toBe(true);
    expect(outcome.nextAttemptAt).toBeUndefined();
  });

  it('honors a shorter custom schedule (retry count follows schedule length)', () => {
    const short = [1000];
    expect(computeBackoff(1, short, NOW).nextAttemptAt).toEqual(new Date(NOW.getTime() + 1000));
    expect(computeBackoff(2, short, NOW).deadLetter).toBe(true);
  });
});
