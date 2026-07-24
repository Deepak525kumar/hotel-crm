import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ LOG_LEVEL: 'error' }),
}));

import { Scheduler } from '../lib/scheduler.js';

describe('Scheduler (ADR-029 §3 scheduled-job mechanism)', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  it('starts with no registered jobs (PR 7.2: mechanism only, no domain job)', () => {
    expect(scheduler.registeredJobNames()).toEqual([]);
  });

  it('rejects duplicate job names', () => {
    const job = { name: 'dup', intervalMs: 1000, run: async () => {} };
    scheduler.register(job);
    expect(() => scheduler.register(job)).toThrow(/already registered/);
  });

  it('runs a job on the first tick and not again until its interval elapses', async () => {
    const run = jest.fn(async () => {}) as jest.MockedFunction<() => Promise<void>>;
    scheduler.register({ name: 'j', intervalMs: 1000, run });

    await scheduler.tick(10_000);
    expect(run).toHaveBeenCalledTimes(1);

    await scheduler.tick(10_500); // < interval since last run
    expect(run).toHaveBeenCalledTimes(1);

    await scheduler.tick(11_000); // exactly interval elapsed
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing job — it does not abort the tick or sibling jobs', async () => {
    const bad = jest.fn(async () => {
      throw new Error('boom');
    }) as jest.MockedFunction<() => Promise<void>>;
    const good = jest.fn(async () => {}) as jest.MockedFunction<() => Promise<void>>;
    scheduler.register({ name: 'bad', intervalMs: 100, run: bad });
    scheduler.register({ name: 'good', intervalMs: 100, run: good });

    await expect(scheduler.tick(1000)).resolves.toBeUndefined();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});
