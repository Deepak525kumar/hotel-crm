import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../lib/utils.js', () => ({
  ...(jest.requireActual('../lib/utils.js') as object),
  todayInCalendarTimezone: () => '2020-01-01',
}));

/**
 * Epic 9 PR 9.6 (TREQ-007/TRULE-006, MIG-GAP-08): daily-exclusivity partial
 * unique index (re-keyed WorkerAssignment_active_slot_unique on
 * (worker_id, day), spanning every WorkerAssignment creation path).
 *
 * This suite mocks Prisma rather than hitting a real DB (this repo's
 * established pattern — every other test file in this suite does the same;
 * see calendar-entries.test.ts's own header note). "DB-level" here means
 * asserting the P2002-translation code path fires correctly when the mocked
 * Prisma client throws the constraint-violation error shape Postgres would
 * raise for a real partial-unique-index violation, mirroring the
 * P2002-simulation pattern already established by
 * assignments-rooms-completed.test.ts and calendar-entries.test.ts.
 *
 * Two creation paths are exercised:
 *   1. placeOnCalendar() (this PR's own follow-up write) — a second
 *      same-day active assignment for the same worker is rejected at the
 *      constraint layer (retroactively completing PR 9.5's deferred case;
 *      also covered directly in calendar-entries.test.ts).
 *   2. isWorkerFreeOnDay() — the new read-side exclusivity-check helper this
 *      PR adds (ready for PR 9.7's eligibility computation to import; PR
 *      9.7's own broadcast/eligibility logic is explicitly out of scope
 *      here).
 */

const mockWorkerAssignment = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  // refreshWorkerOverallRating() counts a worker's rows (quality/service.ts:41).
  count: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(0),
};

const mockCalendarEntry = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// placeOnCalendar() now calls isWorkerEligibleForHotel() unconditionally
// (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06 — previously only the
// ACTING manager's own hotel scope was checked, never the placed worker's
// eligibility at all). Default every fixture worker to ACTIVE in the same
// group as hotel h1, not blocklisted, so this file's existing
// exclusivity-focused tests don't need to separately stub eligibility.
const mockEmploymentRecord = {
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({
    status: 'ACTIVE',
    hotel_group_id: 'g1',
    id: 'emp_w1',
  }),
};
const mockHotel = {
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({
    hotel_group_id: 'g1',
  }),
};
const mockEmployeeBlocklistEntry = {
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
};
// Critical fix (2026-08-08): placeOnCalendar() now checks
// isWorkerAbsentOnDay() before creating an assignment.
const mockCalendarAbsence = {
  findFirst: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
};

const mockPrisma = {
  // refreshWorkerOverallRating() (quality/service.ts) now runs inside the
  // assignment-CREATION transactions too, not only on status changes -- the
  // aggregate counts all of a worker's rows regardless of status, so creating
  // one changes it. These mocks back that recompute; the suites below are not
  // about rating maths, so the values are inert.
  rating: { aggregate: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({ _avg: { score: null }, _count: 0 }) },
  attendance: { count: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue(0) },
  workerOverallRating: { upsert: (jest.fn() as jest.MockedFunction<(...a: any[]) => any>).mockResolvedValue({}) },
  workerAssignment: mockWorkerAssignment,
  calendarEntry: mockCalendarEntry,
  employmentRecord: mockEmploymentRecord,
  hotel: mockHotel,
  employeeBlocklistEntry: mockEmployeeBlocklistEntry,
  calendarAbsence: mockCalendarAbsence,
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

import { AssignmentService, isWorkerFreeOnDay, ACTIVE_ASSIGNMENT_STATUSES } from '../modules/assignments/service.js';

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
  day: new Date('2026-08-01T00:00:00.000Z'),
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

describe('Daily-exclusivity partial unique index (PR 9.6)', () => {
  let service: AssignmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.workerAssignment.count.mockResolvedValue(0);
    mockPrisma.rating.aggregate.mockResolvedValue({ _avg: { score: null }, _count: 0 });
    mockPrisma.attendance.count.mockResolvedValue(0);
    mockPrisma.workerOverallRating.upsert.mockResolvedValue({});
    service = new AssignmentService();
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1', id: 'emp_w1' });
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockEmployeeBlocklistEntry.findUnique.mockResolvedValue(null);
  });

  describe('placeOnCalendar() — second same-day active assignment for the same worker', () => {
    it('rejects with ConflictError when the WorkerAssignment_active_slot_unique partial index rejects the create (worker_id, day)', async () => {
      const { Prisma } = await import('@prisma/client');
      mockWorkerAssignment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`worker_id`,`day`)', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['worker_id', 'day'] },
        })
      );

      await expect(
        service.placeOnCalendar(
          { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
          { userId: 'mgr1', role: 'admin' }
        )
      ).rejects.toThrow('Worker already has a calendar placement for this day');

      expect(mockCalendarEntry.create).not.toHaveBeenCalled();
    });

    it('succeeds and writes `day` on the WorkerAssignment row when no conflict exists', async () => {
      mockWorkerAssignment.create.mockResolvedValue(makeAssignmentRow());
      mockCalendarEntry.create.mockResolvedValue(makeCalendarEntryRow());

      await service.placeOnCalendar(
        { worker_id: 'w1', hotel_id: 'h1', day: '2026-08-01' },
        { userId: 'mgr1', role: 'admin' }
      );

      expect(mockWorkerAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          worker_id: 'w1',
          day: new Date('2026-08-01T00:00:00.000Z'),
        }),
      });
    });

    it('still translates a P2002 raised on the CalendarEntry-level constraint (regression: catch must not have narrowed to only the new constraint)', async () => {
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
  });

  describe('isWorkerFreeOnDay() — read-side exclusivity-check helper (ready for PR 9.7)', () => {
    it('returns true when no active-status assignment exists for that worker/day', async () => {
      mockWorkerAssignment.findFirst.mockResolvedValue(null);

      const free = await isWorkerFreeOnDay('w1', new Date('2026-08-01T00:00:00.000Z'));

      expect(free).toBe(true);
      expect(mockWorkerAssignment.findFirst).toHaveBeenCalledWith({
        where: {
          worker_id: 'w1',
          day: new Date('2026-08-01T00:00:00.000Z'),
          status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        },
        select: { id: true },
      });
    });

    it('returns false when an active-status assignment already exists for that worker/day', async () => {
      mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1' });

      const free = await isWorkerFreeOnDay('w1', new Date('2026-08-01T00:00:00.000Z'));

      expect(free).toBe(false);
    });

    it('queries only CONFIRMED and IN_PROGRESS statuses — matches the DB constraint\'s own active-status set', () => {
      expect(ACTIVE_ASSIGNMENT_STATUSES).toEqual(['CONFIRMED', 'IN_PROGRESS']);
    });
  });
});
