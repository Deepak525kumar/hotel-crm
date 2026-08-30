import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * The 3-day rework write-off (owner decision, 2026-08-30).
 *
 * Rework raised against a finished shift waits for the worker to check in
 * before its clock starts. That is right, but it means a worker who never
 * comes back leaves the room waiting forever with no timer and nobody told.
 *
 * The properties asserted here are the ones that make giving up safe: it says
 * the room was NOT fixed rather than quietly closing it as done, it cannot
 * cancel work someone just completed, and it fires once.
 */

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockEnqueue = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/notifications/service.js', () => ({
  notificationService: { enqueue: (...a: unknown[]) => mockEnqueue(...a) },
}));

import { ReworkExpiryJob, REWORK_EXPIRY_MS } from '../modules/quality/rework-expiry-job.js';

const staleRound = {
  id: 'round1',
  round_number: 2,
  assignment_id: 'rework-shift-1',
  verification: {
    id: 'v1',
    hotel_id: 'h1',
    verified_by_id: 'checker1',
    room_number: '412',
    worker_id: 'w1',
    hotel: { manager_user_id: 'mgr1' },
  },
};

function makePrisma(rows: any[], claimCount = 1) {
  const findMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  findMany.mockResolvedValue(rows);
  const roundUpdateMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  roundUpdateMany.mockResolvedValue({ count: claimCount });
  const assignmentUpdateMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  assignmentUpdateMany.mockResolvedValue({ count: 1 });
  return {
    prisma: {
      reworkRound: { findMany },
      $transaction: (fn: any) =>
        fn({
          reworkRound: { updateMany: roundUpdateMany },
          workerAssignment: { updateMany: assignmentUpdateMany },
        }),
    } as any,
    findMany,
    roundUpdateMany,
    assignmentUpdateMany,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueue.mockResolvedValue(undefined);
});

describe('REWORK_EXPIRY_MS', () => {
  it('is the three days the owner asked for', () => {
    expect(REWORK_EXPIRY_MS).toBe(3 * 24 * 60 * 60 * 1000);
  });
});

describe('ReworkExpiryJob', () => {
  it('measures the three days from ASSIGNMENT, not from the clock', async () => {
    // A deferred round has no timer at all. Measuring from timer_started_at
    // would mean it could never expire -- which is precisely the case this job
    // exists for. The three days are about how long the room has waited.
    const { prisma, findMany } = makePrisma([staleRound]);
    await new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run();

    const where = findMany.mock.calls[0][0].where;
    expect(where.assigned_at.lte).toBeInstanceOf(Date);
    expect(where.timer_started_at).toBeUndefined();
    expect(where.completed_at).toBeNull();
    expect(where.cancelled_at).toBeNull();
  });

  it('cancels WITHOUT marking it completed', async () => {
    // The distinction the whole feature rests on: the room was never fixed.
    // Writing completed_at would tell analytics, the checker and the worker
    // that it was.
    const { prisma, roundUpdateMany } = makePrisma([staleRound]);
    await new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run();

    const data = roundUpdateMany.mock.calls[0][0].data;
    expect(data.cancelled_at).toBeInstanceOf(Date);
    expect(data.cancellation_reason).toBe('Rework not completed for 3 days');
    expect(data.completed_at).toBeUndefined();
  });

  it('re-checks completion in the claim, so a just-finished rework survives', async () => {
    // The select and the claim are separated by the batch loop. A worker can
    // finish in between, and cancelling then would erase a fix that happened.
    const { prisma, roundUpdateMany } = makePrisma([staleRound]);
    await new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run();

    expect(roundUpdateMany.mock.calls[0][0].where).toMatchObject({
      id: 'round1',
      completed_at: null,
      cancelled_at: null,
    });
  });

  it('sends nothing when another process already cancelled it', async () => {
    const { prisma } = makePrisma([staleRound], 0);
    await new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('takes the shift off the schedule, but never rewrites a COMPLETED one', async () => {
    const { prisma, assignmentUpdateMany } = makePrisma([staleRound]);
    await new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run();

    const call = assignmentUpdateMany.mock.calls[0][0];
    expect(call.data.status).toBe('CANCELLED');
    expect(call.where.status).toEqual({ not: 'COMPLETED' });
  });

  it('tells the checker, the manager AND the worker', async () => {
    // The worker is on this list because cancelling takes a shift off their
    // schedule. Without telling them, assigned work simply disappears -- which
    // reads as the app losing it rather than as a decision someone made.
    const { prisma } = makePrisma([staleRound]);
    await new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run();

    const recipients = mockEnqueue.mock.calls.map((c: any[]) => c[0].recipientId);
    expect(new Set(recipients)).toEqual(new Set(['checker1', 'mgr1', 'w1']));
    expect(mockEnqueue.mock.calls[0][0].message).toContain('3 days');
  });

  it('does not notify the same person twice when the checker IS the manager', async () => {
    const row = {
      ...staleRound,
      verification: { ...staleRound.verification, hotel: { manager_user_id: 'checker1' } },
    };
    const { prisma } = makePrisma([row]);
    await new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run();
    // Checker and manager collapse to one; the worker is still told.
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  it('still notifies the checker when the hotel has no manager', async () => {
    const row = {
      ...staleRound,
      verification: { ...staleRound.verification, hotel: { manager_user_id: null } },
    };
    const { prisma } = makePrisma([row]);
    await new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run();
    // A missing manager is skipped, not fatal: the checker and the worker are
    // still told.
    const recipients = mockEnqueue.mock.calls.map((c: any[]) => c[0].recipientId);
    expect(new Set(recipients)).toEqual(new Set(['checker1', 'w1']));
  });

  it('one failing round does not abort the batch', async () => {
    // A failed transaction leaves cancelled_at null, so the next tick retries
    // it -- but only if the batch did not stop on it.
    const second = { ...staleRound, id: 'round2' };
    const { prisma } = makePrisma([staleRound, second]);
    let first = true;
    prisma.$transaction = (fn: any) => {
      if (first) {
        first = false;
        return Promise.reject(new Error('deadlock'));
      }
      return fn({
        reworkRound: { updateMany: async () => ({ count: 1 }) },
        workerAssignment: { updateMany: async () => ({ count: 1 }) },
      });
    };

    await expect(new ReworkExpiryJob(prisma, { intervalMs: 1000 }).run()).resolves.toBeUndefined();
    const ids = mockEnqueue.mock.calls.map((c: any[]) => c[0].data.rework_round_id);
    expect(ids).toContain('round2');
  });
});
