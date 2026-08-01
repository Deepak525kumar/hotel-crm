import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN), PR 3 of 5: the RetentionLog
 * sweep (REQ-RETENTION-016/017/018, RULE-RETENTION-04/05/06). Mirrors
 * geo-retention-sweep-job.test.ts's structure and boundary-pinning rigor.
 *
 * Scope: sweeps only RetentionLog rows. The spec's own "Permitted writes"
 * clause already contemplates the sweep deleting from a consuming module's
 * data store (a delegated-execution permission granted by registration,
 * RULE-RETENTION-02) -- what's actually still open is OD-RETENTION-10,
 * this module's own authorization MECHANISM to call into that delete path.
 * No such mechanism exists yet, so this job never reaches into a consuming
 * module's own data store; see sweep-job.ts's header comment for the full
 * disclosure.
 */

const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));

import { RetentionSweepJob } from '../modules/retention/sweep-job.js';

function makePrisma() {
  const retentionLog = {
    findMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    deleteMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
  };
  const retentionAuditEntry = {
    createMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
  };
  const retentionCategory = {
    findMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
  };
  const prisma: any = {
    retentionLog,
    retentionAuditEntry,
    retentionCategory,
    $transaction: jest.fn(async (cb: any) => cb(prisma)) as jest.MockedFunction<(...args: any[]) => any>,
  };
  return prisma;
}

const CONFIG = { intervalMs: 86400000, batchSize: 2 };

function makeCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat1',
    module_id: 'attendance',
    category_id: 'shift_coordinate',
    tier: 'TIER_1',
    ...overrides,
  };
}

describe('RetentionSweepJob (SPEC-RETENTION-001, PR 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers under the expected job name and interval', () => {
    const prisma = makePrisma();
    const job = new RetentionSweepJob(prisma, CONFIG);

    expect(job.name).toBe('retention-sweep');
    expect(job.intervalMs).toBe(86400000);
  });

  it('logs a no-op run when no categories are registered', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([]);

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionLog.findMany).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('retention_sweep_completed', {
      categories_swept: 0,
      records_deleted: 0,
    });
  });

  it('deletes eligible RetentionLog rows for a registered category and writes one audit entry per row', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([{ id: 'log1' }]).mockResolvedValueOnce([]);
    prisma.retentionLog.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category_id: 'cat1', deleted_at: null, tagged_at: { lt: expect.any(Date) } },
        take: 2,
      })
    );
    expect(prisma.retentionLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['log1'] } } });
    expect(prisma.retentionAuditEntry.createMany).toHaveBeenCalledWith({
      data: [{ module_id: 'attendance', category_id: 'shift_coordinate', tier: 'TIER_1', deleted_at: expect.any(Date) }],
    });
    expect(mockLogger.info).toHaveBeenCalledWith('retention_sweep_completed', {
      categories_swept: 1,
      records_deleted: 1,
    });
  });

  it('never touches deleted_at (RetentionLog rows already deleted are excluded from the eligibility query)', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([]);

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deleted_at: null }) })
    );
  });

  it('RULE-RETENTION-05: performs a hard delete, not a soft flag', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([{ id: 'log1' }]).mockResolvedValueOnce([]);
    prisma.retentionLog.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionLog.deleteMany).toHaveBeenCalled();
  });

  it('RULE-RETENTION-06: deletion and audit-entry write happen inside the same transaction', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([{ id: 'log1' }]).mockResolvedValueOnce([]);
    prisma.retentionLog.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('review fix (concurrency): writes audit entries matching deleteMany\'s actual count, not the pre-read batch size', async () => {
    // Simulates a losing race: this run reads 2 eligible ids, but by the
    // time its deleteMany executes, a concurrent run already deleted one
    // of them (e.g. an overlapping sweep tick, OD-RETENTION-07). deleteMany
    // is idempotent on missing ids, so it reports count: 1, not 2 -- the
    // audit write must reflect the real 1, never a phantom 2.
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany
      .mockResolvedValueOnce([{ id: 'log1' }, { id: 'log2' }])
      .mockResolvedValueOnce([]);
    prisma.retentionLog.deleteMany.mockResolvedValueOnce({ count: 1 }); // only 1 of 2 actually deleted

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionAuditEntry.createMany).toHaveBeenCalledWith({
      data: [{ module_id: 'attendance', category_id: 'shift_coordinate', tier: 'TIER_1', deleted_at: expect.any(Date) }],
    });
    expect(mockLogger.info).toHaveBeenCalledWith('retention_sweep_completed', {
      categories_swept: 1,
      records_deleted: 1,
    });
  });

  it('review fix (concurrency): writes no audit entry when deleteMany affects zero rows (the batch was already deleted by another run)', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([{ id: 'log1' }]);
    prisma.retentionLog.deleteMany.mockResolvedValueOnce({ count: 0 }); // lost the race entirely

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionAuditEntry.createMany).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('retention_sweep_completed', {
      categories_swept: 1,
      records_deleted: 0,
    });
  });

  it('the audit entry never carries the deleted record_ref or any RetentionLog field beyond category/tier/timestamp', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory({ tier: 'TIER_3' })]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([{ id: 'log1' }]).mockResolvedValueOnce([]);
    prisma.retentionLog.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    const call = prisma.retentionAuditEntry.createMany.mock.calls[0][0] as { data: Record<string, unknown>[] };
    expect(Object.keys(call.data[0]).sort()).toEqual(
      ['category_id', 'deleted_at', 'module_id', 'tier'].sort()
    );
  });

  it('computes each category cutoff from its own tier window (TIER_1: 6 months)', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory({ tier: 'TIER_1' })]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([]);

    const before = new Date();
    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();
    const after = new Date();

    const cutoffArg = (prisma.retentionLog.findMany.mock.calls[0][0] as {
      where: { tagged_at: { lt: Date } };
    }).where.tagged_at.lt;

    const expectedBefore = new Date(before);
    expectedBefore.setMonth(expectedBefore.getMonth() - 6);
    const expectedAfter = new Date(after);
    expectedAfter.setMonth(expectedAfter.getMonth() - 6);

    expect(cutoffArg.getTime()).toBeGreaterThanOrEqual(expectedBefore.getTime());
    expect(cutoffArg.getTime()).toBeLessThanOrEqual(expectedAfter.getTime());
  });

  it('computes each category cutoff from its own tier window (TIER_2: 5 years)', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory({ tier: 'TIER_2' })]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([]);

    const before = new Date();
    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();
    const after = new Date();

    const cutoffArg = (prisma.retentionLog.findMany.mock.calls[0][0] as {
      where: { tagged_at: { lt: Date } };
    }).where.tagged_at.lt;

    const expectedBefore = new Date(before);
    expectedBefore.setFullYear(expectedBefore.getFullYear() - 5);
    const expectedAfter = new Date(after);
    expectedAfter.setFullYear(expectedAfter.getFullYear() - 5);

    expect(cutoffArg.getTime()).toBeGreaterThanOrEqual(expectedBefore.getTime());
    expect(cutoffArg.getTime()).toBeLessThanOrEqual(expectedAfter.getTime());
  });

  it('computes each category cutoff from its own tier window (TIER_3: 6 years)', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory({ tier: 'TIER_3' })]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([]);

    const before = new Date();
    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();
    const after = new Date();

    const cutoffArg = (prisma.retentionLog.findMany.mock.calls[0][0] as {
      where: { tagged_at: { lt: Date } };
    }).where.tagged_at.lt;

    const expectedBefore = new Date(before);
    expectedBefore.setFullYear(expectedBefore.getFullYear() - 6);
    const expectedAfter = new Date(after);
    expectedAfter.setFullYear(expectedAfter.getFullYear() - 6);

    expect(cutoffArg.getTime()).toBeGreaterThanOrEqual(expectedBefore.getTime());
    expect(cutoffArg.getTime()).toBeLessThanOrEqual(expectedAfter.getTime());
  });

  it('review fix (TIER_1, 6 months): a record just inside the tier window survives; one just outside is selected for deletion', async () => {
    // Mirrors geo-retention-sweep-job.test.ts's own boundary-pinning review
    // fix: pins the cutoff arithmetic itself, not just a loose tolerance
    // window, so a future change to computeCutoff's formula is caught here.
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory({ tier: 'TIER_1' })]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([]);

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    const cutoff = (prisma.retentionLog.findMany.mock.calls[0][0] as {
      where: { tagged_at: { lt: Date } };
    }).where.tagged_at.lt;

    const justInside = new Date(cutoff);
    justInside.setDate(justInside.getDate() + 1); // 6 months minus 1 day old
    const justOutside = new Date(cutoff);
    justOutside.setDate(justOutside.getDate() - 1); // 6 months plus 1 day old

    // where: { tagged_at: { lt: cutoff } } -- strictly before cutoff is eligible.
    expect(justInside.getTime()).toBeGreaterThan(cutoff.getTime()); // survives
    expect(justOutside.getTime()).toBeLessThan(cutoff.getTime()); // eligible
  });

  it('review fix (TIER_2, 5 years): a record just inside the tier window survives; one just outside is selected for deletion', async () => {
    // Same boundary-pinning rigor as the TIER_1 case above, for the
    // setFullYear()-based branch of computeCutoff (years, not months).
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory({ tier: 'TIER_2' })]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([]);

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    const cutoff = (prisma.retentionLog.findMany.mock.calls[0][0] as {
      where: { tagged_at: { lt: Date } };
    }).where.tagged_at.lt;

    const justInside = new Date(cutoff);
    justInside.setDate(justInside.getDate() + 1); // 5 years minus 1 day old
    const justOutside = new Date(cutoff);
    justOutside.setDate(justOutside.getDate() - 1); // 5 years plus 1 day old

    expect(justInside.getTime()).toBeGreaterThan(cutoff.getTime()); // survives
    expect(justOutside.getTime()).toBeLessThan(cutoff.getTime()); // eligible
  });

  it('review fix (TIER_3, 6 years): a record just inside the tier window survives; one just outside is selected for deletion', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory({ tier: 'TIER_3' })]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([]);

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    const cutoff = (prisma.retentionLog.findMany.mock.calls[0][0] as {
      where: { tagged_at: { lt: Date } };
    }).where.tagged_at.lt;

    const justInside = new Date(cutoff);
    justInside.setDate(justInside.getDate() + 1); // 6 years minus 1 day old
    const justOutside = new Date(cutoff);
    justOutside.setDate(justOutside.getDate() - 1); // 6 years plus 1 day old

    expect(justInside.getTime()).toBeGreaterThan(cutoff.getTime()); // survives
    expect(justOutside.getTime()).toBeLessThan(cutoff.getTime()); // eligible
  });

  it('batches deletion across multiple pages when one category backlog exceeds one batch', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany
      .mockResolvedValueOnce([{ id: 'log1' }, { id: 'log2' }])
      .mockResolvedValueOnce([{ id: 'log3' }, { id: 'log4' }])
      .mockResolvedValueOnce([]);
    prisma.retentionLog.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 2 });

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionLog.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.retentionLog.deleteMany).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'retention_sweep_completed',
      expect.objectContaining({ records_deleted: 4 })
    );
  });

  it('a short page (fewer rows than batchSize) stops that category loop without an extra query', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany.mockResolvedValueOnce([{ id: 'log1' }]); // 1 < batchSize(2)
    prisma.retentionLog.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('respects maxBatchesPerRun as a hard cap per category even if more rows remain', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([makeCategory()]);
    prisma.retentionLog.findMany.mockResolvedValue([{ id: 'log1' }, { id: 'log2' }]);
    prisma.retentionLog.deleteMany.mockResolvedValue({ count: 2 });

    const job = new RetentionSweepJob(prisma, { ...CONFIG, maxBatchesPerRun: 3 });
    await job.run();

    expect(prisma.retentionLog.findMany).toHaveBeenCalledTimes(3);
  });

  it('sweeps every registered category independently, each with its own cutoff', async () => {
    const prisma = makePrisma();
    prisma.retentionCategory.findMany.mockResolvedValueOnce([
      makeCategory({ id: 'cat1', module_id: 'attendance', category_id: 'shift_coordinate', tier: 'TIER_1' }),
      makeCategory({ id: 'cat2', module_id: 'hr', category_id: 'payroll_iban', tier: 'TIER_3' }),
    ]);
    // Each page returns fewer rows than batchSize(2), so each category's
    // loop stops after its single page -- one findMany call per category.
    prisma.retentionLog.findMany
      .mockResolvedValueOnce([{ id: 'log1' }]) // cat1's only page
      .mockResolvedValueOnce([{ id: 'log2' }]); // cat2's only page
    prisma.retentionLog.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const job = new RetentionSweepJob(prisma, CONFIG);
    await job.run();

    expect(prisma.retentionLog.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ category_id: 'cat1' }) })
    );
    expect(prisma.retentionLog.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ category_id: 'cat2' }) })
    );
    expect(mockLogger.info).toHaveBeenCalledWith('retention_sweep_completed', {
      categories_swept: 2,
      records_deleted: 2,
    });
  });
});
