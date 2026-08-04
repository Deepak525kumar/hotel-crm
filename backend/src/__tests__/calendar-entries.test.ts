import { describe, it, expect, jest, beforeEach } from '@jest/globals';

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
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockCalendarEntry = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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

const mockPrisma = {
  workerAssignment: mockWorkerAssignment,
  calendarEntry: mockCalendarEntry,
  hotel: mockHotel,
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

  describe('listCalendarEntries', () => {
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
  });
});
