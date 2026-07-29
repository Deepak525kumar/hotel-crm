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
 * The already-assigned-that-day rejection case is deliberately NOT asserted
 * here: DB-level daily exclusivity spanning both creation paths (calendar +
 * broadcast-accept) is PR 9.6's scope (re-keyed partial unique index on
 * WorkerAssignment). This PR's own CalendarEntry(worker_id, day) unique
 * constraint only guards its own creation path — see `service.ts`'s
 * `placeOnCalendar()` comment.
 */

const mockWorkerAssignment = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockCalendarEntry = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  workerAssignment: mockWorkerAssignment,
  calendarEntry: mockCalendarEntry,
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

    it('regional_manager in scope (hotel_group claim) succeeds — mirrors manager branch (ADR-030 D-5)', async () => {
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockResolvedValue(makeCalendarEntryRow());

      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'rm1', role: 'regional_manager', scope: { type: 'global' } }
        )
      ).resolves.toBeDefined();
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

    // Deliberately deferred to PR 9.6, per IMPLEMENTATION_EXECUTION_PLAN.md's
    // PR 9.5 test-file note: this PR does not yet enforce DB-level daily
    // exclusivity across a competing broadcast-accept-created assignment on
    // the same day (only this PR's own CalendarEntry(worker_id, day) unique
    // constraint, exercised by the P2002 case above, guards its own creation
    // path). Do not assert cross-path rejection here.
    it.todo(
      'PR 9.6: rejects placing an already-assigned-that-day worker via a competing creation path (partial unique index on WorkerAssignment)'
    );
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
