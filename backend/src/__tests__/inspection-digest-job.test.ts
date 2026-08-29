import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * The end-of-shift inspection digest (owner decision, 2026-08-30).
 *
 * A checker writes up to ~100 checks on one shift, one per room. Pushing each
 * of them is how a worker learns to turn notifications off, taking the rework
 * alerts with them. So: rework pushes immediately, everything else arrives as
 * ONE summary once the shift has gone quiet.
 *
 * The properties asserted here are the ones that make that safe rather than
 * merely working -- send-once under a re-running scheduler, no double-send
 * across two worker processes, and never summarizing a shift the checker is
 * still in the middle of.
 */

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockEnqueue = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/notifications/service.js', () => ({
  notificationService: { enqueue: (...a: unknown[]) => mockEnqueue(...a) },
}));

import { InspectionDigestJob, QUIET_PERIOD_MS } from '../modules/quality/inspection-digest-job.js';

const ago = (ms: number) => new Date(Date.now() - ms);

function makePrisma(groups: any[], rows: any[], claimCount = rows.length) {
  const groupBy = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  groupBy.mockResolvedValue(groups);
  const updateMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  updateMany.mockResolvedValue({ count: claimCount });
  const findMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  findMany.mockResolvedValue(rows);
  const tx = { qualityVerification: { updateMany, findMany } };
  return {
    prisma: {
      qualityVerification: { groupBy },
      $transaction: (fn: any) => fn(tx),
    } as any,
    groupBy,
    updateMany,
    findMany,
  };
}

const row = (score: number) => ({
  score,
  worker_id: 'w1',
  hotel_id: 'h1',
  rework_required: false,
});

const quietGroup = {
  assignment_id: 'a1',
  _max: { created_at: ago(QUIET_PERIOD_MS + 60_000) },
  _count: { _all: 3 },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('QUIET_PERIOD_MS', () => {
  it('is the interval a shift must be idle before it is summarized', () => {
    // Not a shift-status check: a checker often inspects after the worker has
    // gone home, so "the shift is COMPLETED" says nothing about whether the
    // inspection is finished. Quiet does.
    expect(QUIET_PERIOD_MS).toBe(20 * 60 * 1000);
  });
});

describe('InspectionDigestJob', () => {
  it('sends ONE push for a whole shift, not one per room', () => {
    // The entire reason this job exists.
    const { prisma } = makePrisma([quietGroup], [row(90), row(80), row(70)], 3);

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const msg = mockEnqueue.mock.calls[0][0].message as string;
      expect(msg).toContain('3 rooms');
      expect(msg).toContain('80'); // (90+80+70)/3
    });
  });

  it('excludes rework checks from the digest', () => {
    // They pushed the moment they were written. Counting them here would tell
    // the worker a second time about the one thing they already acted on.
    const { prisma, groupBy, updateMany } = makePrisma([quietGroup], [row(90)], 1);

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(groupBy.mock.calls[0][0].where).toMatchObject({ rework_required: false });
      expect(updateMany.mock.calls[0][0].where).toMatchObject({ rework_required: false });
    });
  });

  it('does not summarize a shift the checker is still inspecting', () => {
    // A check written a minute ago means the visit is in progress. Summarizing
    // now would send a digest and then need a second one moments later.
    const busy = { ...quietGroup, _max: { created_at: ago(60_000) } };
    const { prisma, updateMany } = makePrisma([busy], [row(90)]);

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(updateMany).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  it('claims the rows in the SAME transaction as the notification', () => {
    // Idempotence under a re-running scheduler. If the stamp were written
    // outside the transaction, a crash between the two would either
    // re-summarize the shift forever or lose the digest entirely.
    const { prisma, updateMany } = makePrisma([quietGroup], [row(90)], 1);

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(updateMany.mock.calls[0][0].data.digest_notified_at).toBeInstanceOf(Date);
      expect(updateMany.mock.calls[0][0].where.digest_notified_at).toBeNull();
    });
  });

  it('sends nothing when another worker process already claimed the shift', () => {
    // Two Platform Worker processes tick concurrently. The loser's updateMany
    // matches zero rows and it must fall silent rather than send a second
    // digest for the same rooms.
    const { prisma } = makePrisma([quietGroup], [row(90)], 0);

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  it('claims before it reads the rows it reports on', () => {
    // Order matters: reading first would let a check written in between
    // inflate the count in a digest that never covered it.
    const calls: string[] = [];
    const { prisma, updateMany, findMany } = makePrisma([quietGroup], [row(90)], 1);
    updateMany.mockImplementation(async () => {
      calls.push('claim');
      return { count: 1 };
    });
    findMany.mockImplementation(async () => {
      calls.push('read');
      return [row(90)];
    });

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(calls).toEqual(['claim', 'read']);
    });
  });

  it('reports the CLAIMED count, not everything it read back', () => {
    // The read-back is unfiltered by the cutoff, so a room checked after the
    // claim can appear in it. The number the worker is told must be the number
    // actually covered by this digest.
    const { prisma } = makePrisma([quietGroup], [row(90), row(80), row(70)], 2);

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(mockEnqueue.mock.calls[0][0].message).toContain('2 rooms');
    });
  });

  it('says "1 room", not "1 rooms"', () => {
    const { prisma } = makePrisma([quietGroup], [row(88)], 1);

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(mockEnqueue.mock.calls[0][0].message).toContain('1 room was');
    });
  });

  it('keeps going when one shift fails, so a bad row cannot stall the batch', () => {
    // A failed transaction leaves digest_notified_at null, so the next tick
    // retries that shift -- but only if the batch did not abort on it.
    const g2 = { ...quietGroup, assignment_id: 'a2' };
    const { prisma } = makePrisma([quietGroup, g2], [row(90)], 1);
    let first = true;
    prisma.$transaction = (fn: any) => {
      if (first) {
        first = false;
        return Promise.reject(new Error('deadlock'));
      }
      return fn({
        qualityVerification: {
          updateMany: async () => ({ count: 1 }),
          findMany: async () => [row(90)],
        },
      });
    };

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue.mock.calls[0][0].data.assignment_id).toBe('a2');
    });
  });

  it('pushes the digest — the summary is the one interruption worth making', () => {
    const { prisma } = makePrisma([quietGroup], [row(90)], 1);

    return new InspectionDigestJob(prisma, { intervalMs: 1000 }).run().then(() => {
      expect(mockEnqueue.mock.calls[0][0].transports).toEqual(['PUSH']);
      expect(mockEnqueue.mock.calls[0][0].recipientId).toBe('w1');
    });
  });
});
