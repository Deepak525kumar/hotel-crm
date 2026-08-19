import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';

// CRR §14 rework loop + ADR-069 (rework is a NEW linked assignment).
//
// The escalation job is tested here too, because its idempotence is the part
// most likely to regress: the scheduler re-runs every tick, so a missing claim
// would re-notify the manager and checker forever rather than once.

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockEnqueue = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/notifications/service.js', () => ({
  notificationService: { enqueue: (...a: unknown[]) => mockEnqueue(...a) },
}));

import { ReworkEscalationJob, REWORK_DEADLINE_MS } from '../modules/quality/rework-escalation-job.js';

describe('REWORK_DEADLINE_MS', () => {
  it('is the 20 minutes CRR §14 specifies', () => {
    expect(REWORK_DEADLINE_MS).toBe(20 * 60 * 1000);
  });
});

function makePrisma(overdue: any[]) {
  const updateMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  updateMany.mockResolvedValue({ count: 1 });
  const findMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  findMany.mockResolvedValue(overdue);
  const tx = { qualityVerification: { updateMany } };
  return {
    prisma: {
      qualityVerification: { findMany },
      $transaction: (fn: any) => fn(tx),
    } as any,
    findMany,
    updateMany,
  };
}

const overdueRow = {
  id: 'v1',
  hotel_id: 'h1',
  verified_by_id: 'checker1',
  assignment: { worker_id: 'w1', hotel_id: 'h1' },
  hotel: { manager_user_id: 'mgr1' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueue.mockResolvedValue(undefined);
});

describe('ReworkEscalationJob', () => {
  it('notifies BOTH the checker and the manager (CRR §14 says both)', async () => {
    const { prisma } = makePrisma([overdueRow]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();

    const recipients = mockEnqueue.mock.calls.map((c: any[]) => c[0].recipientId).sort();
    expect(recipients).toEqual(['checker1', 'mgr1']);
    expect(mockEnqueue.mock.calls[0][0].type).toBe('REWORK_OVERDUE');
  });

  it('claims the row before notifying, so it can escalate only once', async () => {
    const { prisma, updateMany } = makePrisma([overdueRow]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();

    // The claim is a conditional update on rework_escalated_at still being
    // null -- a compare-and-swap, not a blind write.
    const where = updateMany.mock.calls[0][0].where;
    expect(where).toEqual({ id: 'v1', rework_escalated_at: null });
    expect(updateMany.mock.calls[0][0].data.rework_escalated_at).toBeInstanceOf(Date);
  });

  it('sends NOTHING when another process already claimed the row', async () => {
    const { prisma, updateMany } = makePrisma([overdueRow]);
    updateMany.mockResolvedValue({ count: 0 }); // lost the race
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('still notifies the checker when the hotel has no manager', async () => {
    // An escalation that cannot reach one party must still reach the other.
    const { prisma } = makePrisma([{ ...overdueRow, hotel: { manager_user_id: null } }]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][0].recipientId).toBe('checker1');
  });

  it('does not notify the same person twice when checker IS the manager', async () => {
    const { prisma } = makePrisma([{ ...overdueRow, hotel: { manager_user_id: 'checker1' } }]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('only selects rework that is required, incomplete and not yet escalated', async () => {
    const { prisma, findMany } = makePrisma([]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    const where = findMany.mock.calls[0][0].where;
    expect(where.rework_required).toBe(true);
    expect(where.rework_completed_at).toBeNull();
    expect(where.rework_escalated_at).toBeNull();
    // Measured from when the worker was told, i.e. the rework assignment.
    expect(where.rework_assignments.some.confirmed_at.lte).toBeInstanceOf(Date);
  });

  it('one failing row does not abort the batch', async () => {
    const { prisma } = makePrisma([overdueRow, { ...overdueRow, id: 'v2' }]);
    mockEnqueue.mockRejectedValueOnce(new Error('boom'));
    await expect(
      new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run()
    ).resolves.toBeUndefined();
    // v2 still got its notifications after v1 threw.
    const ids = mockEnqueue.mock.calls.map((c: any[]) => c[0].data.verification_id);
    expect(ids).toContain('v2');
  });
});

// The two check-then-act races in the service. Both were real: the read that
// guards them happens outside the transaction, so two concurrent callers can
// both observe the "not yet" state. Both are now compare-and-swap claims, the
// same pattern the password-reset fix uses.
describe('rework claims are compare-and-swap, not check-then-act', () => {
  it('assignRework claims on rework_required === false', () => {
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async assignRework('), src.indexOf('async completeRework('));
    // The WHERE must constrain the prior state; a bare id would let both
    // concurrent callers win and create two rework rows -- and therefore two
    // 20-minute escalation timers for one failure.
    expect(body).toContain('rework_required: false');
    expect(body).toContain('updateMany');
    expect(body).toContain('claimed.count === 0');
  });

  it('completeRework claims on rework_completed_at === null', () => {
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async completeRework('));
    // Without this a double-tap on "mark done" notifies the checker twice and
    // appends the photos twice.
    expect(body).toContain('rework_completed_at: null');
    expect(body).toContain('updateMany');
    expect(body).toContain('claimed.count === 0');
  });

  it('the rework notification carries the notes the mobile deep link reads', () => {
    // The worker taps the push and lands on /rework/:id?notes=... -- the note
    // IS the instruction, so it must be in the payload or the screen opens
    // blank and the worker has to go hunting with a 20-minute clock running.
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async assignRework('), src.indexOf('async completeRework('));
    expect(body).toContain('rework_assignment_id: reworkAssignment.id');
    expect(body).toContain('notes: input.notes');
  });
});
