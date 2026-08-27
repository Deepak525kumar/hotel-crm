import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Broadcast raise + eligibility computation for Epic 9 PR 9.7
 * (TREQ-002/TREQ-003/TREQ-010, MIG-GAP-04/05), extended by Epic 9 PR 9.8
 * with skill-matched notification delivery (TREQ-003 delivery half).
 *
 * raiseBroadcast() creates a JobRequest + JobRequestSkillSlot rows (one per
 * skill x headcount line, e.g. "2 Cleaners + 1 Waiter") in one transaction,
 * published immediately, then (PR 9.8) enqueues a JOB_REQUEST_BROADCAST
 * notification to every eligible worker per skill slot in that same
 * transaction. getBroadcastEligibility() computes, per skill slot,
 * {hotel-group roster ∩ matching skill ∩ free that day} by reusing
 * listEligibleWorkerIds() (roster-scope.ts) and isWorkerFreeOnDay() (PR 9.6,
 * assignments/service.ts) rather than duplicating either; PR 9.8's
 * notification step reuses this exact same eligibility computation
 * (computeBroadcastEligibility()) rather than recalculating it.
 *
 * Out of this PR's scope, not asserted here: first-accept arbitration,
 * optimistic concurrency, "requirement fulfilled" detection (PR 9.9),
 * auto-close (PR 9.10).
 */

const mockJobRequest = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockEmploymentRecord = {
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerAssignment = {
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  // computeBroadcastEligibility() (release-audit fix, 2026-08-05) batches the
  // per-worker isWorkerFreeOnDay() fan-out into one findMany() query; the
  // single-worker acceptBroadcast() path still uses findFirst() via
  // isWorkerFreeOnDay() directly.
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// Critical fix (2026-08-08): acceptBroadcast()/getBroadcastEligibility() now
// exclude workers with a SICK/VACATION absence marked that day.
const mockCalendarAbsence = {
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
};

const mockPrisma = {
  hotel: mockHotel,
  jobRequest: mockJobRequest,
  employmentRecord: mockEmploymentRecord,
  workerAssignment: mockWorkerAssignment,
  calendarAbsence: mockCalendarAbsence,
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

// ADR-029 (GD-01, Epic 7 PR 7.3): default resolved values so enqueue() inside
// raiseBroadcast()'s transaction has something to read `.id` off of.
mockNotification.create.mockResolvedValue({ id: 'notif-default' });
mockOutboxEvent.create.mockResolvedValue({ id: 'outbox-default' });

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
  headcount: 2,
  confirmed_count: 0,
  created_at: new Date('2026-07-29T00:00:00Z'),
  updated_at: new Date('2026-07-29T00:00:00Z'),
  ...overrides,
});

const makeJobRequestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'jr1',
  hotel_id: 'h1',
  created_by_id: 'mgr1',
  target_role: 'WORKER' as const,
  position: '2x CLEANER, 1x WAITER',
  workers_needed: 3,
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

const baseBroadcastInput = {
  hotel_id: 'h1',
  target_role: 'WORKER' as const,
  shift_date: '2026-08-01',
  shift_start_time: '08:00',
  shift_end_time: '16:00',
  skills: [{ skill: 'CLEANER' as const, headcount: 2 }],
};

describe('JobRequestService.raiseBroadcast', () => {
  let service: JobRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobRequestService();
  });

  it('throws NotFoundError when hotel does not exist', async () => {
    mockHotel.findUnique.mockResolvedValue(null);
    await expect(
      service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('GD-05: rejects when the hotel has paused accepting_jobs', async () => {
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: false });
    await expect(
      service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
    expect(mockJobRequest.create).not.toHaveBeenCalled();
  });

  it('manager out of scope is rejected (ForbiddenError)', async () => {
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
    await expect(
      service.raiseBroadcast(baseBroadcastInput, {
        userId: 'mgr1',
        role: 'manager',
        scope: { type: 'hotel', hotel_id: 'h2' },
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(mockJobRequest.create).not.toHaveBeenCalled();
  });

  it('manager in scope succeeds', async () => {
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
    mockJobRequest.create.mockResolvedValue(makeJobRequestRow());
    await expect(
      service.raiseBroadcast(baseBroadcastInput, {
        userId: 'mgr1',
        role: 'manager',
        scope: { type: 'hotel', hotel_id: 'h1' },
      })
    ).resolves.toBeDefined();
  });

  it('persists a single-skill broadcast correctly (skill x headcount)', async () => {
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
    mockJobRequest.create.mockResolvedValue(makeJobRequestRow());

    const dto = await service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockJobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hotel_id: 'h1',
          status: 'OPEN',
          skill_slots: { create: [{ skill: 'CLEANER', headcount: 2 }] },
        }),
        include: { skill_slots: true },
      })
    );
    expect(dto.skill_slots).toEqual([
      { id: 'slot1', skill: 'CLEANER', headcount: 2, confirmed_count: 0 },
    ]);
  });

  it('persists a multi-skill broadcast ("2 Cleaners + 1 Waiter") as multiple skill_slots lines', async () => {
    const multiSkillInput = {
      ...baseBroadcastInput,
      skills: [
        { skill: 'CLEANER' as const, headcount: 2 },
        { skill: 'WAITER' as const, headcount: 1 },
      ],
    };
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
    mockJobRequest.create.mockResolvedValue(
      makeJobRequestRow({
        workers_needed: 3,
        skill_slots: [
          makeSkillSlotRow({ id: 'slot1', skill: 'CLEANER', headcount: 2 }),
          makeSkillSlotRow({ id: 'slot2', skill: 'WAITER', headcount: 1 }),
        ],
      })
    );

    const dto = await service.raiseBroadcast(multiSkillInput, { userId: 'mgr1', role: 'admin' });

    expect(mockJobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workers_needed: 3,
          skill_slots: {
            create: [
              { skill: 'CLEANER', headcount: 2 },
              { skill: 'WAITER', headcount: 1 },
            ],
          },
        }),
      })
    );
    expect(dto.skill_slots).toHaveLength(2);
    expect(dto.skill_slots?.map((s) => s.skill)).toEqual(['CLEANER', 'WAITER']);
  });

  // 2026-08-26 (reported live: "There should also be an option for none").
  // RaiseBroadcastSchema accepts skill: null on a skill line, persisted as a
  // JobRequestSkillSlot row with a null skill column (2026-08-26 migration).
  it('persists a "no specific skill required" (null skill) line', async () => {
    const noSkillInput = {
      ...baseBroadcastInput,
      skills: [{ skill: null, headcount: 3 }],
    };
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
    mockJobRequest.create.mockResolvedValue(
      makeJobRequestRow({
        workers_needed: 3,
        skill_slots: [makeSkillSlotRow({ skill: null, headcount: 3 })],
      })
    );

    const dto = await service.raiseBroadcast(noSkillInput as never, { userId: 'mgr1', role: 'admin' });

    expect(mockJobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skill_slots: { create: [{ skill: null, headcount: 3 }] },
        }),
      })
    );
    expect(dto.skill_slots).toEqual([{ id: 'slot1', skill: null, headcount: 3, confirmed_count: 0 }]);
  });

  it('persists a broadcast mixing a real skill line with a "no specific skill required" line', async () => {
    const mixedInput = {
      ...baseBroadcastInput,
      skills: [
        { skill: 'CLEANER' as const, headcount: 2 },
        { skill: null, headcount: 1 },
      ],
    };
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
    mockJobRequest.create.mockResolvedValue(
      makeJobRequestRow({
        workers_needed: 3,
        skill_slots: [
          makeSkillSlotRow({ id: 'slot1', skill: 'CLEANER', headcount: 2 }),
          makeSkillSlotRow({ id: 'slot2', skill: null, headcount: 1 }),
        ],
      })
    );

    const dto = await service.raiseBroadcast(mixedInput as never, { userId: 'mgr1', role: 'admin' });

    expect(mockJobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skill_slots: {
            create: [
              { skill: 'CLEANER', headcount: 2 },
              { skill: null, headcount: 1 },
            ],
          },
        }),
      })
    );
    expect(dto.skill_slots?.map((s) => s.skill)).toEqual(['CLEANER', null]);
  });

  it('publishes immediately (status OPEN, published_at set) — a broadcast has no DRAFT step', async () => {
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
    mockJobRequest.create.mockResolvedValue(makeJobRequestRow());

    await service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' });

    const data = mockJobRequest.create.mock.calls[0][0].data;
    expect(data.status).toBe('OPEN');
    expect(data.published_at).toBeInstanceOf(Date);
  });

  it('logs an audit entry citing the raised skills', async () => {
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
    mockJobRequest.create.mockResolvedValue(makeJobRequestRow());

    await service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'CREATE',
          details: expect.objectContaining({ skills: baseBroadcastInput.skills }),
        }),
      })
    );
  });

  describe('notification delivery (Epic 9 PR 9.8, TREQ-003 delivery half)', () => {
    it('enqueues a JOB_REQUEST_BROADCAST notification for each eligible worker on a matching skill slot', async () => {
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1',
        deleted_at: null,
        accepting_jobs: true,
        hotel_group_id: 'g1',
      });
      mockJobRequest.create.mockResolvedValue(makeJobRequestRow());
      mockEmploymentRecord.findMany
        // roster-scope.listEligibleWorkerIds()'s own ACTIVE-membership lookup
        .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
        // this service's own skills-by-worker lookup
        .mockResolvedValueOnce([
          { user_id: 'w1', skills: ['CLEANER'] },
          { user_id: 'w2', skills: ['WAITER'] },
        ]);
      mockWorkerAssignment.findMany.mockResolvedValue([]); // both free that day

      await service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' });

      // Only w1 matches CLEANER (the only skill slot on baseBroadcastInput) and is free.
      expect(mockNotification.create).toHaveBeenCalledTimes(1);
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'w1',
            type: 'JOB_REQUEST_BROADCAST',
            hotel_id: 'h1',
          }),
        })
      );
    });

    it('does not notify a worker whose skill does not match any slot', async () => {
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1',
        deleted_at: null,
        accepting_jobs: true,
        hotel_group_id: 'g1',
      });
      mockJobRequest.create.mockResolvedValue(makeJobRequestRow());
      mockEmploymentRecord.findMany
        .mockResolvedValueOnce([{ user_id: 'w1' }])
        .mockResolvedValueOnce([{ user_id: 'w1', skills: ['WAITER'] }]);
      mockWorkerAssignment.findMany.mockResolvedValue([]);

      await service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' });

      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('does not notify a worker already assigned that day', async () => {
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1',
        deleted_at: null,
        accepting_jobs: true,
        hotel_group_id: 'g1',
      });
      mockJobRequest.create.mockResolvedValue(makeJobRequestRow());
      mockEmploymentRecord.findMany
        .mockResolvedValueOnce([{ user_id: 'w1' }])
        .mockResolvedValueOnce([{ user_id: 'w1', skills: ['CLEANER'] }]);
      mockWorkerAssignment.findMany.mockResolvedValue([{ worker_id: 'w1' }]); // already assigned

      await service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' });

      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('notifies once per matching skill slot for a worker eligible on multiple slots of the same broadcast', async () => {
      const multiSkillInput = {
        ...baseBroadcastInput,
        skills: [
          { skill: 'CLEANER' as const, headcount: 2 },
          { skill: 'WAITER' as const, headcount: 1 },
        ],
      };
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1',
        deleted_at: null,
        accepting_jobs: true,
        hotel_group_id: 'g1',
      });
      mockJobRequest.create.mockResolvedValue(
        makeJobRequestRow({
          workers_needed: 3,
          skill_slots: [
            makeSkillSlotRow({ id: 'slot1', skill: 'CLEANER', headcount: 2 }),
            makeSkillSlotRow({ id: 'slot2', skill: 'WAITER', headcount: 1 }),
          ],
        })
      );
      // w1 holds both skills — eligible on both slots of this one broadcast.
      mockEmploymentRecord.findMany
        .mockResolvedValueOnce([{ user_id: 'w1' }])
        .mockResolvedValueOnce([{ user_id: 'w1', skills: ['CLEANER', 'WAITER'] }]);
      mockWorkerAssignment.findMany.mockResolvedValue([]);

      await service.raiseBroadcast(multiSkillInput, { userId: 'mgr1', role: 'admin' });

      // Two distinct openings on the same broadcast — one notification per slot, not deduplicated.
      expect(mockNotification.create).toHaveBeenCalledTimes(2);
      const notifiedSkills = mockNotification.create.mock.calls.map(
        (call: any) => call[0].data.data.skill
      );
      expect(notifiedSkills.sort()).toEqual(['CLEANER', 'WAITER']);
    });

    it('enqueues the notification and its OutboxEvent in the same transaction as the JobRequest create', async () => {
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1',
        deleted_at: null,
        accepting_jobs: true,
        hotel_group_id: 'g1',
      });
      mockJobRequest.create.mockResolvedValue(makeJobRequestRow());
      mockEmploymentRecord.findMany
        .mockResolvedValueOnce([{ user_id: 'w1' }])
        .mockResolvedValueOnce([{ user_id: 'w1', skills: ['CLEANER'] }]);
      mockWorkerAssignment.findMany.mockResolvedValue([]);

      await service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockNotification.create).toHaveBeenCalledTimes(1);
      expect(mockOutboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source_module: 'WORK_REQUESTS', transport: 'PUSH' }),
        })
      );
    });

    // 2026-08-26 (reported live: "when no skill is selected the request
    // should go to all the workers that are in scope"). skill: null means
    // "no specific skill required" -- unlike a real-skill slot, EVERY free
    // roster worker is eligible, including one holding no skills at all.
    it('notifies every free roster worker for a "no specific skill required" (null) slot, regardless of their own skills', async () => {
      const noSkillInput = {
        ...baseBroadcastInput,
        skills: [{ skill: null, headcount: 3 }],
      };
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1',
        deleted_at: null,
        accepting_jobs: true,
        hotel_group_id: 'g1',
      });
      mockJobRequest.create.mockResolvedValue(
        makeJobRequestRow({ skill_slots: [makeSkillSlotRow({ skill: null, headcount: 3 })] })
      );
      mockEmploymentRecord.findMany
        .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }, { user_id: 'w3' }])
        // w1 holds a skill, w2 holds a different one, w3 holds none at all —
        // none of that should matter for a null slot.
        .mockResolvedValueOnce([
          { user_id: 'w1', skills: ['CLEANER'] },
          { user_id: 'w2', skills: ['WAITER'] },
          { user_id: 'w3', skills: [] },
        ]);
      mockWorkerAssignment.findMany.mockResolvedValue([]); // all free

      await service.raiseBroadcast(noSkillInput as never, { userId: 'mgr1', role: 'admin' });

      expect(mockNotification.create).toHaveBeenCalledTimes(3);
      const notifiedWorkers = mockNotification.create.mock.calls.map((call: any) => call[0].data.user_id);
      expect(notifiedWorkers.sort()).toEqual(['w1', 'w2', 'w3']);
    });

    it('excludes a worker who is busy or absent from a null-skill slot too', async () => {
      const noSkillInput = {
        ...baseBroadcastInput,
        skills: [{ skill: null, headcount: 3 }],
      };
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1',
        deleted_at: null,
        accepting_jobs: true,
        hotel_group_id: 'g1',
      });
      mockJobRequest.create.mockResolvedValue(
        makeJobRequestRow({ skill_slots: [makeSkillSlotRow({ skill: null, headcount: 3 })] })
      );
      mockEmploymentRecord.findMany
        .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
        .mockResolvedValueOnce([
          { user_id: 'w1', skills: [] },
          { user_id: 'w2', skills: [] },
        ]);
      mockWorkerAssignment.findMany.mockResolvedValue([{ worker_id: 'w1' }]); // w1 busy

      await service.raiseBroadcast(noSkillInput as never, { userId: 'mgr1', role: 'admin' });

      expect(mockNotification.create).toHaveBeenCalledTimes(1);
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ user_id: 'w2' }) })
      );
    });

    it('does not notify anyone when the hotel roster is empty (no ungrouped-hotel crash)', async () => {
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1',
        deleted_at: null,
        accepting_jobs: true,
        hotel_group_id: null,
      });
      mockJobRequest.create.mockResolvedValue(makeJobRequestRow());

      await expect(
        service.raiseBroadcast(baseBroadcastInput, { userId: 'mgr1', role: 'admin' })
      ).resolves.toBeDefined();

      expect(mockNotification.create).not.toHaveBeenCalled();
      expect(mockEmploymentRecord.findMany).not.toHaveBeenCalled();
    });
  });
});

// ── Derived fill status (2026-08-07) ─────────────────────────────────────
//
// WorkRequestStatus declares PARTIALLY_FILLED and FILLED, but no write site
// ever set either -- a fully staffed broadcast read OPEN forever. They are
// now derived at read time from skill_slots.confirmed_count (the column that
// IS maintained) rather than stored, so a second write path cannot drift out
// of sync with the first.
describe('JobRequestService fill status (derived)', () => {
  let service: JobRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobRequestService();
    mockHotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
  });

  const getStatus = async (slots: Array<Record<string, unknown>>, stored = 'OPEN') => {
    mockJobRequest.findUnique.mockResolvedValue(
      makeJobRequestRow({
        status: stored,
        skill_slots: slots.map((o) => makeSkillSlotRow(o)),
      })
    );
    const dto = await service.getById('jr1', { userId: 'admin1', role: 'admin', scope: null } as any);
    return dto;
  };

  it('reports OPEN while no slot has been claimed', async () => {
    const dto = await getStatus([{ headcount: 2, confirmed_count: 0 }]);
    expect(dto.status).toBe('OPEN');
    expect(dto.workers_confirmed).toBe(0);
  });

  it('reports PARTIALLY_FILLED once some but not all slots are claimed', async () => {
    const dto = await getStatus([{ headcount: 3, confirmed_count: 1 }]);
    expect(dto.status).toBe('PARTIALLY_FILLED');
    expect(dto.workers_confirmed).toBe(1);
  });

  it('reports FILLED once every slot is at headcount', async () => {
    const dto = await getStatus([
      { id: 'slot1', skill: 'CLEANER', headcount: 2, confirmed_count: 2 },
      { id: 'slot2', skill: 'WAITER', headcount: 1, confirmed_count: 1 },
    ]);
    expect(dto.status).toBe('FILLED');
    expect(dto.workers_confirmed).toBe(3);
  });

  it('reports PARTIALLY_FILLED when one skill is full but another is not', async () => {
    const dto = await getStatus([
      { id: 'slot1', skill: 'CLEANER', headcount: 2, confirmed_count: 2 },
      { id: 'slot2', skill: 'WAITER', headcount: 2, confirmed_count: 0 },
    ]);
    expect(dto.status).toBe('PARTIALLY_FILLED');
  });

  // A cancelled or expired request is not "partially filled" regardless of
  // what its slots say -- the manual/terminal state has to win, or cancelling
  // a half-staffed broadcast would appear to un-cancel it.
  it.each(['CANCELLED', 'EXPIRED', 'DRAFT'])(
    'leaves a %s request unchanged even with claimed slots',
    async (stored) => {
      const dto = await getStatus([{ headcount: 2, confirmed_count: 1 }], stored);
      expect(dto.status).toBe(stored);
    }
  );

  // Marketplace requests have no per-slot data, so there is nothing to derive
  // from and the stored status must pass through untouched.
  it('leaves a marketplace request (no skill slots) on its stored status', async () => {
    mockJobRequest.findUnique.mockResolvedValue(
      makeJobRequestRow({ status: 'OPEN', skill_slots: [], workers_confirmed: 4 })
    );
    const dto = await service.getById('jr1', { userId: 'admin1', role: 'admin', scope: null } as any);
    expect(dto.status).toBe('OPEN');
    expect(dto.workers_confirmed).toBe(4);
  });
});

describe('JobRequestService.getBroadcastEligibility', () => {
  let service: JobRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobRequestService();
    mockCalendarAbsence.findMany.mockResolvedValue([]);
  });

  it('throws NotFoundError when the job request does not exist', async () => {
    mockJobRequest.findUnique.mockResolvedValue(null);
    await expect(
      service.getBroadcastEligibility('missing', { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('throws ConflictError when the job request has no skill slots (not a broadcast)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow({ skill_slots: [] }));
    await expect(
      service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('manager out of scope is rejected (ForbiddenError)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    await expect(
      service.getBroadcastEligibility('jr1', {
        userId: 'mgr1',
        role: 'manager',
        scope: { type: 'hotel', hotel_id: 'h2' },
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
  });

  it('excludes non-matching-skill workers from the eligible set', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmploymentRecord.findMany
      // roster-scope.listEligibleWorkerIds()'s own ACTIVE-membership lookup
      .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
      // this service's own skills-by-worker lookup
      .mockResolvedValueOnce([
        { user_id: 'w1', skills: ['CLEANER'] },
        { user_id: 'w2', skills: ['WAITER'] },
      ]);
    mockWorkerAssignment.findMany.mockResolvedValue([]); // both free that day

    const dto = await service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' });

    expect(dto.slots).toHaveLength(1);
    expect(dto.slots[0].skill).toBe('CLEANER');
    expect(dto.slots[0].eligible_count).toBe(1);
  });

  it('excludes already-assigned-that-day workers from the eligible set', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmploymentRecord.findMany
      .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
      .mockResolvedValueOnce([
        { user_id: 'w1', skills: ['CLEANER'] },
        { user_id: 'w2', skills: ['CLEANER'] },
      ]);
    // w1 already has an active assignment that day; w2 is free.
    mockWorkerAssignment.findMany.mockResolvedValue([{ worker_id: 'w1' }]);

    const dto = await service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' });

    expect(dto.slots[0].eligible_count).toBe(1);
  });

  // Critical fix (2026-08-08): "a worker should not be allowed to be placed
  // if he has applied sick or holiday for the specific date" -- extended to
  // the eligibility list a manager sees, not just the accept path itself.
  it('excludes workers with a SICK/VACATION absence marked that day from the eligible set', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmploymentRecord.findMany
      .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
      .mockResolvedValueOnce([
        { user_id: 'w1', skills: ['CLEANER'] },
        { user_id: 'w2', skills: ['CLEANER'] },
      ]);
    mockWorkerAssignment.findMany.mockResolvedValue([]); // neither busy
    // w1 has a declared absence that day; w2 does not.
    mockCalendarAbsence.findMany.mockResolvedValue([{ worker_id: 'w1' }]);

    const dto = await service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' });

    expect(dto.slots[0].eligible_count).toBe(1);
  });

  // Mirrors calendar-entries.test.ts's equivalent assertion: pins the
  // explicit blocking-kind filter so a future informational
  // CalendarAbsenceKind cannot silently start excluding workers from the
  // eligible set -- see BLOCKING_ABSENCE_KINDS (assignments/service.ts).
  it('filters the batched absence lookup to the blocking kinds explicitly, not any absence row', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmploymentRecord.findMany
      .mockResolvedValueOnce([{ user_id: 'w1' }])
      .mockResolvedValueOnce([{ user_id: 'w1', skills: ['CLEANER'] }]);
    mockWorkerAssignment.findMany.mockResolvedValue([]);
    mockCalendarAbsence.findMany.mockResolvedValue([]);

    await service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' });

    const where = mockCalendarAbsence.findMany.mock.calls[0][0].where;
    expect(where.kind).toEqual({ in: ['SICK', 'VACATION'] });
  });

  it('computes a distinct eligible set per skill slot on a multi-skill broadcast', async () => {
    mockJobRequest.findUnique.mockResolvedValue(
      makeJobRequestRow({
        skill_slots: [
          makeSkillSlotRow({ id: 'slot1', skill: 'CLEANER', headcount: 2 }),
          makeSkillSlotRow({ id: 'slot2', skill: 'WAITER', headcount: 1 }),
        ],
      })
    );
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmploymentRecord.findMany
      .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
      .mockResolvedValueOnce([
        { user_id: 'w1', skills: ['CLEANER'] },
        { user_id: 'w2', skills: ['WAITER'] },
      ]);
    mockWorkerAssignment.findMany.mockResolvedValue([]);

    const dto = await service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' });

    expect(dto.slots.find((s) => s.skill === 'CLEANER')?.eligible_count).toBe(1);
    expect(dto.slots.find((s) => s.skill === 'WAITER')?.eligible_count).toBe(1);
  });

  it('returns an empty eligible set per slot when the hotel roster is empty (no ungrouped-hotel crash)', async () => {
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: null });

    const dto = await service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' });

    expect(dto.slots[0].eligible_count).toBe(0);
    expect(mockEmploymentRecord.findMany).not.toHaveBeenCalled();
  });

  // 2026-08-26: a null-skill slot's eligible set is every free roster
  // worker — no skills.includes() filter applies at all.
  it('includes every free roster worker (regardless of skills) for a "no specific skill required" (null) slot', async () => {
    mockJobRequest.findUnique.mockResolvedValue(
      makeJobRequestRow({ skill_slots: [makeSkillSlotRow({ skill: null, headcount: 3 })] })
    );
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmploymentRecord.findMany
      .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
      .mockResolvedValueOnce([
        { user_id: 'w1', skills: ['CLEANER'] },
        { user_id: 'w2', skills: [] },
      ]);
    mockWorkerAssignment.findMany.mockResolvedValue([]);

    const dto = await service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' });

    expect(dto.slots[0].skill).toBeNull();
    expect(dto.slots[0].eligible_count).toBe(2);
  });

  it('computes independent eligible sets for a real-skill slot and a null-skill slot on the same broadcast', async () => {
    mockJobRequest.findUnique.mockResolvedValue(
      makeJobRequestRow({
        skill_slots: [
          makeSkillSlotRow({ id: 'slot1', skill: 'CLEANER', headcount: 1 }),
          makeSkillSlotRow({ id: 'slot2', skill: null, headcount: 1 }),
        ],
      })
    );
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmploymentRecord.findMany
      .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
      .mockResolvedValueOnce([
        { user_id: 'w1', skills: ['CLEANER'] },
        { user_id: 'w2', skills: [] },
      ]);
    mockWorkerAssignment.findMany.mockResolvedValue([]);

    const dto = await service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' });

    expect(dto.slots.find((s) => s.skill === 'CLEANER')?.eligible_count).toBe(1);
    expect(dto.slots.find((s) => s.skill === null)?.eligible_count).toBe(2);
  });

  it('calendar placement never triggers a broadcast (negative assertion, TRULE-002)', async () => {
    // A calendar-placed JobRequest read never happens — placeOnCalendar()
    // (PR 9.5) does not create or touch a JobRequest at all, so there is no
    // JobRequest row for a calendar placement to be mistaken for a
    // broadcast. This is asserted at the type/call level: raiseBroadcast()
    // is the only method that writes skill_slots, and
    // assignments/service.ts's placeOnCalendar() (a distinct module/service)
    // never calls it.
    mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow({ skill_slots: [] }));
    await expect(
      service.getBroadcastEligibility('jr1', { userId: 'mgr1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
    expect(mockJobRequest.create).not.toHaveBeenCalled();
  });

  // Role-scoped response correction: this route has no requireRole gate
  // (a worker must be able to call it), so the response itself must never
  // leak other workers' user ids to a worker/checker caller — only their
  // own inclusion. admin/manager get a count only (both existing UI
  // consumers only ever rendered a count, never the raw list).
  describe('role-scoped response', () => {
    const twoEligibleWorkersSetup = () => {
      mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow());
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockEmploymentRecord.findMany
        .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
        .mockResolvedValueOnce([
          { user_id: 'w1', skills: ['CLEANER'] },
          { user_id: 'w2', skills: ['CLEANER'] },
        ]);
      mockWorkerAssignment.findMany.mockResolvedValue([]);
    };

    it('admin never receives eligible_worker_ids or an eligible field', async () => {
      twoEligibleWorkersSetup();
      const dto = await service.getBroadcastEligibility('jr1', { userId: 'admin1', role: 'admin' });

      expect(dto.slots[0]).not.toHaveProperty('eligible_worker_ids');
      expect(dto.slots[0]).not.toHaveProperty('eligible');
      expect(dto.slots[0].eligible_count).toBe(2);
    });

    it('a worker in the eligible set receives eligible: true, never the id list', async () => {
      twoEligibleWorkersSetup();
      const dto = await service.getBroadcastEligibility('jr1', { userId: 'w1', role: 'worker' });

      expect(dto.slots[0]).not.toHaveProperty('eligible_worker_ids');
      expect(dto.slots[0].eligible).toBe(true);
      expect(dto.slots[0].eligible_count).toBe(2);
    });

    it('a worker NOT in the eligible set receives eligible: false, never the id list', async () => {
      twoEligibleWorkersSetup();
      const dto = await service.getBroadcastEligibility('jr1', { userId: 'w3', role: 'worker' });

      expect(dto.slots[0]).not.toHaveProperty('eligible_worker_ids');
      expect(dto.slots[0].eligible).toBe(false);
    });

    // 2026-08-27 (target_role): a checker may never view eligibility for a
    // WORKER-targeted broadcast, same guard getById() applies.
    it('a checker is denied eligibility on a WORKER-targeted broadcast', async () => {
      twoEligibleWorkersSetup();
      await expect(
        service.getBroadcastEligibility('jr1', { userId: 'w2', role: 'checker' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('a checker gets the same self-scoped shape as a worker, on a CHECKER-targeted broadcast', async () => {
      mockJobRequest.findUnique.mockResolvedValue(makeJobRequestRow({ target_role: 'CHECKER' }));
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockEmploymentRecord.findMany
        .mockResolvedValueOnce([{ user_id: 'w1' }, { user_id: 'w2' }])
        .mockResolvedValueOnce([
          { user_id: 'w1', skills: ['CLEANER'] },
          { user_id: 'w2', skills: ['CLEANER'] },
        ]);
      mockWorkerAssignment.findMany.mockResolvedValue([]);

      const dto = await service.getBroadcastEligibility('jr1', { userId: 'w2', role: 'checker' });

      expect(dto.slots[0]).not.toHaveProperty('eligible_worker_ids');
      expect(dto.slots[0].eligible).toBe(true);
    });

    it('a manager (like admin) never receives eligible_worker_ids or an eligible field', async () => {
      twoEligibleWorkersSetup();
      const dto = await service.getBroadcastEligibility('jr1', {
        userId: 'mgr1',
        role: 'manager',
        scope: { type: 'hotel', hotel_id: 'h1' },
      });

      expect(dto.slots[0]).not.toHaveProperty('eligible_worker_ids');
      expect(dto.slots[0]).not.toHaveProperty('eligible');
      expect(dto.slots[0].eligible_count).toBe(2);
    });
  });
});
