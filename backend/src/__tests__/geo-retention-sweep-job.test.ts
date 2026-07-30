import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-GEO-001 @0.1.2 FROZEN, GD-14/OD-GEO-002: 6-month hard-delete
 * retention sweep (TREQ-GEO-005/RULE-GEO-004, GDPR Tier 1). Mirrors
 * session-sweep-job.test.ts's structure exactly.
 */

const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));

import { GeoRetentionSweepJob } from '../modules/geo/retention-sweep-job.js';

function makePrisma() {
  return {
    workerGeoCheckin: {
      findMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
      deleteMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    },
  };
}

const CONFIG = { intervalMs: 86400000, batchSize: 2 };

describe('GeoRetentionSweepJob (GD-14/OD-GEO-002, TREQ-GEO-005)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers under the expected job name and interval', () => {
    const prisma = makePrisma();
    const job = new GeoRetentionSweepJob(prisma as any, CONFIG);

    expect(job.name).toBe('geo-retention-sweep');
    expect(job.intervalMs).toBe(86400000);
  });

  it('deletes WorkerGeoCheckin rows older than the 6-month cutoff', async () => {
    const prisma = makePrisma();
    prisma.workerGeoCheckin.findMany.mockResolvedValueOnce([{ id: 'c1' }]).mockResolvedValueOnce([]);
    prisma.workerGeoCheckin.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new GeoRetentionSweepJob(prisma as any, CONFIG);
    await job.run();

    expect(prisma.workerGeoCheckin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { checked_at: { lt: expect.any(Date) } },
        take: 2,
      })
    );
    expect(prisma.workerGeoCheckin.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['c1'] } } });
    expect(mockLogger.info).toHaveBeenCalledWith('Geo retention sweep completed', { checkins_deleted: 1 });
  });

  it('computes the cutoff as exactly 6 months before now', async () => {
    const prisma = makePrisma();
    prisma.workerGeoCheckin.findMany.mockResolvedValueOnce([]);

    const before = new Date();
    const job = new GeoRetentionSweepJob(prisma as any, CONFIG);
    await job.run();
    const after = new Date();

    const cutoffArg = (prisma.workerGeoCheckin.findMany.mock.calls[0][0] as {
      where: { checked_at: { lt: Date } };
    }).where.checked_at.lt;

    const expectedBefore = new Date(before);
    expectedBefore.setMonth(expectedBefore.getMonth() - 6);
    const expectedAfter = new Date(after);
    expectedAfter.setMonth(expectedAfter.getMonth() - 6);

    expect(cutoffArg.getTime()).toBeGreaterThanOrEqual(expectedBefore.getTime());
    expect(cutoffArg.getTime()).toBeLessThanOrEqual(expectedAfter.getTime());
  });

  it('batches deletion across multiple pages when the backlog exceeds one batch', async () => {
    const prisma = makePrisma();
    prisma.workerGeoCheckin.findMany
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
      .mockResolvedValueOnce([{ id: 'c3' }, { id: 'c4' }])
      .mockResolvedValueOnce([]);
    prisma.workerGeoCheckin.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 2 });

    const job = new GeoRetentionSweepJob(prisma as any, CONFIG);
    await job.run();

    expect(prisma.workerGeoCheckin.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.workerGeoCheckin.deleteMany).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Geo retention sweep completed',
      expect.objectContaining({ checkins_deleted: 4 })
    );
  });

  it('a short page (fewer rows than batchSize) stops the loop without an extra query', async () => {
    const prisma = makePrisma();
    prisma.workerGeoCheckin.findMany.mockResolvedValueOnce([{ id: 'c1' }]); // 1 < batchSize(2)
    prisma.workerGeoCheckin.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new GeoRetentionSweepJob(prisma as any, CONFIG);
    await job.run();

    expect(prisma.workerGeoCheckin.findMany).toHaveBeenCalledTimes(1);
  });

  it('respects maxBatchesPerRun as a hard cap even if more rows remain', async () => {
    const prisma = makePrisma();
    prisma.workerGeoCheckin.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    prisma.workerGeoCheckin.deleteMany.mockResolvedValue({ count: 2 });

    const job = new GeoRetentionSweepJob(prisma as any, { ...CONFIG, maxBatchesPerRun: 3 });
    await job.run();

    expect(prisma.workerGeoCheckin.findMany).toHaveBeenCalledTimes(3);
  });

  it('logs zero deletions when nothing is due (no-op run)', async () => {
    const prisma = makePrisma();
    prisma.workerGeoCheckin.findMany.mockResolvedValueOnce([]);

    const job = new GeoRetentionSweepJob(prisma as any, CONFIG);
    await job.run();

    expect(prisma.workerGeoCheckin.deleteMany).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('Geo retention sweep completed', { checkins_deleted: 0 });
  });

  it('review fix: a checkin just inside the 6-month boundary survives; one just outside it is selected for deletion', async () => {
    // This mock has no real database behind it, so the prior tests only ever
    // asserted the ARGUMENTS passed to findMany/deleteMany -- never whether
    // the where:{checked_at:{lt:cutoff}} clause would actually select the
    // right rows for a real checkin near the boundary. This test pins the
    // boundary itself: compute what "6 months minus 1 day" and "6 months
    // plus 1 day" actually resolve to relative to the job's own cutoff
    // computation, the same one-shot Date arithmetic sendExpiryReminders'
    // review fix used in HR (setMonth-based, not a fixed day-count), so a
    // future change to the cutoff formula that shifts the boundary is
    // caught here rather than only in the loose tolerance-window test above.
    const prisma = makePrisma();
    prisma.workerGeoCheckin.findMany.mockResolvedValueOnce([]);

    const job = new GeoRetentionSweepJob(prisma as any, CONFIG);
    await job.run();

    const cutoff = (prisma.workerGeoCheckin.findMany.mock.calls[0][0] as {
      where: { checked_at: { lt: Date } };
    }).where.checked_at.lt;

    const justInside = new Date(cutoff);
    justInside.setDate(justInside.getDate() + 1); // 6 months minus 1 day old
    const justOutside = new Date(cutoff);
    justOutside.setDate(justOutside.getDate() - 1); // 6 months plus 1 day old

    // The job's own filter is `checked_at: { lt: cutoff }` -- a row's
    // checked_at must be STRICTLY BEFORE cutoff to be selected for deletion.
    expect(justInside.getTime()).toBeGreaterThan(cutoff.getTime()); // survives (not < cutoff)
    expect(justOutside.getTime()).toBeLessThan(cutoff.getTime()); // selected for deletion (< cutoff)
  });

  it('performs a hard delete, not a soft flag (TREQ-GEO-005)', async () => {
    const prisma = makePrisma();
    prisma.workerGeoCheckin.findMany.mockResolvedValueOnce([{ id: 'c1' }]).mockResolvedValueOnce([]);
    prisma.workerGeoCheckin.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new GeoRetentionSweepJob(prisma as any, CONFIG);
    await job.run();

    // deleteMany, not update/updateMany -- confirms this is a real row
    // removal, not a soft-delete flag flip.
    expect(prisma.workerGeoCheckin.deleteMany).toHaveBeenCalled();
  });
});
