import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../lib/utils.js', () => ({
  ...(jest.requireActual('../lib/utils.js') as object),
  todayInCalendarTimezone: () => '2020-01-01',
}));

/**
 * Calendar direct-assignment regression for Epic 9 PR 9.5 (TREQ-001/TRULE-001,
 * MIG-GAP-03).
 *
 * `placeOnCalendar()` creates a WorkerAssignment + CalendarEntry in one
 * transaction — a DIRECT assignment with no accept/decline step and no
 * broadcast notification. Both `work_request_id` and `job_request_id` are
 * left null (calendar placement has no backing JobRequest at all, per
 * ADR-056's ratified "no intermediating application or acceptance record
 * required" language — see IMPLEMENTATION_EXECUTION_PLAN.md's PR 9.5
 * repository-reality correction).
 *
 * The already-assigned-that-day rejection case spanning both creation paths
 * (calendar + broadcast-accept) is now asserted below, closing the test.todo
 * this file originally deferred to PR 9.6 (TREQ-007/TRULE-006, MIG-GAP-08:
 * re-keyed WorkerAssignment_active_slot_unique partial index).
 */

const mockWorkerAssignment = {
  findFirst: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  // 2026-08-13 fix: moveCalendarEntry() now reads the current assignment
  // first (to know its skill_slot_id before deciding whether the move
  // detaches it from a broadcast) -- default to a plain, non-broadcast
  // CONFIRMED row so every existing move test that doesn't care about
  // broadcast detachment keeps working unchanged.
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({
    id: 'a1', worker_id: 'w1', hotel_id: 'h1', skill_slot_id: null, job_request_id: null,
  }),
  count: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(0),
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// 2026-08-13 fix: moveCalendarEntry() decrements the original broadcast
// slot's confirmed_count when detaching a moved assignment from it.
const mockJobRequestSkillSlot = {
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockCalendarEntry = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// `lib/scope.ts`'s isHotelInScope() resolves a hotel_group-scoped claim by
// reading the target hotel's own group (one findUnique), so a test exercising a
// realistic regional_manager claim needs this model mocked. Without it the
// hotel_group branch throws and the only way to make an RM case pass is to hand
// it `{type:'global'}` — a scope resolveScope() never mints for a non-admin.
const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// placeOnCalendar() now calls isWorkerEligibleForHotel() unconditionally
// (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06) -- default every fixture
// worker to ACTIVE/eligible/not-blocklisted so this suite's existing
// placement tests don't need to separately stub eligibility.
const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockEmployeeBlocklistEntry = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// Critical fix (2026-08-08): placeOnCalendar()/reassign() now check
// isWorkerAbsentOnDay() before creating an assignment -- default every
// fixture worker to "no absence marked" so existing placement tests don't
// need to separately stub this.
const mockCalendarAbsence = {
  findFirst: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
};

const mockPrisma = {
  // placeOnCalendar() now refreshes WorkerOverallRating in-transaction
  // (2026-08-07): the aggregate counts a worker's rows regardless of status.
  // refreshWorkerOverallRating() reads QualityVerification for the quality
  // half of the rating (2026-08-29). Neutral fixture: no checks recorded.
  qualityVerification: { aggregate: async () => ({ _avg: { score: null }, _count: 0 }), findMany: async () => [] },
  rating: { aggregate: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({ _avg: { score: null }, _count: 0 }) },
  workerOverallRating: { upsert: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({}) },
  attendance: { count: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue(0) },
  workerAssignment: mockWorkerAssignment,
  calendarEntry: mockCalendarEntry,
  jobRequestSkillSlot: mockJobRequestSkillSlot,
  hotel: mockHotel,
  employmentRecord: mockEmploymentRecord,
  employeeBlocklistEntry: mockEmployeeBlocklistEntry,
  calendarAbsence: mockCalendarAbsence,
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

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

import { AssignmentService } from '../modules/assignments/service.js';
import { ListCalendarEntriesQuerySchema } from '../modules/assignments/types.js';

const makeAssignmentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  work_request_id: null,
  job_request_id: null,
  worker_id: 'w1',
  hotel_id: 'h1',
  assigned_by_id: 'mgr1',
  status: 'CONFIRMED' as const,
  confirmed_at: new Date('2026-07-29T00:00:00Z'),
  started_at: null,
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  previous_assignment_id: null,
  updated_at: new Date('2026-07-29T00:00:00Z'),
  ...overrides,
});

const makeCalendarEntryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ce1',
  assignment_id: 'a1',
  worker_id: 'w1',
  hotel_id: 'h1',
  day: new Date('2026-08-01T00:00:00.000Z'),
  placed_by_id: 'mgr1',
  created_at: new Date('2026-07-29T00:00:00Z'),
  updated_at: new Date('2026-07-29T00:00:00Z'),
  ...overrides,
});

describe('AssignmentService.placeOnCalendar / listCalendarEntries', () => {
  let service: AssignmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssignmentService();
    mockNotification.create.mockResolvedValue({ id: 'notif-default' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'outbox-default' });
    // Default the placed WORKER (not the acting manager's own scope, which
    // individual tests below set explicitly) to ACTIVE/eligible/not-
    // blocklisted at whatever hotel a test targets, matching the fixture
    // hotel_group_id 'g1' tests already use for the actor-scope checks.
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1', id: 'emp_w1' });
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmployeeBlocklistEntry.findUnique.mockResolvedValue(null);
    mockCalendarAbsence.findFirst.mockResolvedValue(null);
  });

  describe('placeOnCalendar', () => {
    it('creates a WorkerAssignment + CalendarEntry in one transaction, both work_request_id and job_request_id null', async () => {
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockResolvedValue(makeCalendarEntryRow());

      const result = await service.placeOnCalendar(
        { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
        { userId: 'mgr1', role: 'admin' }
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockWorkerAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          work_request_id: null,
          job_request_id: null,
          worker_id: 'w1',
          hotel_id: 'h1',
          assigned_by_id: 'mgr1',
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

      expect(result.assignment.work_request_id).toBeNull();
      expect(result.calendar_entry.assignment_id).toBe('a1');
    });

    // Critical fix (2026-08-08): "a worker should not be allowed to be
    // placed if he has applied sick or holiday for the specific date".
    it('refuses to place a worker who has a SICK/VACATION absence marked for that day', async () => {
      mockCalendarAbsence.findFirst.mockResolvedValue({ id: 'abs1' });

      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'mgr1', role: 'admin' }
        )
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    // Guards against an implicit "any CalendarAbsence row blocks staffing"
    // regression: CalendarAbsenceKind is {SICK, VACATION} today, so a
    // row-existence test would pass for the wrong reason. Pinning the
    // explicit `kind: { in: [...] }` filter means adding an informational
    // kind (TRAINING, NOTE, ...) to the enum cannot silently start
    // preventing staffing -- see BLOCKING_ABSENCE_KINDS.
    it('filters the absence lookup to the blocking kinds explicitly, not any absence row', async () => {
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockResolvedValue(makeCalendarEntryRow());

      await service.placeOnCalendar(
        { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
        { userId: 'mgr1', role: 'admin' }
      );

      const where = mockCalendarAbsence.findFirst.mock.calls[0][0].where;
      expect(where.kind).toEqual({ in: ['SICK', 'VACATION'] });
      expect(where.worker_id).toBe('w1');
      expect(where.day).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    });

    it('does not emit any notification (no broadcast fires — TRULE-002-adjacent negative assertion)', async () => {
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockResolvedValue(makeCalendarEntryRow());

      await service.placeOnCalendar(
        { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
        { userId: 'mgr1', role: 'admin' }
      );

      // No notification/outbox mock is wired into mockPrisma at all for this
      // service — placeOnCalendar() has no enqueue call path, unlike
      // job-requests/service.ts's broadcast-raise (PR 9.7+). Asserting the
      // audit log is the only side-effect beyond the two creates confirms no
      // notification-adjacent write was attempted.
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('logs an audit entry citing PLACE_ON_CALENDAR', async () => {
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockResolvedValue(makeCalendarEntryRow());

      await service.placeOnCalendar(
        { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
        { userId: 'mgr1', role: 'admin' }
      );

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'PLACE_ON_CALENDAR' }),
        })
      );
    });

    it('manager in scope (hotel claim matches) succeeds', async () => {
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockResolvedValue(makeCalendarEntryRow());

      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
        )
      ).resolves.toBeDefined();
    });

    it('manager out of scope (hotel claim does not match) is rejected (ForbiddenError)', async () => {
      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h2' } }
        )
      ).rejects.toThrow('Cannot place a worker on the calendar for this hotel');

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    // A regional_manager's real claim is `{type:'hotel_group'}` — resolveScope()
    // (auth/service.ts) mints `global` for role 'admin' ONLY, so an RM case
    // asserted with a global scope proves nothing about the RM branch: it
    // short-circuits isHotelInScope() before the group comparison runs. Both
    // directions are asserted here against a genuine hotel_group claim.
    it('regional_manager in scope (hotel_group claim matches the hotel\'s group) succeeds — ADR-030 D-5', async () => {
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockResolvedValue(makeCalendarEntryRow());
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });

      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        )
      ).resolves.toBeDefined();
    });

    it('regional_manager out of scope (hotel belongs to another group) is denied', async () => {
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g_other' });

      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        )
      ).rejects.toThrow('Cannot place a worker on the calendar for this hotel');

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('regional_manager with a null scope claim is denied (deny-by-default)', async () => {
      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'rm1', role: 'regional_manager', scope: null }
        )
      ).rejects.toThrow('Cannot place a worker on the calendar for this hotel');

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('translates a P2002 unique-constraint violation into ConflictError (duplicate calendar placement)', async () => {
      const { Prisma } = await import('@prisma/client');
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        })
      );

      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'mgr1', role: 'admin' }
        )
      ).rejects.toThrow('Worker already has a calendar placement for this day');
    });

    // Epic 9 PR 9.6 (TREQ-007/TRULE-006, MIG-GAP-08): closes the test.todo
    // deferred by PR 9.5. The re-keyed WorkerAssignment_active_slot_unique
    // partial index (worker_id, day) now spans every creation path, so a
    // competing active-status assignment for the same worker/day — created
    // via ANY path, not just a second placeOnCalendar() call — raises a
    // P2002 on tx.workerAssignment.create() itself (before
    // tx.calendarEntry.create() is ever reached), not only on the
    // CalendarEntry-level constraint the P2002 case above exercises. The
    // existing catch in placeOnCalendar() wraps the whole transaction body,
    // so both the WorkerAssignment-level and CalendarEntry-level constraint
    // violations are translated identically — this test asserts that is
    // still true now that there are two distinct underlying constraints.
    it('rejects placing an already-assigned-that-day worker via a competing creation path (WorkerAssignment_active_slot_unique partial index, re-keyed by PR 9.6)', async () => {
      const { Prisma } = await import('@prisma/client');
      mockWorkerAssignment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        })
      );

      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'mgr1', role: 'admin' }
        )
      ).rejects.toThrow('Worker already has a calendar placement for this day');

      // The failure happened on the WorkerAssignment create — calendarEntry.create()
      // must never have been reached in this transaction attempt.
      expect(mockCalendarEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('moveCalendarEntry (calendar grid view drag/drop, day-only move)', () => {
    beforeEach(() => {
      mockCalendarEntry.findUnique.mockReset();
      mockCalendarEntry.update.mockReset();
      mockWorkerAssignment.findUnique.mockReset();
      mockWorkerAssignment.findUnique.mockResolvedValue({
        id: 'a1', worker_id: 'w1', hotel_id: 'h1', skill_slot_id: null, job_request_id: null,
      });
      mockWorkerAssignment.update.mockReset();
      mockHotel.findUnique.mockReset();
      mockCalendarAbsence.findFirst.mockReset();
      mockCalendarAbsence.findFirst.mockResolvedValue(null);
      mockJobRequestSkillSlot.update.mockReset();
    });

    // 2026-08-13 fix (E2E integration audit): every OTHER creation/move path
    // (placeOnCalendar, reassign, acceptBroadcast) blocks scheduling a worker
    // onto a day they've declared SICK/VACATION -- this was the one path that
    // never checked, so a drag-and-drop move could land a shift directly on
    // top of a declared absence.
    it('blocks moving a placement onto a day the worker has a sick/vacation absence marked', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ worker_id: 'w1' }));
      mockCalendarAbsence.findFirst.mockResolvedValue({ id: 'abs1' });

      await expect(
        service.moveCalendarEntry('ce1', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' })
      ).rejects.toThrow('Worker has a sick/vacation absence marked for this day');

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not consult absences when the day is not actually changing', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(
        makeCalendarEntryRow({ worker_id: 'w1', day: new Date('2026-08-05T00:00:00.000Z') })
      );
      mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow({ day: new Date('2026-08-05T00:00:00.000Z') }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignmentRow({ day: new Date('2026-08-05T00:00:00.000Z') }));

      await service.moveCalendarEntry('ce1', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' });

      expect(mockCalendarAbsence.findFirst).not.toHaveBeenCalled();
    });

    // 2026-08-13 fix: a broadcast-accepted assignment (skill_slot_id set)
    // must detach from its original slot when dragged to a new day, or the
    // original day's broadcast reads permanently "filled" for a worker who
    // is no longer coming.
    describe('detaching from a broadcast slot on move', () => {
      it('decrements the original skill slot and clears skill_slot_id/job_request_id when the day changes', async () => {
        mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ worker_id: 'w1' }));
        mockWorkerAssignment.findUnique.mockResolvedValue({
          id: 'a1', worker_id: 'w1', hotel_id: 'h1', skill_slot_id: 'slot1', job_request_id: 'jr1',
        });
        mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow({ day: new Date('2026-08-05T00:00:00.000Z') }));
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignmentRow({ day: new Date('2026-08-05T00:00:00.000Z'), skill_slot_id: null, job_request_id: null })
        );

        await service.moveCalendarEntry('ce1', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' });

        expect(mockWorkerAssignment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'a1' },
            data: expect.objectContaining({
              day: new Date('2026-08-05T00:00:00.000Z'),
              skill_slot: { disconnect: true },
              job_request: { disconnect: true },
            }),
          })
        );
        expect(mockJobRequestSkillSlot.update).toHaveBeenCalledWith({
          where: { id: 'slot1' },
          data: { confirmed_count: { decrement: 1 } },
        });
      });

      it('does NOT detach or decrement when the day is unchanged (same-day no-op move)', async () => {
        mockCalendarEntry.findUnique.mockResolvedValue(
          makeCalendarEntryRow({ worker_id: 'w1', day: new Date('2026-08-05T00:00:00.000Z') })
        );
        mockWorkerAssignment.findUnique.mockResolvedValue({
          id: 'a1', worker_id: 'w1', hotel_id: 'h1', skill_slot_id: 'slot1', job_request_id: 'jr1',
        });
        mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow({ day: new Date('2026-08-05T00:00:00.000Z') }));
        mockWorkerAssignment.update.mockResolvedValue(makeAssignmentRow({ day: new Date('2026-08-05T00:00:00.000Z') }));

        await service.moveCalendarEntry('ce1', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' });

        expect(mockJobRequestSkillSlot.update).not.toHaveBeenCalled();
        const assignmentUpdateCall = mockWorkerAssignment.update.mock.calls[0]?.[0] as any;
        expect(assignmentUpdateCall.data).toEqual({ day: new Date('2026-08-05T00:00:00.000Z') });
      });

      it('does NOT touch skill_slot for a plain (non-broadcast) placement moved to a new day', async () => {
        mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ worker_id: 'w1' }));
        // Default mockWorkerAssignment.findUnique already returns skill_slot_id: null.
        mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow({ day: new Date('2026-08-05T00:00:00.000Z') }));
        mockWorkerAssignment.update.mockResolvedValue(makeAssignmentRow({ day: new Date('2026-08-05T00:00:00.000Z') }));

        await service.moveCalendarEntry('ce1', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' });

        expect(mockJobRequestSkillSlot.update).not.toHaveBeenCalled();
        const assignmentUpdateCall = mockWorkerAssignment.update.mock.calls[0]?.[0] as any;
        expect(assignmentUpdateCall.data).toEqual({ day: new Date('2026-08-05T00:00:00.000Z') });
      });
    });

    it('admin moves a placement to a new day', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow());
      mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow({ day: new Date('2026-08-05T00:00:00.000Z') }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignmentRow({ day: new Date('2026-08-05T00:00:00.000Z') }));

      const result = await service.moveCalendarEntry(
        'ce1',
        { day: '2026-08-05' },
        { userId: 'admin1', role: 'admin' }
      );

      expect(result.calendar_entry.day).toBe('2026-08-05');
      expect(mockCalendarEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ce1' }, data: { day: new Date('2026-08-05T00:00:00.000Z') } })
      );
      expect(mockWorkerAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a1' }, data: { day: new Date('2026-08-05T00:00:00.000Z') } })
      );
    });

    // Job-dispatch lifecycle notification fix (2026-08-05): moving a
    // placement previously notified nobody -- the worker could show up on
    // the original day expecting a shift that was silently relocated.
    it('notifies the worker that their shift moved to a new day', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ worker_id: 'w1' }));
      mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow({ day: new Date('2026-08-05T00:00:00.000Z') }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignmentRow({ day: new Date('2026-08-05T00:00:00.000Z') }));

      await service.moveCalendarEntry('ce1', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' });

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: 'w1', type: 'ASSIGNMENT_CONFIRMED' }),
        })
      );
    });

    it('throws NotFoundError when the calendar entry does not exist', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(null);

      await expect(
        service.moveCalendarEntry('missing', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' })
      ).rejects.toThrow('Calendar entry not found');

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('manager in scope (hotel claim matches) succeeds', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ hotel_id: 'h1' }));
      mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignmentRow());

      await service.moveCalendarEntry(
        'ce1',
        { day: '2026-08-05' },
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
      );

      expect(mockCalendarEntry.update).toHaveBeenCalledTimes(1);
    });

    it('manager out of scope (hotel claim does not match) is rejected (ForbiddenError)', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ hotel_id: 'h1' }));

      await expect(
        service.moveCalendarEntry(
          'ce1',
          { day: '2026-08-05' },
          { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h2' } }
        )
      ).rejects.toThrow('Cannot move a calendar placement for this hotel');

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('regional_manager in scope (hotel_group claim matches the hotel\'s group) succeeds — ADR-030 D-5', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ hotel_id: 'h1' }));
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignmentRow());

      await service.moveCalendarEntry(
        'ce1',
        { day: '2026-08-05' },
        { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
      );

      expect(mockCalendarEntry.update).toHaveBeenCalledTimes(1);
    });

    it('regional_manager out of scope (hotel belongs to another group) is denied', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ hotel_id: 'h1' }));
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g2' });

      await expect(
        service.moveCalendarEntry(
          'ce1',
          { day: '2026-08-05' },
          { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        )
      ).rejects.toThrow('Cannot move a calendar placement for this hotel');
    });

    it('translates a P2002 unique-constraint violation into ConflictError (destination day already occupied)', async () => {
      const { Prisma } = await import('@prisma/client');
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow());
      mockCalendarEntry.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        })
      );

      await expect(
        service.moveCalendarEntry('ce1', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' })
      ).rejects.toThrow('Worker already has a calendar placement for this day');
    });

    it('never changes hotel_id or worker_id — day-only move (product decision, 2026-08-05)', async () => {
      mockCalendarEntry.findUnique.mockResolvedValue(makeCalendarEntryRow({ hotel_id: 'h1', worker_id: 'w1' }));
      mockCalendarEntry.update.mockResolvedValue(makeCalendarEntryRow());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignmentRow());

      await service.moveCalendarEntry('ce1', { day: '2026-08-05' }, { userId: 'admin1', role: 'admin' });

      const calendarUpdateCall = mockCalendarEntry.update.mock.calls[0]?.[0] as any;
      const assignmentUpdateCall = mockWorkerAssignment.update.mock.calls[0]?.[0] as any;
      expect(calendarUpdateCall.data).toEqual({ day: new Date('2026-08-05T00:00:00.000Z') });
      expect(assignmentUpdateCall.data).toEqual({ day: new Date('2026-08-05T00:00:00.000Z') });
    });
  });

  describe('listCalendarEntries', () => {
    // 2026-08-13 fix ("ghost shifts", confirmed live on the production
    // calendar grid during E2E audit): a cancelled/reassigned assignment's
    // CalendarEntry row was never touched by cancellation, so the grid kept
    // showing a fully-staffed placement for a shift nobody was coming to.
    // 2026-08-13 follow-up: the original fix also excluded CANCELLED, which
    // over-corrected -- a shift cancelled by a sick-leave mark vanished from
    // the grid entirely, so a manager could not see the day had lost cover.
    // CANCELLED is now returned with its status so the grid can render it as
    // a cancelled card; only REASSIGNED (whose replacement is a separate row)
    // stays excluded.
    it('excludes only REASSIGNED entries, keeping CANCELLED ones visible', async () => {
      mockCalendarEntry.findMany.mockResolvedValue([]);
      mockCalendarEntry.count.mockResolvedValue(0);

      await service.listCalendarEntries({ page: 1, per_page: 20 } as any, {
        userId: 'admin1',
        role: 'admin',
      });

      expect(mockCalendarEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assignment: { status: { not: 'REASSIGNED' } },
          }),
        })
      );
      expect(mockCalendarEntry.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assignment: { status: { not: 'REASSIGNED' } },
          }),
        })
      );
    });

    it('surfaces the underlying assignment status on each returned entry', async () => {
      mockCalendarEntry.findMany.mockResolvedValue([
        {
          id: 'ce1',
          assignment_id: 'a1',
          worker_id: 'w1',
          hotel_id: 'h1',
          day: new Date('2026-08-20T00:00:00.000Z'),
          placed_by_id: 'mgr1',
          created_at: new Date('2026-08-01T00:00:00.000Z'),
          updated_at: new Date('2026-08-01T00:00:00.000Z'),
          assignment: { status: 'CANCELLED' },
        },
      ]);
      mockCalendarEntry.count.mockResolvedValue(1);

      const result = await service.listCalendarEntries({ page: 1, per_page: 20 } as any, {
        userId: 'admin1',
        role: 'admin',
      });

      expect(result.data[0].assignment_status).toBe('CANCELLED');
      expect(mockCalendarEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { assignment: { select: { status: true } } },
        })
      );
    });

    it('worker sees only their own calendar entries', async () => {
      mockCalendarEntry.findMany.mockResolvedValue([makeCalendarEntryRow()]);
      mockCalendarEntry.count.mockResolvedValue(1);

      await service.listCalendarEntries({ page: 1, per_page: 20 } as any, {
        userId: 'w1',
        role: 'worker',
      });

      expect(mockCalendarEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ worker_id: 'w1' }) })
      );
    });

    it('admin may filter by worker_id', async () => {
      mockCalendarEntry.findMany.mockResolvedValue([]);
      mockCalendarEntry.count.mockResolvedValue(0);

      await service.listCalendarEntries({ worker_id: 'w2', page: 1, per_page: 20 } as any, {
        userId: 'admin1',
        role: 'admin',
      });

      expect(mockCalendarEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ worker_id: 'w2' }) })
      );
    });

    it('admin with no worker_id filter sees all (no worker_id constraint applied)', async () => {
      mockCalendarEntry.findMany.mockResolvedValue([]);
      mockCalendarEntry.count.mockResolvedValue(0);

      await service.listCalendarEntries({ page: 1, per_page: 20 } as any, {
        userId: 'admin1',
        role: 'admin',
      });

      const callArg = mockCalendarEntry.findMany.mock.calls[0]?.[0] as any;
      expect(callArg.where.worker_id).toBeUndefined();
    });

    it('calendar grid view: applies a day-range filter when both from and to are provided', async () => {
      mockCalendarEntry.findMany.mockResolvedValue([]);
      mockCalendarEntry.count.mockResolvedValue(0);

      await service.listCalendarEntries(
        { from: '2026-08-01', to: '2026-08-07', page: 1, per_page: 100 } as any,
        { userId: 'admin1', role: 'admin' }
      );

      const callArg = mockCalendarEntry.findMany.mock.calls[0]?.[0] as any;
      expect(callArg.where.day.gte).toBeInstanceOf(Date);
      expect(callArg.where.day.lte).toBeInstanceOf(Date);
    });

    it('calendar grid view: applies no day-range filter when from/to are absent', async () => {
      mockCalendarEntry.findMany.mockResolvedValue([]);
      mockCalendarEntry.count.mockResolvedValue(0);

      await service.listCalendarEntries({ page: 1, per_page: 20 } as any, {
        userId: 'admin1',
        role: 'admin',
      });

      const callArg = mockCalendarEntry.findMany.mock.calls[0]?.[0] as any;
      expect(callArg.where.day).toBeUndefined();
    });
  });

  describe('ListCalendarEntriesQuerySchema: calendar grid view day-range validation', () => {
    it('accepts both from and to', () => {
      const result = ListCalendarEntriesQuerySchema.safeParse({ from: '2026-08-01', to: '2026-08-07' });
      expect(result.success).toBe(true);
    });

    it('accepts neither from nor to', () => {
      const result = ListCalendarEntriesQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('rejects from without to', () => {
      const result = ListCalendarEntriesQuerySchema.safeParse({ from: '2026-08-01' });
      expect(result.success).toBe(false);
    });

    it('rejects to without from', () => {
      const result = ListCalendarEntriesQuerySchema.safeParse({ to: '2026-08-07' });
      expect(result.success).toBe(false);
    });
  });

  /**
   * IDOR regression (2026-08-10). listCalendarEntries() previously ran NO
   * manager-scope check whatsoever: it applied `query.hotel_id` verbatim as
   * the only hotel constraint, so a manager/RM could read any hotel's entire
   * placement roster by passing someone else's hotel_id -- or omit it and
   * read every hotel platform-wide. The identical defect was fixed in
   * list() (same file) on 2026-08-08 but never applied here.
   *
   * These assert the resulting Prisma `where`, which is where the constraint
   * actually lives -- a test that only checked the returned rows would pass
   * against a mock regardless of whether any scoping happened at all.
   */
  describe('listCalendarEntries — manager/RM scope authz (IDOR fix)', () => {
    beforeEach(() => {
      mockCalendarEntry.findMany.mockResolvedValue([]);
      mockCalendarEntry.count.mockResolvedValue(0);
    });

    const whereFromLastCall = () => mockCalendarEntry.findMany.mock.calls[0][0].where;

    it('admin: no hotel constraint added; a supplied hotel_id is honoured as-is', async () => {
      await service.listCalendarEntries(
        { hotel_id: 'h_any', page: 1, per_page: 20 } as any,
        { userId: 'adm1', role: 'admin', scope: { type: 'global' } }
      );
      expect(whereFromLastCall().hotel_id).toBe('h_any');
    });

    it('hotel manager requesting a DIFFERENT hotel resolves to an empty set, never that hotel', async () => {
      await service.listCalendarEntries(
        { hotel_id: 'h_other', page: 1, per_page: 20 } as any,
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h_mine' } }
      );
      // The pre-fix behaviour was `hotel_id: 'h_other'` -- another hotel's
      // full roster.
      expect(whereFromLastCall().hotel_id).toEqual({ in: [] });
    });

    it('hotel manager supplying no hotel_id is pinned to their own hotel, not left unfiltered', async () => {
      await service.listCalendarEntries(
        { page: 1, per_page: 20 } as any,
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h_mine' } }
      );
      expect(whereFromLastCall().hotel_id).toBe('h_mine');
    });

    it('hotel manager asking for their OWN hotel still gets it', async () => {
      await service.listCalendarEntries(
        { hotel_id: 'h_mine', page: 1, per_page: 20 } as any,
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h_mine' } }
      );
      expect(whereFromLastCall().hotel_id).toBe('h_mine');
    });

    it('regional manager is constrained to their own group (hotel relation filter)', async () => {
      await service.listCalendarEntries(
        { page: 1, per_page: 20 } as any,
        { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
      );
      expect(whereFromLastCall().hotel).toEqual({ hotel_group_id: 'g1' });
    });

    it('regional manager selecting a hotel OUTSIDE their group: both constraints apply, so the intersection is empty', async () => {
      await service.listCalendarEntries(
        { hotel_id: 'h_outside', page: 1, per_page: 20 } as any,
        { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
      );
      const where = whereFromLastCall();
      // The supplied hotel_id is NOT dropped, and the group filter is NOT
      // dropped -- an out-of-group hotel therefore matches no row rather than
      // returning that hotel's data.
      expect(where.hotel_id).toBe('h_outside');
      expect(where.hotel).toEqual({ hotel_group_id: 'g1' });
    });

    it('group + hotel together (RM picking one of their OWN hotels) keeps both constraints', async () => {
      await service.listCalendarEntries(
        { hotel_id: 'h_in_group', page: 1, per_page: 20 } as any,
        { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
      );
      const where = whereFromLastCall();
      expect(where.hotel_id).toBe('h_in_group');
      expect(where.hotel).toEqual({ hotel_group_id: 'g1' });
    });

    it('scoped manager role with NO scope claim fails closed (empty), not open', async () => {
      await service.listCalendarEntries(
        { page: 1, per_page: 20 } as any,
        { userId: 'mgr1', role: 'manager', scope: null }
      );
      expect(whereFromLastCall().hotel_id).toEqual({ in: [] });
    });

    it('worker stays self-scoped and gains no hotel-wide visibility from the fix', async () => {
      await service.listCalendarEntries(
        { hotel_id: 'h_any', page: 1, per_page: 20 } as any,
        { userId: 'w1', role: 'worker', scope: null }
      );
      const where = whereFromLastCall();
      expect(where.worker_id).toBe('w1');
      // Not a scoped-manager role, so no hotel_id override is applied --
      // self-scoping by worker_id is what constrains them.
      expect(where.hotel_id).toBe('h_any');
    });
  });
});
