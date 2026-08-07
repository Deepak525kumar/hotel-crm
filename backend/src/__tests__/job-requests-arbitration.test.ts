import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * First-accept arbitration + "requirement fulfilled" for Epic 9 PR 9.9
 * (TREQ-004/TRULE-003, TREQ-005/TRULE-004, MIG-GAP-06).
 *
 * acceptBroadcast() claims one skill slot on a broadcast JobRequest via a
 * transactional conditional updateMany on JobRequestSkillSlot.confirmed_count
 * (ADR-057, addendum 2026-07-30: a bare confirmed_count guard is a
 * conforming instance of the ratified optimistic-concurrency mechanism for
 * this per-skill-slot grain, not a deviation requiring a separate version
 * column). On claimed.count === 0 (slot already filled), returns
 * "requirement fulfilled" instead of throwing (TREQ-005) — not an error, not
 * silence. On success, creates a WorkerAssignment directly with
 * job_request_id set and work_request_id left null (PR 9.5's disposition).
 *
 * The concurrency test below is mandatory, not deferred — the module's own
 * governance register flags the marketplace equivalent's concurrency case
 * as historically UNTESTED (FIND-BRV-006); this PR must not repeat that gap.
 * The mock's updateMany is stateful (mutates a shared row's confirmed_count
 * on every call whose WHERE predicate matches), which is what makes the
 * "second call observes the first call's effect" race scenario meaningful
 * to assert against — the same guarantee Postgres's row-level lock
 * serialization gives two genuinely concurrent transactions on the real row.
 *
 * Out of this PR's scope, not asserted here: auto-close, scheduler
 * registration (PR 9.10).
 */

const mockJobRequest = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockJobRequestSkillSlot = {
  updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerAssignment = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  // refreshWorkerOverallRating() counts a worker's rows (quality/service.ts:41).
  count: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(0),
};

// Deferred-bug batch (2026-08-07): acceptBroadcast() now also writes a
// CalendarEntry in the same transaction (see the fix's own comment in
// service.ts), so the calendar grid — which reads exclusively from
// CalendarEntry, not WorkerAssignment — actually shows the accepted shift.
const mockCalendarEntry = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// isWorkerEligibleForHotel() (roster-scope.ts) reads employmentRecord.findUnique
// itself (status/hotel_group_id) before this service's own skill check reads
// it a second time (skills) -- both calls hit this same mock function, so its
// default resolved value must satisfy both selects (Prisma mocks don't
// actually project by `select`, they return whatever this stub is told to).
const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// isHotelInScope()'s hotel_group branch (invoked by isWorkerEligibleForHotel())
// reads hotel.findUnique({ select: { hotel_group_id } }).
const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// isWorkerEligibleForHotel() also now checks the hotel blocklist (REQ-EMP-005
// / RULE-EMP-07 rework, 2026-08-06).
const mockEmployeeBlocklistEntry = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// Critical fix (2026-08-08): acceptBroadcast() now checks
// isWorkerAbsentOnDay() before claiming a slot.
const mockCalendarAbsence = {
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
};

const mockPrisma = {
  jobRequest: mockJobRequest,
  jobRequestSkillSlot: mockJobRequestSkillSlot,
  workerAssignment: mockWorkerAssignment,
  calendarEntry: mockCalendarEntry,
  calendarAbsence: mockCalendarAbsence,
  // refreshWorkerOverallRating() (quality/service.ts) now runs inside the
  // assignment-CREATION transactions too, not only on status changes -- the
  // aggregate counts all of a worker's rows regardless of status, so creating
  // one changes it. These mocks back that recompute; the suites below are not
  // about rating maths, so the values are inert.
  rating: { aggregate: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({ _avg: { score: null }, _count: 0 }) },
  attendance: { count: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue(0) },
  workerOverallRating: { upsert: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({}) },
  employmentRecord: mockEmploymentRecord,
  hotel: mockHotel,
  employeeBlocklistEntry: mockEmployeeBlocklistEntry,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

// Default: worker w1/w2 belong to hotel group g1, and hotel h1 belongs to the
// same group -- isWorkerEligibleForHotel('w1'|'w2', 'h1') resolves true by
// default so each test only needs to override the specific field it cares
// about (e.g. `skills`) rather than re-stating the whole eligibility chain.
mockEmploymentRecord.findUnique.mockResolvedValue({
  id: 'emp1',
  status: 'ACTIVE',
  hotel_group_id: 'g1',
  skills: ['CLEANER'],
});
mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
mockEmployeeBlocklistEntry.findUnique.mockResolvedValue(null);

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { JobRequestService } from '../modules/job-requests/service.js';

const makeSkillSlotRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'slot1',
  job_request_id: 'jr1',
  skill: 'CLEANER' as const,
  headcount: 1,
  confirmed_count: 0,
  created_at: new Date('2026-07-29T00:00:00Z'),
  updated_at: new Date('2026-07-29T00:00:00Z'),
  ...overrides,
});

const makeJobRequestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'jr1',
  hotel_id: 'h1',
  created_by_id: 'mgr1',
  position: '1x CLEANER',
  workers_needed: 1,
  workers_confirmed: 0,
  version: 0,
  shift_date: new Date('2026-08-01T00:00:00.000Z'),
  shift_start_time: '08:00',
  shift_end_time: '16:00',
  hourly_rate: null,
  currency: 'EUR',
  description: null,
  requirements: null,
  status: 'OPEN' as const,
  published_at: new Date('2026-07-29T00:00:00Z'),
  expires_at: null,
  filled_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: new Date('2026-07-29T00:00:00Z'),
  updated_at: new Date('2026-07-29T00:00:00Z'),
  skill_slots: [makeSkillSlotRow()],
  ...overrides,
});

describe('JobRequestService.acceptBroadcast', () => {
  let service: JobRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkerAssignment.count.mockResolvedValue(0);
    mockPrisma.rating.aggregate.mockResolvedValue({ _avg: { score: null }, _count: 0 });
    mockPrisma.attendance.count.mockResolvedValue(0);
    mockPrisma.workerOverallRating.upsert.mockResolvedValue({});
    mockCalendarAbsence.findUnique.mockResolvedValue(null);
    service = new JobRequestService();
  });

  it('throws NotFoundError when the job request does not exist', async () => {
    mockJobRequest.findUnique.mockResolvedValue(null);
    await expect(
      service.acceptBroadcast('missing', 'CLEANER', { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('throws ConflictError when the job request has no skill slots (not a broadcast)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow({ skill_slots: [] }));
    await expect(
      service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('throws ConflictError when the broadcast is no longer OPEN', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow({ status: 'CANCELLED' }));
    await expect(
      service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('throws NotFoundError when no skill slot matches the requested skill', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    await expect(
      service.acceptBroadcast('jr1', 'WAITER', { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('rejects a worker not eligible at this hotel (ForbiddenError)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockEmploymentRecord.findUnique.mockResolvedValue(null); // no roster record -> ineligible
    await expect(
      service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(mockJobRequestSkillSlot.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a worker who does not hold the matching skill (ForbiddenError)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockEmploymentRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      hotel_group_id: 'g1',
      skills: ['WAITER'],
    });
    await expect(
      service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(mockJobRequestSkillSlot.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a worker already assigned that day (ConflictError, before attempting a claim)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockEmploymentRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      hotel_group_id: 'g1',
      skills: ['CLEANER'],
    });
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'existing-assignment' }); // isWorkerFreeOnDay -> false
    await expect(
      service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
    expect(mockJobRequestSkillSlot.updateMany).not.toHaveBeenCalled();
  });

  // Critical fix (2026-08-08): "a worker should not be allowed to be placed
  // if he has applied sick or holiday for the specific date".
  it('rejects a worker with a SICK/VACATION absence marked that day (ConflictError, before attempting a claim)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockEmploymentRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      hotel_group_id: 'g1',
      skills: ['CLEANER'],
    });
    mockWorkerAssignment.findFirst.mockResolvedValue(null); // free that day
    mockCalendarAbsence.findUnique.mockResolvedValue({ id: 'abs1' });
    await expect(
      service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
    expect(mockJobRequestSkillSlot.updateMany).not.toHaveBeenCalled();
  });

  it('creates a WorkerAssignment with job_request_id set and work_request_id null on a successful claim', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockEmploymentRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      hotel_group_id: 'g1',
      skills: ['CLEANER'],
    });
    mockWorkerAssignment.findFirst.mockResolvedValue(null); // free that day
    mockJobRequestSkillSlot.updateMany.mockResolvedValue({ count: 1 }); // claim succeeds
    mockWorkerAssignment.create.mockResolvedValue({ id: 'a1' });
    mockCalendarEntry.create.mockResolvedValue({ id: 'ce1' });

    const result = await service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' });

    expect(result).toEqual({
      status: 'accepted',
      assignment_id: 'a1',
      job_request_id: 'jr1',
      skill: 'CLEANER',
    });
    expect(mockJobRequestSkillSlot.updateMany).toHaveBeenCalledWith({
      where: { id: 'slot1', confirmed_count: { lt: 1 } },
      data: { confirmed_count: { increment: 1 } },
    });
    expect(mockWorkerAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        work_request_id: null,
        job_request_id: 'jr1',
        // 2026-08-05 lifecycle fix: records which slot was claimed, so a
        // later cancellation can decrement exactly this slot's
        // confirmed_count (see assignments.test.ts for that half).
        skill_slot_id: 'slot1',
        worker_id: 'w1',
        hotel_id: 'h1',
        assigned_by_id: 'mgr1', // the broadcast's own created_by_id, not the worker
        status: 'CONFIRMED',
      }),
    });
    expect(mockCalendarEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignment_id: 'a1',
        worker_id: 'w1',
        hotel_id: 'h1',
        placed_by_id: 'mgr1',
      }),
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ACCEPT_BROADCAST' }),
      })
    );
  });

  it('returns "requirement fulfilled" (not an error) when the claim affects zero rows', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockEmploymentRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      hotel_group_id: 'g1',
      skills: ['CLEANER'],
    });
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockJobRequestSkillSlot.updateMany.mockResolvedValue({ count: 0 }); // slot already filled

    const result = await service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w2', role: 'worker' });

    expect(result).toEqual({
      status: 'requirement_fulfilled',
      job_request_id: 'jr1',
      skill: 'CLEANER',
    });
    expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
    // Lost-race audit fix (2026-08-05): no WorkerAssignment was created, but
    // the attempt itself is now recorded (against the WORK_REQUEST, since
    // there's no WORKER_ASSIGNMENT resource for a claim that never landed).
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ACCEPT_BROADCAST_LOST_RACE',
          resource_type: 'WORK_REQUEST',
          resource_id: 'jr1',
        }),
      })
    );
  });

  it('translates a P2002 unique-constraint violation (daily-exclusivity index) into ConflictError', async () => {
    const { Prisma } = await import('@prisma/client');
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockEmploymentRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      hotel_group_id: 'g1',
      skills: ['CLEANER'],
    });
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockJobRequestSkillSlot.updateMany.mockResolvedValue({ count: 1 });
    mockWorkerAssignment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      })
    );

    await expect(
      service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' })
    ).rejects.toThrow('Worker already has an assignment for this day');
  });

  describe('concurrency: exactly one winner on the last remaining slot (FIND-BRV-006 — mandatory, not deferred)', () => {
    it('first claimant wins, second claimant on the same single-headcount slot gets "requirement fulfilled"', async () => {
      // Stateful mock: models one real JobRequestSkillSlot row shared by both
      // claimants. Each call's WHERE predicate (confirmed_count < headcount)
      // is re-evaluated against the row's CURRENT state, exactly as
      // Postgres's row-level lock would serialize two genuinely concurrent
      // UPDATE statements against the same physical row — the second
      // claimant's predicate is evaluated against the FIRST claimant's
      // already-applied increment, not a stale snapshot.
      const sharedSlot = { headcount: 1, confirmed_count: 0 };
      mockJobRequestSkillSlot.updateMany.mockImplementation(async () => {
        if (sharedSlot.confirmed_count < sharedSlot.headcount) {
          sharedSlot.confirmed_count += 1;
          return { count: 1 };
        }
        return { count: 0 };
      });
      mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
      mockEmploymentRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      hotel_group_id: 'g1',
      skills: ['CLEANER'],
    });
      mockWorkerAssignment.findFirst.mockResolvedValue(null);
      mockWorkerAssignment.create.mockImplementation(async ({ data }: any) => ({
        id: `assignment-for-${data.worker_id}`,
      }));
      mockCalendarEntry.create.mockResolvedValue({ id: 'ce1' });

      // Two workers race for the same single-headcount slot. In this
      // deterministic mock, call order is the race outcome — the first
      // acceptBroadcast() call to reach its updateMany is the "earliest
      // server-received" claimant per TRULE-003's tie-break rule.
      const [firstResult, secondResult] = await Promise.all([
        service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' }),
        service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w2', role: 'worker' }),
      ]);

      const results = [firstResult, secondResult];
      const winners = results.filter((r) => r.status === 'accepted');
      const losers = results.filter((r) => r.status === 'requirement_fulfilled');

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(mockWorkerAssignment.create).toHaveBeenCalledTimes(1);
      expect(sharedSlot.confirmed_count).toBe(1); // exactly one increment persisted, not two
    });

    it('the losing claimant creates zero assignment rows and logs a lost-race audit entry (not a WORKER_ASSIGNMENT one)', async () => {
      const sharedSlot = { headcount: 1, confirmed_count: 0 };
      mockJobRequestSkillSlot.updateMany.mockImplementation(async () => {
        if (sharedSlot.confirmed_count < sharedSlot.headcount) {
          sharedSlot.confirmed_count += 1;
          return { count: 1 };
        }
        return { count: 0 };
      });
      mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
      mockEmploymentRecord.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      hotel_group_id: 'g1',
      skills: ['CLEANER'],
    });
      mockWorkerAssignment.findFirst.mockResolvedValue(null);
      let createCallCount = 0;
      mockWorkerAssignment.create.mockImplementation(async ({ data }: any) => {
        createCallCount += 1;
        return { id: `assignment-for-${data.worker_id}` };
      });
      mockCalendarEntry.create.mockResolvedValue({ id: 'ce1' });

      await Promise.all([
        service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w1', role: 'worker' }),
        service.acceptBroadcast('jr1', 'CLEANER', { userId: 'w2', role: 'worker' }),
      ]);

      // Exactly one WorkerAssignment created across both concurrent
      // attempts — the loser's transaction never reaches the create() call.
      expect(createCallCount).toBe(1);
      // Two audit entries total: the winner's ACCEPT_BROADCAST (against the
      // new WORKER_ASSIGNMENT) and the loser's ACCEPT_BROADCAST_LOST_RACE
      // (against the WORK_REQUEST, since the loser created no assignment).
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'ACCEPT_BROADCAST' }),
        })
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'ACCEPT_BROADCAST_LOST_RACE' }),
        })
      );
    });
  });
});
