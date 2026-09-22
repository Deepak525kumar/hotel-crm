import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  // list()/getById() now nest hotel details in the DTO so a worker can see
  // where their shift is; default to "no hotels resolved", which leaves
  // AssignmentDto.hotel null exactly as it is for a row whose hotel was
  // deleted.
  findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
};

const mockRating = {
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerOverallRating = {
  upsert: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockAttendance = {
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  // Cancelling or sweeping a shift closes its EXPECTED attendance row.
  updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockJobRequestSkillSlot = {
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// isWorkerEligibleForHotel() (roster-scope.ts) now checks the hotel
// blocklist (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06) -- default to
// "not blocked" so existing eligibility-path tests don't need to know
// about the blocklist unless they're specifically testing it.
const mockEmployeeBlocklistEntry = {
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
};

const mockJobRequest = {
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  // Batched shift-time lookup for a page of assignments. Empty = calendar-placed
  // rows, which have a day and no times.
  findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
};

// Critical fix (2026-08-08): reassign() now checks isWorkerAbsentOnDay()
// before reassigning to a new worker -- default to "no absence marked".
const mockCalendarAbsence = {
  findFirst: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
};

// getById()/list() now attach a logged rooms-completed entry, if any
// (2026-08-09) -- default to "none logged yet" so existing fixtures don't
// need to know about it unless a test specifically exercises the field.
const mockRoomsCompletedEntry = {
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
};

// reassign() retires the outgoing worker's calendar placement and writes one
// for the incoming worker inside the same transaction; placeOnCalendar()/
// moveCalendarEntry() use the same delegate.
const mockCalendarEntry = {
  create: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ id: 'ce1' }),
  update: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ id: 'ce1' }),
  delete: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ id: 'ce1' }),
  deleteMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue({ count: 1 }),
  findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
};

const mockPrisma = {
  workerAssignment: mockWorkerAssignment,
  calendarEntry: mockCalendarEntry,
  employmentRecord: mockEmploymentRecord,
  employeeBlocklistEntry: mockEmployeeBlocklistEntry,
  calendarAbsence: mockCalendarAbsence,
  roomsCompletedEntry: mockRoomsCompletedEntry,
  hotel: mockHotel,
  // refreshWorkerOverallRating() reads QualityVerification for the quality
  // half of the rating (2026-08-29). Neutral fixture: no checks recorded.
  qualityVerification: { aggregate: async () => ({ _avg: { score: null }, _count: 0 }), findMany: async () => [] },
  rating: mockRating,
  attendance: mockAttendance,
  workerOverallRating: mockWorkerOverallRating,
  jobRequestSkillSlot: mockJobRequestSkillSlot,
  // Early-start guard: resolveScheduledStart() reads the linked JobRequest's
  // shift_date/shift_start_time and the hotel's timezone. Defaults to null (no
  // linked request) so the guard is a no-op for fixtures that don't opt in --
  // matching a calendar-placed assignment, which has no shift time.
  jobRequest: mockJobRequest,
  // assigned_by_name resolution. list() previously touched prisma.user only
  // when a rooms-completed entry existed, so this mock did not need to exist.
  user: {
    findMany: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue([]),
    findUnique: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(null),
  },
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
    // Early-start guard reads this; without it graceMinutes is undefined and
    // `minutesEarly > undefined` is always false, so the guard silently never
    // fires and its tests pass vacuously.
    ATTENDANCE_EARLY_CHECK_IN_GRACE_MINUTES: 120,
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { AssignmentService } from '../modules/assignments/service.js';

const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  work_request_id: 'wr1',
  worker_id: 'w1',
  hotel_id: 'h1',
  assigned_by_id: 'mgr1',
  status: 'CONFIRMED' as const,
  confirmed_at: new Date('2026-06-01T00:00:00Z'),
  started_at: null,
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  previous_assignment_id: null,
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

describe('AssignmentService', () => {
  let service: AssignmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssignmentService();
    mockRating.aggregate.mockResolvedValue({ _avg: { score: 0 }, _count: 0 });
    mockWorkerAssignment.count.mockResolvedValue(0);
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockAttendance.count.mockResolvedValue(0 as never);
    mockWorkerOverallRating.upsert.mockResolvedValue({});
    mockJobRequestSkillSlot.update.mockResolvedValue({});
    mockNotification.create.mockResolvedValue({ id: 'notif-default' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'outbox-default' });
    mockEmployeeBlocklistEntry.findUnique.mockResolvedValue(null);
    // Self-action eligibility (2026-08-07): a worker starting/completing
    // their OWN assignment is now re-checked against isWorkerEligibleForHotel().
    // Default every fixture worker to eligible (ACTIVE, same group as the
    // hotel, not blocklisted) so only tests specifically about losing
    // eligibility need to say otherwise.
    mockEmploymentRecord.findUnique.mockResolvedValue({
      id: 'er1',
      status: 'ACTIVE',
      hotel_group_id: 'g1',
    });
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockCalendarAbsence.findFirst.mockResolvedValue(null);
  });

  describe('update', () => {
    it('throws NotFoundError for unknown assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(service.update('a1', { status: 'IN_PROGRESS' }, 'mgr1', 'manager')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('rejects illegal transition COMPLETED -> IN_PROGRESS', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'COMPLETED' }));
      await expect(
        service.update('a1', { status: 'IN_PROGRESS' }, 'mgr1', 'manager', { type: 'global' })
      ).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('transitions CONFIRMED -> IN_PROGRESS and sets started_at', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS', started_at: new Date() }));
      await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);
      const data = mockWorkerAssignment.update.mock.calls[0][0].data;
      expect(data.status).toBe('IN_PROGRESS');
      expect(data.started_at).toBeInstanceOf(Date);
    });

    // ── Early-start guard (2026-08-07) ────────────────────────────────────
    //
    // A shift could previously be started at any time: ALLOWED_TRANSITIONS
    // validated only the state machine, never the shift's own scheduled
    // start. Shares ATTENDANCE_EARLY_CHECK_IN_GRACE_MINUTES with the
    // attendance check-in guard so both paths answer "how early is too
    // early" identically.
    describe('early-start guard', () => {
      const shiftAt = (offsetMinutes: number) => {
        const d = new Date(Date.now() + offsetMinutes * 60000);
        const pad = (n: number) => String(n).padStart(2, '0');
        return {
          // shift_date is @db.Date -- date-only, read back in UTC.
          shift_date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
          shift_start_time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
        };
      };

      it('rejects starting a shift well before its scheduled start', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
        // UTC hotel so the wall-clock string maps to the instant directly,
        // keeping this test about the guard rather than zone conversion.
        // Same mock serves isWorkerEligibleForHotel (hotel_group_id) and
        // resolveScheduledStart (timezone) -- must satisfy both, since the
        // eligibility check now runs first.
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1', timezone: 'UTC' });
        mockJobRequest.findUnique.mockResolvedValue(shiftAt(300)); // 5h out

        await expect(
          service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true)
        ).rejects.toMatchObject({ name: 'ConflictError' });

        expect(mockWorkerAssignment.update).not.toHaveBeenCalled();
      });

      it('allows starting inside the grace window', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({ status: 'IN_PROGRESS', started_at: new Date() })
        );
        // Same mock serves isWorkerEligibleForHotel (hotel_group_id) and
        // resolveScheduledStart (timezone) -- must satisfy both, since the
        // eligibility check now runs first.
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1', timezone: 'UTC' });
        mockJobRequest.findUnique.mockResolvedValue(shiftAt(60)); // 1h out

        await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);

        expect(mockWorkerAssignment.update).toHaveBeenCalled();
      });

      it('allows starting a shift already underway', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({ status: 'IN_PROGRESS', started_at: new Date() })
        );
        // Same mock serves isWorkerEligibleForHotel (hotel_group_id) and
        // resolveScheduledStart (timezone) -- must satisfy both, since the
        // eligibility check now runs first.
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1', timezone: 'UTC' });
        mockJobRequest.findUnique.mockResolvedValue(shiftAt(-30)); // started 30m ago

        await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);

        expect(mockWorkerAssignment.update).toHaveBeenCalled();
      });

      // A calendar-placed assignment has a day but no time (#365). The guard
      // must skip rather than block -- treating "no time" as "too early"
      // would make those shifts unstartable.
      it('does not apply when the assignment has no linked request (calendar placement)', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(
          makeAssignment({ work_request_id: null, job_request_id: null })
        );
        // The update() result must describe the SAME row that was read: a
        // calendar-placed assignment stays request-less. The default fixture
        // carries work_request_id 'wr1', so returning it here described an
        // assignment that had somehow gained a request mid-update, and the
        // assertion below then failed for a reason the guard has nothing to do
        // with.
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({
            status: 'IN_PROGRESS',
            started_at: new Date(),
            work_request_id: null,
            job_request_id: null,
          })
        );

        await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);

        expect(mockWorkerAssignment.update).toHaveBeenCalled();
        expect(mockJobRequest.findUnique).not.toHaveBeenCalled();
      });

      // The guard governs starting a shift, not finishing or cancelling one.
      it('does not apply to COMPLETED or CANCELLED transitions', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({ status: 'COMPLETED', completed_at: new Date() })
        );
        // Same mock serves isWorkerEligibleForHotel (hotel_group_id) and
        // resolveScheduledStart (timezone) -- must satisfy both, since the
        // eligibility check now runs first.
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1', timezone: 'UTC' });
        mockJobRequest.findUnique.mockResolvedValue(shiftAt(600)); // far future

        await service.update('a1', { status: 'COMPLETED' }, 'w1', 'worker', undefined, true);

        expect(mockWorkerAssignment.update).toHaveBeenCalled();
      });

      // Timezone correctness is the risky part of this guard: shift_start_time
      // is a bare wall-clock "HH:MM", so the same string is a different
      // instant per hotel. A naive UTC read would be wrong by the offset --
      // here 2h in summer, enough to flip the decision.
      it('interprets shift_start_time in the hotel timezone, not UTC', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({ status: 'IN_PROGRESS', started_at: new Date() })
        );
        // 12:00 in Europe/Berlin on 2026-07-01 is 10:00 UTC (CEST, +2).
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1', timezone: 'Europe/Berlin' });
        mockJobRequest.findUnique.mockResolvedValue({
          shift_date: new Date(Date.UTC(2026, 6, 1)),
          shift_start_time: '12:00',
        });

        // Freeze "now" at 09:30 UTC -- 30 minutes before the shift's true
        // 10:00 UTC start, so inside the window. Read as UTC instead, the
        // start would look like 12:00 UTC (2h30m out) and be rejected.
        const realNow = Date.now;
        Date.now = () => Date.UTC(2026, 6, 1, 9, 30);
        try {
          await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);
        } finally {
          Date.now = realNow;
        }

        expect(mockWorkerAssignment.update).toHaveBeenCalled();
      });
    });

    // ── Self-action eligibility (2026-08-07) ──────────────────────────────
    //
    // The eligibility check previously ran only when a worker acted on
    // SOMEONE ELSE's assignment (`if (assignment.worker_id !== actorId)`), so
    // acting on your own -- the common case -- skipped it entirely. A worker
    // who had since been deactivated, or blocklisted at this hotel, could
    // still start and complete the shift. Both verified reachable before the
    // fix.
    describe('self-action eligibility', () => {
      it('blocks a DEACTIVATED worker from starting their own shift', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue({
          id: 'er1',
          status: 'DEACTIVATED',
          hotel_group_id: 'g1',
        });

        await expect(
          service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true)
        ).rejects.toMatchObject({ name: 'ForbiddenError' });

        expect(mockWorkerAssignment.update).not.toHaveBeenCalled();
      });

      // The sharper case: EmployeeBlocklistEntry enforcement was wired into
      // isWorkerEligibleForHotel() (REQ-EMP-005 / RULE-EMP-07) specifically so
      // a blocked worker could not work that hotel. This path bypassed it.
      it('blocks a worker blocklisted at this hotel from starting their own shift', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
        mockEmployeeBlocklistEntry.findUnique.mockResolvedValue({ id: 'blocked' });

        await expect(
          service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true)
        ).rejects.toMatchObject({ name: 'ForbiddenError' });

        expect(mockWorkerAssignment.update).not.toHaveBeenCalled();
      });

      it('blocks an ineligible worker from completing their own shift', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(
          makeAssignment({ worker_id: 'w1', status: 'IN_PROGRESS' })
        );
        mockEmployeeBlocklistEntry.findUnique.mockResolvedValue({ id: 'blocked' });

        await expect(
          service.update('a1', { status: 'COMPLETED' }, 'w1', 'worker', undefined, true)
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
      });

      // Deliberately NOT gated. A worker who has lost eligibility must still
      // be able to drop the shift -- blocking that would strand the
      // assignment CONFIRMED with nobody able to release it.
      it('still allows an ineligible worker to CANCEL their own shift', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({ worker_id: 'w1', status: 'CANCELLED', cancelled_at: new Date() })
        );
        mockEmployeeBlocklistEntry.findUnique.mockResolvedValue({ id: 'blocked' });

        await service.update('a1', { status: 'CANCELLED' }, 'w1', 'worker');

        expect(mockWorkerAssignment.update).toHaveBeenCalled();
      });

      it('allows an eligible worker to start their own shift (no regression)', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({ worker_id: 'w1', status: 'IN_PROGRESS', started_at: new Date() })
        );

        await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);

        expect(mockWorkerAssignment.update).toHaveBeenCalled();
      });
    });

    it('transitions IN_PROGRESS -> COMPLETED and sets completed_at', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'COMPLETED', completed_at: new Date() }));
      await service.update('a1', { status: 'COMPLETED' }, 'w1', 'worker', undefined, true);
      const data = mockWorkerAssignment.update.mock.calls[0][0].data;
      expect(data.status).toBe('COMPLETED');
      expect(data.completed_at).toBeInstanceOf(Date);
    });

    it('cancels with reason and sets cancelled_at', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(
        makeAssignment({ status: 'CANCELLED', cancellation_reason: 'sick' })
      );
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      const data = mockWorkerAssignment.update.mock.calls[0][0].data;
      expect(data.status).toBe('CANCELLED');
      expect(data.cancelled_at).toBeInstanceOf(Date);
      expect(data.cancellation_reason).toBe('sick');
    });

    // Attendance is created EXPECTED when the shift is assigned and was only
    // ever moved by a check-in, so a cancelled shift left attendance asserting
    // the worker was still expected -- permanently, and visibly wrong on the
    // worker's own attendance list.
    it('excuses the attendance row when the shift is cancelled', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));

      await service.update('a1', { status: 'CANCELLED' }, 'mgr1', 'manager', { type: 'global' });

      expect(mockAttendance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignment_id: 'a1', status: 'EXPECTED' },
          data: expect.objectContaining({ status: 'EXCUSED' }),
        })
      );
    });

    // A shift cancelled after the worker already checked in must keep its
    // PRESENT/LATE evidence -- hence the EXPECTED-only where clause.
    it('scopes the attendance close to EXPECTED rows only', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));

      await service.update('a1', { status: 'CANCELLED' }, 'mgr1', 'manager', { type: 'global' });

      const where = mockAttendance.updateMany.mock.calls[0][0].where;
      expect(where.status).toBe('EXPECTED');
    });

    it('leaves attendance alone when a shift is completed rather than cancelled', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'COMPLETED' }));

      await service.update('a1', { status: 'COMPLETED' }, 'mgr1', 'manager', { type: 'global' });

      expect(mockAttendance.updateMany).not.toHaveBeenCalled();
    });

    // Audit-trail fix (2026-08-05): cancellation_reason was saved to the row
    // but never surfaced in the audit log's details.
    it('includes cancellation_reason in the audit log details when cancelling', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(
        makeAssignment({ status: 'CANCELLED', cancellation_reason: 'sick' })
      );
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'UPDATE_ASSIGNMENT',
            details: expect.objectContaining({ cancellation_reason: 'sick' }),
          }),
        })
      );
    });

    it('does not include a cancellation_reason key in the audit log details for a non-cancelling transition', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
      await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);
      const call = mockPrisma.auditLog.create.mock.calls.find(
        (c: any) => c[0].data.action === 'UPDATE_ASSIGNMENT'
      );
      expect(call?.[0].data.details).not.toHaveProperty('cancellation_reason');
    });

    // Job-dispatch lifecycle audit fix (2026-08-05): cancelling a
    // broadcast-accept assignment must free up the slot it claimed, or a
    // headcount-N slot gets stuck permanently "full" after a cancellation.
    it('decrements JobRequestSkillSlot.confirmed_count when cancelling a broadcast-accept assignment (skill_slot_id set)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ skill_slot_id: 'slot1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED', skill_slot_id: 'slot1' }));
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      expect(mockJobRequestSkillSlot.update).toHaveBeenCalledWith({
        where: { id: 'slot1' },
        data: { confirmed_count: { decrement: 1 } },
      });
    });

    it('does not touch JobRequestSkillSlot when cancelling a calendar-placed assignment (skill_slot_id null)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ skill_slot_id: null }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      expect(mockJobRequestSkillSlot.update).not.toHaveBeenCalled();
    });

    it('does not decrement JobRequestSkillSlot.confirmed_count on completion, only on cancellation', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(
        makeAssignment({ status: 'IN_PROGRESS', skill_slot_id: 'slot1' })
      );
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'COMPLETED', skill_slot_id: 'slot1' }));
      await service.update('a1', { status: 'COMPLETED' }, 'w1', 'worker', undefined, true);
      expect(mockJobRequestSkillSlot.update).not.toHaveBeenCalled();
    });

    // Job-dispatch lifecycle notification fix (2026-08-05): a cancelled
    // assignment previously notified nobody at all.
    describe('cancellation notifications', () => {
      it('notifies the worker when a manager cancels their assignment', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(
          makeAssignment({ worker_id: 'w1', assigned_by_id: 'mgr1' })
        );
        mockWorkerAssignment.update.mockResolvedValue(
          makeAssignment({ status: 'CANCELLED', cancellation_reason: 'sick' })
        );
        await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
          type: 'global',
        });
        expect(mockNotification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ user_id: 'w1', type: 'ASSIGNMENT_CANCELLED' }),
          })
        );
      });

      it('notifies the assigning manager (not the worker) when the worker cancels their own assignment', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(
          makeAssignment({ worker_id: 'w1', assigned_by_id: 'mgr1' })
        );
        mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));
        await service.update('a1', { status: 'CANCELLED' }, 'w1', 'worker');
        expect(mockNotification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ user_id: 'mgr1', type: 'ASSIGNMENT_CANCELLED' }),
          })
        );
        expect(mockNotification.create).not.toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ user_id: 'w1' }) })
        );
      });

      it('sends no cancellation notification for a non-cancelling transition', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
        mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
        await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);
        expect(mockNotification.create).not.toHaveBeenCalled();
      });
    });

    // GD-04: this endpoint mutates the fields WorkerOverallRating derives
    // from, so it must recompute the aggregate itself (see SIR-QUAL-005).
    it('refreshes WorkerOverallRating when a transition completes the assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'COMPLETED' }));
      await service.update('a1', { status: 'COMPLETED' }, 'w1', 'worker', undefined, true);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockWorkerOverallRating.upsert).toHaveBeenCalledTimes(1);
      expect(mockWorkerOverallRating.upsert.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    });

    it('refreshes WorkerOverallRating when a transition cancels the assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'CONFIRMED', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));
      await service.update('a1', { status: 'CANCELLED', cancellation_reason: 'sick' }, 'mgr1', 'manager', {
        type: 'global',
      });
      expect(mockWorkerOverallRating.upsert).toHaveBeenCalledTimes(1);
      expect(mockWorkerOverallRating.upsert.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    });

    it('does not refresh WorkerOverallRating for a transition that does not affect the aggregate (CONFIRMED -> IN_PROGRESS)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'CONFIRMED', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'IN_PROGRESS' }));
      await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);
      expect(mockWorkerOverallRating.upsert).not.toHaveBeenCalled();
    });

    // Pins SPEC-JOB-DISPATCH-001's RULE-008/REQ-040 terminal-state rule —
    // see SIR-JOBD-007 for why this makes the GD-04 recompute condition safe.
    it('rejects a same-status update, so completed_at cannot change without also recomputing the aggregate', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'COMPLETED', worker_id: 'w1' }));
      await expect(
        service.update('a1', { status: 'COMPLETED' }, 'mgr1', 'manager', { type: 'global' })
      ).rejects.toMatchObject({
        name: 'ConflictError',
      });
      expect(mockWorkerAssignment.update).not.toHaveBeenCalled();
    });
  });

  // Job-dispatch lifecycle feature (2026-08-05): atomic reassign.
  describe('reassign', () => {
    beforeEach(() => {
      // Defaults: new worker eligible at the hotel (ACTIVE EmploymentRecord,
      // matching hotel_group) and free that day.
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockWorkerAssignment.findFirst.mockResolvedValue(null);
      mockWorkerAssignment.create.mockImplementation(async ({ data }: any) => ({
        id: 'a2',
        ...data,
        confirmed_at: new Date('2026-08-05T00:00:00Z'),
        started_at: null,
        completed_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        updated_at: new Date('2026-08-05T00:00:00Z'),
      }));
    });

    it('throws NotFoundError for an unknown assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('rejects reassigning a COMPLETED assignment (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'COMPLETED' }));
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects reassigning an already-CANCELLED assignment (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'CANCELLED' }));
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('rejects reassigning to the same worker already on the assignment (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
      await expect(
        service.reassign('a1', { worker_id: 'w1' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('rejects a new worker who is not roster-eligible at the hotel (ForbiddenError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockEmploymentRecord.findUnique.mockResolvedValue(null);
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects a new worker who already has an assignment that day (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'other' });
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
    });

    // Critical fix (2026-08-08): "a worker should not be allowed to be
    // placed if he has applied sick or holiday for the specific date".
    it('rejects a new worker who has a SICK/VACATION absence marked for that day (ConflictError)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockCalendarAbsence.findFirst.mockResolvedValue({ id: 'abs1' });
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
      expect(mockWorkerAssignment.create).not.toHaveBeenCalled();
    });

    it('a manager in scope succeeds', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ hotel_id: 'h9' }));
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const result = await service.reassign(
        'a1',
        { worker_id: 'w2' },
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h9' } }
      );
      expect(result.new_assignment.worker_id).toBe('w2');
    });

    it('a manager out of scope is denied (ForbiddenError), before touching the transaction', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ hotel_id: 'h9' }));
      await expect(
        service.reassign(
          'a1',
          { worker_id: 'w2' },
          { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('sets the old assignment to REASSIGNED and creates a new CONFIRMED one chained via previous_assignment_id', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ id: 'a1', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ id: 'a1', status: 'REASSIGNED' }));

      const result = await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });

      expect(mockWorkerAssignment.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { status: 'REASSIGNED' },
      });
      expect(mockWorkerAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          worker_id: 'w2',
          assigned_by_id: 'mgr1',
          status: 'CONFIRMED',
          previous_assignment_id: 'a1',
        }),
      });
      expect(result.old_assignment.status).toBe('REASSIGNED');
      expect(result.new_assignment.worker_id).toBe('w2');
    });

    it('retires the outgoing worker\'s calendar placement before writing the incoming one', async () => {
      // CalendarEntry is @@unique([worker_id, day]) and the old assignment is
      // only marked REASSIGNED, never deleted -- so its entry outlives the
      // status change. Leaving it behind kept the old worker rendered on the
      // calendar grid (double-counting staffing for the day) and occupied
      // (old_worker, day) forever, so reassigning a shift back to that worker
      // on that day tripped the unique constraint and surfaced as a false
      // "already has an assignment for this day" 409 -- isWorkerFreeOnDay()
      // reads WorkerAssignment, where REASSIGNED counts as free, so nothing
      // else caught the contradiction.
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ id: 'a1', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ id: 'a1', status: 'REASSIGNED' }));
      mockWorkerAssignment.create.mockResolvedValue(makeAssignment({ id: 'a2', worker_id: 'w2' }));

      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });

      expect(mockCalendarEntry.deleteMany).toHaveBeenCalledWith({
        where: { assignment_id: 'a1' },
      });
      expect(mockCalendarEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ assignment_id: 'a2', worker_id: 'w2' }),
      });
      // Order matters: creating before deleting would trip the unique
      // constraint whenever both placements land on the same day.
      const deleteOrder = mockCalendarEntry.deleteMany.mock.invocationCallOrder[0];
      const createOrder = mockCalendarEntry.create.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(createOrder);
    });

    it('inherits hotel_id, day, job_request_id, work_request_id, and skill_slot_id from the old assignment unchanged', async () => {
      // The service reads these from tx.workerAssignment.update()'s RETURN
      // VALUE (oldAssignment), not from the earlier findUnique() lookup --
      // both mocks must agree, but update()'s is what the create() call
      // actually inherits from.
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ hotel_id: 'h1' }));
      mockWorkerAssignment.update.mockResolvedValue(
        makeAssignment({
          status: 'REASSIGNED',
          hotel_id: 'h1',
          day: new Date('2026-08-10T00:00:00.000Z'),
          job_request_id: 'jr1',
          work_request_id: null,
          skill_slot_id: 'slot1',
        })
      );

      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });
      // Refreshes BOTH workers as of 2026-08-07: total_assignments counts a
      // worker's rows regardless of status, so the NEW worker's fresh
      // CONFIRMED row is aggregate-affecting too -- and without it a worker
      // whose only activity is being reassigned onto shifts never gets a
      // WorkerOverallRating row at all (the upsert is its only creator).

      expect(mockWorkerAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          hotel_id: 'h1',
          day: expect.any(Date),
          job_request_id: 'jr1',
          work_request_id: null,
          skill_slot_id: 'slot1',
        }),
      });
      // Reassignment does NOT free the slot -- it changes who fills it, not
      // whether it's filled (contrast with Bug 3's cancel-path decrement).
      expect(mockJobRequestSkillSlot.update).not.toHaveBeenCalled();
    });

    it('recomputes WorkerOverallRating for the OLD worker (their completion rate must reflect the terminal outcome)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ status: 'REASSIGNED' }));
      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });
      expect(mockWorkerOverallRating.upsert).toHaveBeenCalledTimes(2);
      expect(mockWorkerOverallRating.upsert.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    });

    it('logs REASSIGN_ASSIGNMENT with both worker ids and the previous assignment id', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ id: 'a1', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ id: 'a1', status: 'REASSIGNED' }));
      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REASSIGN_ASSIGNMENT',
            resource_type: 'WORKER_ASSIGNMENT',
            details: expect.objectContaining({
              previous_assignment_id: 'a1',
              previous_worker_id: 'w1',
              new_worker_id: 'w2',
            }),
          }),
        })
      );
    });

    it('translates a P2002 (new worker double-booked, lost the race) into ConflictError', async () => {
      const { Prisma } = await import('@prisma/client');
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockWorkerAssignment.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        })
      );
      await expect(
        service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    // Job-dispatch lifecycle notification fix (2026-08-05): both affected
    // workers were previously left uninformed.
    it('notifies the old worker (shift reassigned away) and the new worker (shift assigned to them)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ id: 'a1', worker_id: 'w1' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ id: 'a1', status: 'REASSIGNED' }));
      await service.reassign('a1', { worker_id: 'w2' }, { userId: 'mgr1', role: 'admin' });

      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: 'w1', type: 'ASSIGNMENT_CANCELLED' }),
        })
      );
      expect(mockNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: 'w2', type: 'ASSIGNMENT_CONFIRMED' }),
        })
      );
    });
  });

  describe('list', () => {
    it('scopes worker to own assignments', async () => {
      mockWorkerAssignment.findMany.mockResolvedValue([makeAssignment()]);
      mockWorkerAssignment.count.mockResolvedValue(1);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
      const where = mockWorkerAssignment.findMany.mock.calls[0][0].where;
      expect(where.worker_id).toBe('w1');
    });

    // The worker could not see WHERE or WHEN their shift was: the DTO carried
    // only ids and a status, and /crm/hotels/:id 403s for a worker assigned to
    // that hotel while /crm/hotels returns an empty list for them (verified
    // against a running backend). So the hotel is nested here instead, scoped
    // by the ownership gate this method already applies.
    describe('shift details (hotel, day, times, assigner)', () => {
      const HOTEL = {
        id: 'h1', name: 'Downtown Hotel', address: '1 Main St', city: 'Berlin',
        country: 'Germany', timezone: 'Europe/Berlin', latitude: null, longitude: null,
        contact_phone: null, contact_email: null,
      };

      it('nests the hotel a worker is assigned to', async () => {
        mockWorkerAssignment.findMany.mockResolvedValue([makeAssignment({ hotel_id: 'h1' })]);
        mockWorkerAssignment.count.mockResolvedValue(1);
        mockHotel.findMany.mockResolvedValue([HOTEL]);

        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });

        expect(res.data[0].hotel).toEqual(HOTEL);
      });

      it('exposes the calendar day, which the row always carried', async () => {
        mockWorkerAssignment.findMany.mockResolvedValue([
          makeAssignment({ day: new Date('2026-08-19T00:00:00.000Z') }),
        ]);
        mockWorkerAssignment.count.mockResolvedValue(1);

        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });

        // Formatted from the UTC-midnight @db.Date, so it is the stored day and
        // not shifted by the server's timezone.
        expect(res.data[0].day).toBe('2026-08-19');
      });

      it('leaves times null for a calendar-placed shift rather than inventing them', async () => {
        // Times live on JobRequest; a calendar placement has none.
        mockWorkerAssignment.findMany.mockResolvedValue([
          makeAssignment({ work_request_id: null, job_request_id: null }),
        ]);
        mockWorkerAssignment.count.mockResolvedValue(1);
        mockJobRequest.findMany.mockResolvedValue([]);

        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });

        expect(res.data[0].shift_start_time).toBeNull();
        expect(res.data[0].shift_end_time).toBeNull();
      });

      it('returns the shift times when the assignment came from a request', async () => {
        mockWorkerAssignment.findMany.mockResolvedValue([
          makeAssignment({ job_request_id: 'jr1' }),
        ]);
        mockWorkerAssignment.count.mockResolvedValue(1);
        mockJobRequest.findMany.mockResolvedValue([
          { id: 'jr1', shift_start_time: '08:00', shift_end_time: '16:00' },
        ]);

        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });

        expect(res.data[0].shift_start_time).toBe('08:00');
        expect(res.data[0].shift_end_time).toBe('16:00');
      });

      it('batches the lookups — one query per page, not per row', async () => {
        // Three rows at the same hotel must not become three hotel queries.
        mockWorkerAssignment.findMany.mockResolvedValue([
          makeAssignment({ id: 'a1', hotel_id: 'h1' }),
          makeAssignment({ id: 'a2', hotel_id: 'h1' }),
          makeAssignment({ id: 'a3', hotel_id: 'h1' }),
        ]);
        mockWorkerAssignment.count.mockResolvedValue(3);
        mockHotel.findMany.mockClear();
        mockHotel.findMany.mockResolvedValue([HOTEL]);

        await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });

        expect(mockHotel.findMany).toHaveBeenCalledTimes(1);
        expect(mockHotel.findMany.mock.calls[0][0].where.id.in).toEqual(['h1']);
      });

      it('leaves hotel null when the hotel no longer resolves', async () => {
        mockWorkerAssignment.findMany.mockResolvedValue([makeAssignment({ hotel_id: 'gone' })]);
        mockWorkerAssignment.count.mockResolvedValue(1);
        mockHotel.findMany.mockResolvedValue([]);

        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });

        expect(res.data[0].hotel).toBeNull();
      });
    });

    // Regression: the web assignment page does
    // `mutate(updated, { revalidate: false })` -- it writes the mutation
    // response into the SWR cache and does NOT refetch. With only the read
    // paths enriched, every detail field blanked out the moment a worker
    // tapped Start or Complete.
    it('update() returns the same hotel and day as a read', async () => {
      const row = makeAssignment({ hotel_id: 'h1', day: new Date('2026-08-19T00:00:00.000Z') });
      mockWorkerAssignment.findUnique.mockResolvedValue(row);
      mockWorkerAssignment.update.mockResolvedValue(row);
      mockHotel.findUnique.mockResolvedValue({
        id: 'h1', name: 'Downtown Hotel', address: '1 Main St', city: 'Berlin',
        country: 'Germany', timezone: 'Europe/Berlin', latitude: null, longitude: null,
        contact_phone: null, contact_email: null,
      });

      const dto = await service.update('a1', { status: 'IN_PROGRESS' } as any, 'admin1', 'admin');

      expect(dto.hotel?.name).toBe('Downtown Hotel');
      expect(dto.day).toBe('2026-08-19');
    });

    it('does not scope admin', async () => {
      mockWorkerAssignment.findMany.mockResolvedValue([]);
      mockWorkerAssignment.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });
      const where = mockWorkerAssignment.findMany.mock.calls[0][0].where;
      expect(where.worker_id).toBeUndefined();
    });

    // IDOR fix (2026-08-08): list() previously ran no manager-scope check at
    // all -- update()/reassign()/placeOnCalendar() in this file already
    // scope a manager/regional_manager, but list() let a manager read every
    // assignment platform-wide.
    describe('manager/regional_manager scope (IDOR fix, 2026-08-08)', () => {
      it("scopes a hotel-scoped manager's list to their own hotel only", async () => {
        mockWorkerAssignment.findMany.mockResolvedValue([]);
        mockWorkerAssignment.count.mockResolvedValue(0);
        await service.list({ page: 1, per_page: 20 } as any, {
          userId: 'mgr1',
          role: 'manager',
          scope: { type: 'hotel', hotel_id: 'h1' },
        });
        const where = mockWorkerAssignment.findMany.mock.calls[0][0].where;
        expect(where.hotel_id).toBe('h1');
      });

      it("scopes a regional_manager's list to their hotel_group only", async () => {
        mockWorkerAssignment.findMany.mockResolvedValue([]);
        mockWorkerAssignment.count.mockResolvedValue(0);
        await service.list({ page: 1, per_page: 20 } as any, {
          userId: 'rm1',
          role: 'regional_manager',
          scope: { type: 'hotel_group', hotel_group_id: 'g1' },
        });
        const where = mockWorkerAssignment.findMany.mock.calls[0][0].where;
        expect(where.hotel).toEqual({ hotel_group_id: 'g1' });
      });

      it('denies (empty-in) a manager with no scope claim', async () => {
        mockWorkerAssignment.findMany.mockResolvedValue([]);
        mockWorkerAssignment.count.mockResolvedValue(0);
        await service.list({ page: 1, per_page: 20 } as any, {
          userId: 'mgr1',
          role: 'manager',
          scope: null,
        });
        const where = mockWorkerAssignment.findMany.mock.calls[0][0].where;
        expect(where.hotel_id).toEqual({ in: [] });
      });
    });
  });

  describe('getById', () => {
    it('throws NotFoundError for missing assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(service.getById('a1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('allows worker to view own assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
      const dto = await service.getById('a1', { userId: 'w1', role: 'worker' });
      expect(dto.id).toBe('a1');
    });

    /**
     * `worker_name` was DECLARED on the enrichment result and never assigned
     * (2026-09-23): enrichContext() resolved the hotel, the shift times and
     * the assigner's name, and left the assigned person's name undefined. The
     * manager app's assignment detail therefore showed a hotel and a status
     * and no person at all -- reported as the detail screen being "empty".
     *
     * `assigned_by_name` asserted alongside it on purpose: it was correct,
     * and it is the reason nobody noticed. A screen with three of four names
     * filled in looks like a rendering bug, not a missing query.
     */
    it('resolves the assigned worker\'s name, not just the assigner\'s', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1' }));
      mockPrisma.user.findUnique.mockImplementation((args: any) =>
        Promise.resolve(
          args.where.id === 'w1'
            ? { first_name: 'Ada', last_name: 'Lovelace' }
            : { first_name: 'Grace', last_name: 'Hopper' }
        )
      );

      const dto = await service.getById('a1', { userId: 'w1', role: 'worker' });

      expect(dto.worker_name).toBe('Ada Lovelace');
      expect(dto.assigned_by_name).toBe('Grace Hopper');
    });

    // IDOR fix (2026-08-08): hotel eligibility answers "could this worker be
    // assigned here", never "is this worker's assignment" -- so ownership,
    // not eligibility, is the gate.
    describe('ownership gate (IDOR fix)', () => {
      it('allows a worker to read their OWN assignment regardless of eligibility state (positive ownership case)', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1', hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue(null);
        const dto = await service.getById('a1', { userId: 'w1', role: 'worker' });
        expect(dto.id).toBe('a1');
      });

      it('denies a worker reading another worker\'s assignment even with a matching EmploymentRecord group', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        await expect(service.getById('a1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });

      it('denies a checker reading another worker\'s assignment (checker is self-scoped in this module)', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        await expect(service.getById('a1', { userId: 'c1', role: 'checker' })).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });

      it('denies a worker with no EmploymentRecord reading another worker\'s assignment (deny-by-default, unchanged)', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue(null);
        await expect(service.getById('a1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });
    });

    // IDOR fix (2026-08-08): getById() previously ran no manager-scope check
    // at all -- a manager/RM could read any single assignment by id, unscoped.
    describe('manager/regional_manager scope (IDOR fix, 2026-08-08)', () => {
      it('allows a manager to read an in-scope assignment', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1' }));
        const dto = await service.getById('a1', {
          userId: 'mgr1',
          role: 'manager',
          scope: { type: 'hotel', hotel_id: 'h1' },
        });
        expect(dto.id).toBe('a1');
      });

      it('denies a manager reading an out-of-scope assignment', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h9' }));
        await expect(
          service.getById('a1', { userId: 'mgr1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } })
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
      });

      it("allows a regional_manager to read an assignment in their hotel_group", async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h9' }));
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        const dto = await service.getById('a1', {
          userId: 'rm1',
          role: 'regional_manager',
          scope: { type: 'hotel_group', hotel_group_id: 'g1' },
        });
        expect(dto.id).toBe('a1');
      });

      it('denies a manager with no scope claim (deny-by-default)', async () => {
        mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1' }));
        await expect(
          service.getById('a1', { userId: 'mgr1', role: 'manager', scope: null })
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
      });
    });
  });

  // IDOR fix (2026-08-08): mirrors the getById ownership gate above for
  // update()'s worker-branch check.
  describe('update — ownership gate (IDOR fix)', () => {
    it('allows a worker to update their OWN assignment (positive ownership case)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w1', hotel_id: 'h1', status: 'CONFIRMED' }));
      mockWorkerAssignment.update.mockResolvedValue(makeAssignment({ worker_id: 'w1', hotel_id: 'h1', status: 'IN_PROGRESS' }));
      // Self-action eligibility (separate, pre-existing check for IN_PROGRESS/
      // COMPLETED transitions) still requires an eligible worker -- this
      // fixture is eligible so the test isolates the ownership gate itself.
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const dto = await service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true);
      expect(dto.status).toBe('IN_PROGRESS');
    });

    it('denies a worker updating another worker\'s assignment even with a matching EmploymentRecord group', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1', status: 'CONFIRMED' }));
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      await expect(
        service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
      expect(mockWorkerAssignment.update).not.toHaveBeenCalled();
    });

    it('denies a checker updating another worker\'s assignment (checker is self-scoped in this module)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1', status: 'CONFIRMED' }));
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      await expect(
        service.update('a1', { status: 'IN_PROGRESS' }, 'c1', 'checker')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('denies a worker with no EmploymentRecord updating another worker\'s assignment (deny-by-default, unchanged)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ worker_id: 'w2', hotel_id: 'h1', status: 'CONFIRMED' }));
      mockEmploymentRecord.findUnique.mockResolvedValue(null);
      await expect(
        service.update('a1', { status: 'IN_PROGRESS' }, 'w1', 'worker', undefined, true)
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });
  });

  // Epic 9 PR 9.3 (TREQ-012): WorkerAssignment gains a nullable job_request_id
  // FK, repointing it off the removed application_id (PR 9.2). No creation
  // path writes this column yet (PR 9.9 is the first writer); this pins the
  // schema-level fact so a future change can't silently drop or tighten it
  // ahead of that landing. Mirrors user-permissions-column-dropped.test.ts's
  // file-parsing convention for schema-shape assertions.
  describe('Epic 9 PR 9.3: WorkerAssignment.job_request_id', () => {
    it('the Prisma schema declares job_request_id as a nullable field on WorkerAssignment', () => {
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const schema = fs.readFileSync(schemaPath, 'utf8');

      const modelMatch = schema.match(/model WorkerAssignment \{([\s\S]*?)\n\}/);
      expect(modelMatch).not.toBeNull();

      const modelBody = modelMatch![1];
      expect(modelBody).toMatch(/^\s*job_request_id\s+String\?\s*$/m);
    });

    it('no longer declares an application_id field on WorkerAssignment (PR 9.2)', () => {
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const schema = fs.readFileSync(schemaPath, 'utf8');

      const modelMatch = schema.match(/model WorkerAssignment \{([\s\S]*?)\n\}/);
      expect(modelMatch).not.toBeNull();

      const modelBody = modelMatch![1];
      expect(modelBody).not.toMatch(/^\s*application_id\b/m);
    });

    it('a migration exists that adds the job_request_id column to WorkerAssignment', () => {
      const migrationsDir = path.join(__dirname, '../../prisma/migrations');
      const migrationDirs = fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory());

      const addMigration = migrationDirs.find((dir) => {
        const sqlPath = path.join(migrationsDir, dir.name, 'migration.sql');
        if (!fs.existsSync(sqlPath)) return false;
        const sql = fs.readFileSync(sqlPath, 'utf8');
        return /ADD COLUMN\s+"job_request_id"/i.test(sql);
      });

      expect(addMigration).toBeDefined();
    });
  });

  // Epic 9 PR 9.5 (MIG-GAP-03 correction): WorkerAssignment.work_request_id is
  // relaxed from mandatory to nullable in this PR's own migration (paired
  // with the CalendarEntry add). Regression guard for the null-safety pass
  // this made necessary in toDto()'s existing DTO mapping — a calendar-placed
  // (or, later, broadcast-accept) row with a null work_request_id must map
  // cleanly through list()/getById() without throwing or coercing null to a
  // string.
  describe('Epic 9 PR 9.5: work_request_id null-safety regression guard', () => {
    it('the Prisma schema declares work_request_id as nullable on WorkerAssignment', () => {
      const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
      const schema = fs.readFileSync(schemaPath, 'utf8');

      const modelMatch = schema.match(/model WorkerAssignment \{([\s\S]*?)\n\}/);
      expect(modelMatch).not.toBeNull();

      const modelBody = modelMatch![1];
      expect(modelBody).toMatch(/^\s*work_request_id\s+String\?\s*$/m);
    });

    it('a migration exists that relaxes work_request_id to nullable', () => {
      const migrationsDir = path.join(__dirname, '../../prisma/migrations');
      const migrationDirs = fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory());

      const relaxMigration = migrationDirs.find((dir) => {
        const sqlPath = path.join(migrationsDir, dir.name, 'migration.sql');
        if (!fs.existsSync(sqlPath)) return false;
        const sql = fs.readFileSync(sqlPath, 'utf8');
        return /ALTER COLUMN\s+"work_request_id"\s+DROP NOT NULL/i.test(sql);
      });

      expect(relaxMigration).toBeDefined();
    });

    it('getById maps a work_request_id: null row through toDto without error', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ work_request_id: null }));
      const dto = await service.getById('a1', { userId: 'a1', role: 'admin' });
      expect(dto.work_request_id).toBeNull();
    });

    it('list maps a mix of null and non-null work_request_id rows through toDto', async () => {
      mockWorkerAssignment.findMany.mockResolvedValue([
        makeAssignment({ id: 'a1', work_request_id: null }),
        makeAssignment({ id: 'a2', work_request_id: 'wr1' }),
      ]);
      mockWorkerAssignment.count.mockResolvedValue(2);
      const { data } = await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });
      expect(data[0].work_request_id).toBeNull();
      expect(data[1].work_request_id).toBe('wr1');
    });
  });

  describe('sweepNoShows', () => {
    it('only sweeps CONFIRMED assignments, not IN_PROGRESS', async () => {
      mockWorkerAssignment.findMany.mockResolvedValue([]);
      await service.sweepNoShows(3600000, 100);
      
      expect(mockWorkerAssignment.findMany).toHaveBeenCalledWith({
        where: { status: 'CONFIRMED' },
        take: 100,
      });
    });

    it('correctly calculates overnight shift end times', async () => {
      const shiftDate = new Date('2026-08-01T00:00:00Z');
      const assignment = { id: 'a1', status: 'CONFIRMED', worker_id: 'w1', work_request_id: null, job_request_id: 'j1', hotel_id: 'h1', day: shiftDate };
      
      mockWorkerAssignment.findMany.mockResolvedValue([assignment]);
      mockWorkerAssignment.findUnique.mockResolvedValue(assignment);
      
      mockJobRequest.findUnique.mockResolvedValue({
        shift_date: shiftDate,
        shift_start_time: '22:00',
        shift_end_time: '02:00', // Overnight
      });
      
      // Berlin timezone
      mockHotel.findUnique.mockResolvedValue({ timezone: 'Europe/Berlin' });

      // "Now" is 2026-08-02 04:00:00 UTC
      // 02:00 Berlin time on Aug 2nd is 00:00 UTC (assuming DST +02:00).
      // Cutoff is Grace = 1 hr (3600000). Now = 04:00 UTC => cutoff is 03:00 UTC, which is > 00:00 UTC (expired).
      const realNow = Date.now;
      Date.now = () => new Date('2026-08-02T04:00:00Z').getTime();

      try {
        await service.sweepNoShows(3600000, 100);
      } finally {
        Date.now = realNow;
      }

      expect(mockWorkerAssignment.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: expect.objectContaining({ status: 'NO_SHOW' }),
      });
      expect(mockWorkerOverallRating.upsert).toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    // The sweep marked the assignment NO_SHOW but left attendance EXPECTED, so
    // the two views of the same shift disagreed permanently: the schedule said
    // the worker never turned up, attendance said they were still due.
    it('marks the attendance row ABSENT when it sweeps a no-show', async () => {
      const shiftDate = new Date('2026-08-01T00:00:00Z');
      const assignment = { id: 'a1', status: 'CONFIRMED', worker_id: 'w1', work_request_id: null, job_request_id: 'j1', hotel_id: 'h1', day: shiftDate };

      mockWorkerAssignment.findMany.mockResolvedValue([assignment]);
      mockWorkerAssignment.findUnique.mockResolvedValue(assignment);
      mockJobRequest.findUnique.mockResolvedValue({
        shift_date: shiftDate,
        shift_start_time: '22:00',
        shift_end_time: '02:00',
      });
      mockHotel.findUnique.mockResolvedValue({ timezone: 'Europe/Berlin' });

      const realNow = Date.now;
      Date.now = () => new Date('2026-08-02T04:00:00Z').getTime();
      try {
        await service.sweepNoShows(3600000, 100);
      } finally {
        Date.now = realNow;
      }

      expect(mockAttendance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignment_id: 'a1', status: 'EXPECTED' },
          data: expect.objectContaining({ status: 'ABSENT' }),
        })
      );
    });
  });
});
