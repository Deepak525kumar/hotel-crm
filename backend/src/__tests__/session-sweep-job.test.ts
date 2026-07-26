import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../lib/logger.js', () => ({ logger: mockLogger }));

import { SessionSweepJob } from '../modules/auth/session-sweep-job.js';

function makePrisma() {
  return {
    session: {
      findMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
      deleteMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    },
    passwordResetToken: {
      findMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
      deleteMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    },
  };
}

const CONFIG = { intervalMs: 3600000, batchSize: 2 };

describe('SessionSweepJob (ADR-031 D-5, PR-6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers under the expected job name and interval', () => {
    const prisma = makePrisma();
    const job = new SessionSweepJob(prisma as any, CONFIG);

    expect(job.name).toBe('session-sweep');
    expect(job.intervalMs).toBe(3600000);
  });

  it('deletes expired Session rows and expired/used PasswordResetToken rows', async () => {
    const prisma = makePrisma();
    prisma.session.findMany.mockResolvedValueOnce([{ id: 's1' }]).mockResolvedValueOnce([]);
    prisma.session.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.passwordResetToken.findMany.mockResolvedValueOnce([{ id: 'p1' }]).mockResolvedValueOnce([]);
    prisma.passwordResetToken.deleteMany.mockResolvedValueOnce({ count: 1 });

    const job = new SessionSweepJob(prisma as any, CONFIG);
    await job.run();

    expect(prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expires_at: { lt: expect.any(Date) } },
        take: 2,
      })
    );
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s1'] } } });

    expect(prisma.passwordResetToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ expires_at: { lt: expect.any(Date) } }, { used_at: { not: null } }] },
        take: 2,
      })
    );
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } } });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Session sweep completed',
      { sessions_deleted: 1, password_reset_tokens_deleted: 1 }
    );
  });

  it('batches deletion across multiple pages when the backlog exceeds one batch', async () => {
    const prisma = makePrisma();
    // Two full pages of 2, then an empty page — 4 total, batch size 2.
    prisma.session.findMany
      .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
      .mockResolvedValueOnce([{ id: 's3' }, { id: 's4' }])
      .mockResolvedValueOnce([]);
    prisma.session.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 2 });
    prisma.passwordResetToken.findMany.mockResolvedValue([]);

    const job = new SessionSweepJob(prisma as any, CONFIG);
    await job.run();

    expect(prisma.session.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.session.deleteMany).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Session sweep completed',
      expect.objectContaining({ sessions_deleted: 4 })
    );
  });

  it('a short page (fewer rows than batchSize) stops the loop without an extra query', async () => {
    const prisma = makePrisma();
    prisma.session.findMany.mockResolvedValueOnce([{ id: 's1' }]); // 1 < batchSize(2)
    prisma.session.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.passwordResetToken.findMany.mockResolvedValueOnce([]);

    const job = new SessionSweepJob(prisma as any, CONFIG);
    await job.run();

    expect(prisma.session.findMany).toHaveBeenCalledTimes(1);
  });

  it('respects maxBatchesPerRun as a hard cap even if more rows remain', async () => {
    const prisma = makePrisma();
    // Every page is full — would loop forever without the cap.
    prisma.session.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    prisma.session.deleteMany.mockResolvedValue({ count: 2 });
    prisma.passwordResetToken.findMany.mockResolvedValue([]);

    const job = new SessionSweepJob(prisma as any, { ...CONFIG, maxBatchesPerRun: 3 });
    await job.run();

    expect(prisma.session.findMany).toHaveBeenCalledTimes(3);
  });

  it('logs zero counts when nothing is due (no-op run)', async () => {
    const prisma = makePrisma();
    prisma.session.findMany.mockResolvedValueOnce([]);
    prisma.passwordResetToken.findMany.mockResolvedValueOnce([]);

    const job = new SessionSweepJob(prisma as any, CONFIG);
    await job.run();

    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.deleteMany).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Session sweep completed',
      { sessions_deleted: 0, password_reset_tokens_deleted: 0 }
    );
  });
});
