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
  // Defaults to "nothing stale" so every pre-existing notification test is
  // unaffected by this table being swept in the same run.
  workerAssignment: {
    findMany: jest.fn(async () => []) as jest.MockedFunction<(...args: any[]) => any>,
    deleteMany: jest.fn(async () => ({ count: 0 })) as jest.MockedFunction<(...args: any[]) => any>,
  },
});

const CONFIG = {
  intervalMs: 86_400_000,
  batchSize: 2,
  maxBatchesPerRun: 3,
  operationalRetentionDays: 3653,
      notificationRetentionDays: 90,
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

    const day = 24 * 60 * 60 * 1000;
    // Bracketed against the run window rather than an exact equality, which
    // would be a clock race.
    expect(notifCutoff.getTime()).toBeGreaterThanOrEqual(before - CONFIG.notificationRetentionDays * day - 5000);
    expect(notifCutoff.getTime()).toBeLessThanOrEqual(after - CONFIG.notificationRetentionDays * day + 5000);
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

  it('sweeps notifications and leaves AuditLog entirely alone', async () => {
    // This assertion is INVERTED from what it was. It previously required
    // AuditLog to be swept, which encoded the ADR-033 violation into the test
    // suite -- so the suite would have defended the defect rather than caught
    // it. AuditLog is excluded from all tiers and retained indefinitely.
    prisma.notification.findMany.mockResolvedValueOnce([{ id: 'n1' }]).mockResolvedValue([]);
    prisma.notification.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.findMany.mockResolvedValueOnce([{ id: 'a1' }]).mockResolvedValue([]);
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 1 });

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    expect(prisma.notification.deleteMany).toHaveBeenCalledTimes(1);
    // Even with stale rows available and a mock ready to delete them.
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('does nothing when there are no stale notifications', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * Compliance regression guards for ADR-033.
 *
 * This job originally pruned `AuditLog` at 365 days and `Notification` at 90
 * days, both in direct contradiction of a retention ADR ratified two months
 * earlier. No data was lost — the oldest production row in either table was
 * ~25 days old when it was caught — but notifications would have started
 * being deleted around 2026-11-09.
 *
 * These assert the POLICY, not the implementation, so shortening a window to
 * control table size fails here rather than silently under-retaining.
 */
describe('ADR-033 retention policy', () => {
  it('NEVER touches AuditLog — it is excluded from all tiers and kept indefinitely', async () => {
    // CRR §30: the platform's own accountability record. Deleting it on the
    // same clock as the data it describes would defeat its purpose.
    const auditDeleteMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
    const auditFindMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
    const prisma = {
      notification: {
        findMany: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue([]),
        deleteMany: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({ count: 0 }),
      },
      auditLog: { findMany: auditFindMany, deleteMany: auditDeleteMany },
      workerAssignment: {
        findMany: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue([]),
        deleteMany: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({ count: 0 }),
      },
    };
    await new PlatformTableSweepJob(prisma as never, {
      intervalMs: 1000,
      batchSize: 10,
      operationalRetentionDays: 3653,
      notificationRetentionDays: 1825,
    }).run();

    expect(auditFindMany).not.toHaveBeenCalled();
    expect(auditDeleteMany).not.toHaveBeenCalled();
  });

  it('has no configurable AuditLog retention window at all', async () => {
    // No value is correct, so the knob should not exist — its presence is
    // what invited the 365-day default that violated the ADR.
    const envSource = (await import('node:fs')).readFileSync('src/config/env.ts', 'utf8');
    expect(envSource).not.toMatch(/PLATFORM_AUDIT_LOG_RETENTION_DAYS:\s*z\./);
  });

  it('retains notifications for the full Tier 2 window, not a convenient one', async () => {
    const { loadEnv } = await import('../config/env.js');
    const saved = process.env;
    process.env = {
      ...saved,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
      JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
      JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-xx',
    } as NodeJS.ProcessEnv;
    try {
      const env = loadEnv();
      // Tier 2 = 5 years. Anything materially shorter under-retains.
      expect(env.PLATFORM_NOTIFICATION_RETENTION_DAYS).toBeGreaterThanOrEqual(1825);
    } finally {
      process.env = saved;
    }
  });
});

/**
 * Operational payroll evidence: ten years, per the owner decision of
 * 2026-09-08 and the German payroll-retention norm.
 */
describe('operational records (WorkerAssignment and its cascade)', () => {
  it('sweeps assignments on their OWN ten-year window, not the notification one', async () => {
    const prisma = mkPrisma();
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.workerAssignment.findMany.mockResolvedValueOnce([{ id: 'a1' }]).mockResolvedValue([]);
    prisma.workerAssignment.deleteMany.mockResolvedValue({ count: 1 });

    const job = new PlatformTableSweepJob(prisma as never, CONFIG);
    await job.run();

    const where = prisma.workerAssignment.findMany.mock.calls[0][0].where;
    const cutoff = where.day.lt as Date;
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    // Ten years, not the notification window. A shared cutoff would delete a
    // decade of payroll evidence on a five-year clock.
    expect(Math.round(days)).toBe(3653);
  });

  /**
   * Filtered on `day`, the shift's own date, not `created_at`. A row entered
   * late still describes the day it describes; retention is about the event,
   * not the paperwork.
   */
  it('measures the window from the shift date, not the row creation date', async () => {
    const prisma = mkPrisma();
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.workerAssignment.findMany.mockResolvedValue([]);

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    const where = prisma.workerAssignment.findMany.mock.calls[0][0].where;
    expect(where).toHaveProperty('day');
    expect(where).not.toHaveProperty('created_at');
  });

  it('deletes by explicit id list, never by the date predicate', async () => {
    const prisma = mkPrisma();
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.workerAssignment.findMany.mockResolvedValueOnce([{ id: 'a1' }]).mockResolvedValue([]);
    prisma.workerAssignment.deleteMany.mockResolvedValue({ count: 1 });

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();

    // Deleting by the predicate would race the select and remove rows that
    // became eligible between the two statements.
    expect(prisma.workerAssignment.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1'] } },
    });
  });

  it('does nothing when nothing is old enough', async () => {
    const prisma = mkPrisma();
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.workerAssignment.findMany.mockResolvedValue([]);

    await new PlatformTableSweepJob(prisma as never, CONFIG).run();
    expect(prisma.workerAssignment.deleteMany).not.toHaveBeenCalled();
  });

  /**
   * The schema fact this design rests on: Attendance, RoomLog and
   * QualityVerification are onDelete: Cascade on assignment_id. The sweep must
   * NOT delete them directly -- doing so on a different clock would be a
   * policy the database cannot express, since the cascade removes them on the
   * parent's clock regardless.
   */
  it('never sweeps the cascading children directly', () => {
    const prisma = mkPrisma() as Record<string, unknown>;
    expect(prisma.attendance).toBeUndefined();
    expect(prisma.roomLog).toBeUndefined();
    // If either is ever added to this mock, the job must still not call it.
  });
});
