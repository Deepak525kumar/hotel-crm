import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Age-based pruning for Notification and AuditLog -- the two platform tables
 * that previously grew without bound (nothing deleted from either).
 *
 * These tests pin the three properties that actually matter and that a
 * refactor could silently break:
 *   1. the cutoff is derived from the CONFIGURED retention window, and the
 *      two tables use DIFFERENT windows (notifications short, audit long);
 *   2. deletion is batched by id -- never an unbounded `deleteMany` on a
 *      date predicate, which on a table that has never been pruned is
 *      exactly the query that locks it;
 *   3. the batch loop is bounded by maxBatchesPerRun, so one run cannot spin
 *      forever on a large backlog.
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

import { PlatformTableSweepJob } from '../modules/retention/platform-table-sweep-job.js';

const mkPrisma = () => ({
  notification: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  auditLog: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    deleteMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
});

const CONFIG = {
  intervalMs: 86_400_000,
  batchSize: 2,
  maxBatchesPerRun: 3,
  notificationRetentionDays: 90,
  auditLogRetentionDays: 365,
};

describe('PlatformTableSweepJob', () => {
  let prisma: ReturnType<typeof mkPrisma>;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mkPrisma();
  });

  it('derives each table cutoff from its OWN configured window, not a shared one', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);

    const before = Date.now();
    await new PlatformTableSweepJob(prisma as never, CONFIG).run();
    const after = Date.now();

    const notifCutoff = prisma.notification.findMany.mock.calls[0][0].where.created_at.lt as Date;
    const auditCutoff = prisma.auditLog.findMany.mock.calls[0][0].where.timestamp.lt as Date;

    const day = 24 * 60 * 60 * 1000;
    // Bracketed against the run window rather than an exact equality, which
    // would be a clock race.
    expect(notifCutoff.getTime()).toBeGreaterThanOrEqual(before - 90 * day - 5000);
    expect(notifCutoff.getTime()).toBeLessThanOrEqual(after - 90 * day + 5000);
    expect(auditCutoff.getTime()).toBeGreaterThanOrEqual(before - 365 * day - 5000);
    expect(auditCutoff.getTime()).toBeLessThanOrEqual(after - 365 * day + 5000);
    // The whole point of two windows: audit must be pruned less aggressively.
    expect(auditCutoff.getTime()).toBeLessThan(notifCutoff.getTime());
  });

  it('deletes by explicit id list, never by the date predicate directly', async () => {
    prisma.notification.findMany
      .mockResolvedValueOnce([{ id: 'n1' }, { id: 'n2' }])
      .mockResolvedValueOnce([]);
    prisma.notification.deleteMany.mockResolvedValue({ count: 2 });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['n1', 'n2'] } },
    });
    // An unbounded deleteMany on `created_at` is the query that locks a
    // never-pruned table; assert it is not what we issue.
    const deleteArg = prisma.notification.deleteMany.mock.calls[0][0];
    expect(deleteArg.where).not.toHaveProperty('created_at');
  });

  it('stops at maxBatchesPerRun instead of spinning on a large backlog', async () => {
    // Always returns a FULL page, so the loop only ends via the batch cap.
    prisma.notification.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    prisma.notification.deleteMany.mockResolvedValue({ count: 2 });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(3); // maxBatchesPerRun
    expect(prisma.notification.deleteMany).toHaveBeenCalledTimes(3);
  });

  it('stops early on a short page rather than issuing a pointless extra query', async () => {
    prisma.notification.findMany.mockResolvedValueOnce([{ id: 'only' }]); // < batchSize
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.findMany.mockResolvedValue([]);

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(1);
  });

  it('sweeps both tables in one run and reports both counts', async () => {
    prisma.notification.findMany.mockResolvedValueOnce([{ id: 'n1' }]).mockResolvedValue([]);
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.findMany.mockResolvedValueOnce([{ id: 'a1' }]).mockResolvedValue([]);
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 1 });

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    expect(prisma.notification.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does nothing when neither table has stale rows', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});
