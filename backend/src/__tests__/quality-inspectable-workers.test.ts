import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const findMany = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({ workerAssignment: { findMany } }),
}));

import { QualityService } from '../modules/quality/service.js';

/**
 * ADR-072 §2.5 — the worker picker behind "Start checking".
 *
 * The interesting part is not that it lists assignments; it is WHOSE. A
 * checker's JWT carries no `scope` claim (resolveScope mints one only for
 * admin/RM/manager), so a scope-claim gate here would return nothing for every
 * checker. Reach is instead resolved from the checker's own assignments that
 * day — the same definition assertCanViewVerification already uses.
 */
describe('listInspectableWorkers', () => {
  const service = new QualityService();
  const checker = { userId: 'c1', role: 'checker', scope: null };

  beforeEach(() => {
    findMany.mockReset();
  });

  it('returns nothing when the checker has no shift today — no shift, no reach', async () => {
    findMany.mockResolvedValueOnce([]); // the checker's own assignments

    const result = await service.listInspectableWorkers(checker, '2026-08-27');

    expect(result).toEqual({ day: '2026-08-27', workers: [] });
    // The second query is never issued: there is no hotel to ask about.
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("scopes the worker query to the hotels the checker is working that day", async () => {
    findMany
      .mockResolvedValueOnce([{ hotel_id: 'h1' }, { hotel_id: 'h2' }, { hotel_id: 'h1' }])
      .mockResolvedValueOnce([]);

    await service.listInspectableWorkers(checker, '2026-08-27');

    const where = findMany.mock.calls[1][0].where;
    // De-duplicated: h1 appeared twice above.
    expect(where.hotel_id).toEqual({ in: ['h1', 'h2'] });
  });

  it('excludes rework assignments and the checker themselves', async () => {
    findMany.mockResolvedValueOnce([{ hotel_id: 'h1' }]).mockResolvedValueOnce([]);

    await service.listInspectableWorkers(checker, '2026-08-27');

    const where = findMany.mock.calls[1][0].where;
    // Rework is corrective work on a shift already inspected — offering it
    // would list the same worker twice for one day's work.
    expect(where.rework_of_assignment_id).toBeNull();
    expect(where.worker_id).toEqual({ not: 'c1' });
  });

  it('does not filter on check-in state', async () => {
    findMany.mockResolvedValueOnce([{ hotel_id: 'h1' }]).mockResolvedValueOnce([]);

    await service.listInspectableWorkers(checker, '2026-08-27');

    // Deliberate (ADR-072 §2.5): a checker may need to inspect, or record the
    // absence of, work by someone whose attendance is missing.
    expect(JSON.stringify(findMany.mock.calls[1][0].where)).not.toContain('attendance');
  });

  it('flattens the row into a pickable worker', async () => {
    findMany.mockResolvedValueOnce([{ hotel_id: 'h1' }]).mockResolvedValueOnce([
      {
        id: 'asg1',
        worker_id: 'w1',
        hotel_id: 'h1',
        status: 'CONFIRMED',
        worker: { first_name: 'Ada', last_name: 'Lovelace', role: 'WORKER' },
        hotel: { name: 'Hotel One' },
      },
    ]);

    const result = await service.listInspectableWorkers(checker, '2026-08-27');

    expect(result.workers).toEqual([
      {
        assignment_id: 'asg1',
        worker_id: 'w1',
        worker_name: 'Ada Lovelace',
        hotel_id: 'h1',
        hotel_name: 'Hotel One',
        status: 'CONFIRMED',
      },
    ]);
  });

  it('gives a null name rather than a half-built string when the worker no longer resolves', async () => {
    findMany.mockResolvedValueOnce([{ hotel_id: 'h1' }]).mockResolvedValueOnce([
      { id: 'asg1', worker_id: 'w1', hotel_id: 'h1', status: 'CONFIRMED', worker: null, hotel: null },
    ]);

    const result = await service.listInspectableWorkers(checker, '2026-08-27');

    // The checker app already had a defect where a missing name rendered as a
    // cuid tail; null is what the client can detect and label.
    expect(result.workers[0].worker_name).toBeNull();
    expect(result.workers[0].hotel_name).toBeNull();
  });

  it('does not restrict an admin to their own hotels', async () => {
    findMany.mockResolvedValueOnce([]);

    await service.listInspectableWorkers({ userId: 'a1', role: 'admin', scope: null }, '2026-08-27');

    // One query only — admin skips the own-assignments lookup entirely.
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.hotel_id).toBeUndefined();
  });
});
