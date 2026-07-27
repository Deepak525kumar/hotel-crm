import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * SPEC-CALENDAR-001 REQ-CAL-T03/T04/T08 (narrow ADR-021 slice, GD-18).
 *
 * Covers the worker self-mark sick/vacation capability: past-day rejection,
 * upsert-by-(worker,day), auto-cancel of an existing same-day assignment via
 * AssignmentService.update() (not a direct Calendar write, per ADR-021), and
 * best-effort manager notification via the worker's Hotel Group's Regional
 * Manager (EmploymentRecord/HotelGroup -- HotelWorker is retired, ADR-022).
 */

const mockCalendarAbsence = {
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  upsert: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockWorkerAssignment = {
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockUser = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockHotelGroup = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockRating = {
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockAttendance = {
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockWorkerOverallRating = {
  upsert: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockAuditLog = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  calendarAbsence: mockCalendarAbsence,
  workerAssignment: mockWorkerAssignment,
  user: mockUser,
  employmentRecord: mockEmploymentRecord,
  hotelGroup: mockHotelGroup,
  rating: mockRating,
  attendance: mockAttendance,
  workerOverallRating: mockWorkerOverallRating,
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: mockAuditLog,
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));
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

import { CalendarService } from '../modules/calendar/service.js';

function fixedToday(isoDate: string) {
  // Anchors "today" (Europe/Berlin) for deterministic past/future assertions
  // without relying on the real system clock.
  const real = Intl.DateTimeFormat;
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({ format: () => isoDate }) as any);
  return () => {
    (Intl.DateTimeFormat as any) = real;
  };
}

describe('CalendarService.markAbsence', () => {
  let service: CalendarService;
  let restoreClock: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalendarService();
    restoreClock = fixedToday('2026-07-27');
    mockCalendarAbsence.upsert.mockResolvedValue({
      id: 'abs1',
      worker_id: 'w1',
      day: new Date('2026-07-28T00:00:00.000Z'),
      kind: 'SICK',
      created_at: new Date('2026-07-27T00:00:00.000Z'),
      updated_at: new Date('2026-07-27T00:00:00.000Z'),
    });
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockEmploymentRecord.findUnique.mockResolvedValue(null);
    mockUser.findUnique.mockResolvedValue({ first_name: 'Ada', last_name: 'Lovelace' });
  });

  afterEach(() => restoreClock());

  it('rejects marking a past day', async () => {
    await expect(
      service.markAbsence('w1', { day: '2026-07-26', kind: 'SICK' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
    expect(mockCalendarAbsence.upsert).not.toHaveBeenCalled();
  });

  it('allows marking today', async () => {
    await expect(
      service.markAbsence('w1', { day: '2026-07-27', kind: 'VACATION' })
    ).resolves.toBeDefined();
  });

  it('upserts by (worker_id, day) and returns the DTO', async () => {
    const result = await service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' });
    expect(mockCalendarAbsence.upsert.mock.calls[0][0].where).toEqual({
      worker_id_day: { worker_id: 'w1', day: new Date('2026-07-28T00:00:00.000Z') },
    });
    expect(result).toMatchObject({ id: 'abs1', worker_id: 'w1', kind: 'SICK', day: '2026-07-28' });
  });

  // The spec's transition model (MODULE_SPEC.md:199, RULE-CAL-03) only
  // states (none) -> sick|vacation; it is silent on changing an
  // already-marked day's kind. REQ-CAL-T03's "no cap, no approval" intent
  // supports allowing the worker to freely correct their own mark, so this
  // pins the chosen (not spec-mandated) behavior: last write wins via
  // upsert, rather than rejecting a kind change outright.
  it('overwrites kind when re-marking an already-marked day (last write wins, not spec-mandated but consistent with no-approval intent)', async () => {
    mockCalendarAbsence.upsert.mockResolvedValue({
      id: 'abs1',
      worker_id: 'w1',
      day: new Date('2026-07-28T00:00:00.000Z'),
      kind: 'VACATION',
      created_at: new Date('2026-07-27T00:00:00.000Z'),
      updated_at: new Date('2026-07-27T00:00:00.000Z'),
    });
    await service.markAbsence('w1', { day: '2026-07-28', kind: 'VACATION' });

    mockCalendarAbsence.upsert.mockResolvedValue({
      id: 'abs1',
      worker_id: 'w1',
      day: new Date('2026-07-28T00:00:00.000Z'),
      kind: 'SICK',
      created_at: new Date('2026-07-27T00:00:00.000Z'),
      updated_at: new Date('2026-07-27T00:00:00.000Z'),
    });
    const result = await service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' });

    expect(mockCalendarAbsence.upsert).toHaveBeenNthCalledWith(2, {
      where: { worker_id_day: { worker_id: 'w1', day: new Date('2026-07-28T00:00:00.000Z') } },
      create: { worker_id: 'w1', day: new Date('2026-07-28T00:00:00.000Z'), kind: 'SICK' },
      update: { kind: 'SICK' },
    });
    expect(result.kind).toBe('SICK');
  });

  it('auto-cancels an existing same-day CONFIRMED/IN_PROGRESS assignment via AssignmentService.update (no direct Calendar write)', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({
      id: 'a1',
      worker_id: 'w1',
      status: 'CONFIRMED',
    });
    mockWorkerAssignment.findUnique.mockResolvedValue({
      id: 'a1',
      status: 'CONFIRMED',
      worker_id: 'w1',
      hotel_id: 'h1',
    });
    mockWorkerAssignment.update.mockResolvedValue({
      id: 'a1',
      status: 'CANCELLED',
      worker_id: 'w1',
      hotel_id: 'h1',
      work_request_id: 'wr1',
      assigned_by_id: 'mgr1',
      application_id: 'app1',
      confirmed_at: new Date(),
      started_at: null,
      completed_at: null,
      cancelled_at: new Date(),
      cancellation_reason: 'Worker marked sick/vacation',
      updated_at: new Date(),
    });
    mockRating.aggregate.mockResolvedValue({ _avg: { score: 0 }, _count: 0 });
    mockWorkerAssignment.count.mockResolvedValue(0);
    mockAttendance.count.mockResolvedValue(0 as never);

    await service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' });

    expect(mockWorkerAssignment.update).toHaveBeenCalledTimes(1);
    const call = mockWorkerAssignment.update.mock.calls[0][0];
    expect(call.data.status).toBe('CANCELLED');
  });

  it('does not touch WorkerAssignment when no same-day assignment exists', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    await service.markAbsence('w1', { day: '2026-07-28', kind: 'VACATION' });
    expect(mockWorkerAssignment.update).not.toHaveBeenCalled();
  });

  it('notifies the worker\'s Hotel Group Regional Manager when an active EmploymentRecord exists', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
    mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: 'rm1' });
    mockNotification.create.mockResolvedValue({ id: 'n1' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'o1' });

    await service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' });

    expect(mockNotification.create).toHaveBeenCalledTimes(1);
    expect(mockNotification.create.mock.calls[0][0].data.user_id).toBe('rm1');
    expect(mockNotification.create.mock.calls[0][0].data.type).toBe('CALENDAR_ABSENCE_MARKED');
  });

  it('skips notification when the worker has no ACTIVE EmploymentRecord (no manager to notify)', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue(null);
    await service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' });
    expect(mockNotification.create).not.toHaveBeenCalled();
  });

  // Architecture-review finding: RULE-CAL-04/RULE-CAL-07 (MODULE_SPEC.md:214)
  // say a downstream auto-cancel failure is reconciled at the assignment
  // locus, not by Calendar -- it must never mask a successful mark, nor
  // block the (separately best-effort) manager notification.
  it('still returns the recorded mark and still notifies the manager when auto-cancel throws', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1', worker_id: 'w1', status: 'CONFIRMED' });
    mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', status: 'CONFIRMED', worker_id: 'w1' });
    mockWorkerAssignment.update.mockRejectedValue(new Error('db exploded'));
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
    mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: 'rm1' });
    mockNotification.create.mockResolvedValue({ id: 'n1' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'o1' });

    const result = await service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' });

    expect(result).toMatchObject({ id: 'abs1', kind: 'SICK' });
    expect(mockNotification.create).toHaveBeenCalledTimes(1);
  });

  it('still notifies the manager when the auto-cancel lookup itself throws', async () => {
    mockWorkerAssignment.findFirst.mockRejectedValue(new Error('db exploded'));
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
    mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: 'rm1' });
    mockNotification.create.mockResolvedValue({ id: 'n1' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'o1' });

    await expect(
      service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' })
    ).resolves.toBeDefined();
    expect(mockNotification.create).toHaveBeenCalledTimes(1);
  });
});

describe('CalendarService.getOwnAbsences', () => {
  let service: CalendarService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalendarService();
  });

  it('scopes strictly to the given worker_id', async () => {
    mockCalendarAbsence.findMany.mockResolvedValue([]);
    await service.getOwnAbsences('w1');
    expect(mockCalendarAbsence.findMany.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
  });
});

describe('CalendarService.getAvailability (REQ-CAL-T06/RULE-CAL-08, ADR-021)', () => {
  let service: CalendarService;
  let restoreClock: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalendarService();
    restoreClock = fixedToday('2026-07-27');
    mockUser.findUnique.mockResolvedValue({ id: 'w1' });
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockCalendarAbsence.findUnique.mockResolvedValue(null);
  });

  afterEach(() => restoreClock());

  it('returns available=true when the worker has no same-day assignment and no absence mark', async () => {
    const result = await service.getAvailability('w1', { userId: 'w1', role: 'worker' });
    expect(result).toEqual({ worker_id: 'w1', available: true });
  });

  it('is today-only: reads today\'s date regardless of any other input', async () => {
    await service.getAvailability('w1', { userId: 'w1', role: 'worker' });
    expect(mockWorkerAssignment.findFirst.mock.calls[0][0].where.work_request.shift_date).toEqual(
      new Date('2026-07-27T00:00:00.000Z')
    );
    expect(mockCalendarAbsence.findUnique.mock.calls[0][0].where).toEqual({
      worker_id_day: { worker_id: 'w1', day: new Date('2026-07-27T00:00:00.000Z') } ,
    });
  });

  it('returns available=false when assigned today (CONFIRMED/IN_PROGRESS)', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1' });
    const result = await service.getAvailability('w1', { userId: 'w1', role: 'worker' });
    expect(result.available).toBe(false);
  });

  it('returns available=false when marked sick/vacation today', async () => {
    mockCalendarAbsence.findUnique.mockResolvedValue({ id: 'abs1' });
    const result = await service.getAvailability('w1', { userId: 'w1', role: 'worker' });
    expect(result.available).toBe(false);
  });

  it('throws NotFoundError when the worker does not exist', async () => {
    mockUser.findUnique.mockResolvedValue(null);
    await expect(
      service.getAvailability('missing', { userId: 'admin1', role: 'admin' })
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  describe('permission matrix', () => {
    it('always allows a worker to read their own availability', async () => {
      await expect(
        service.getAvailability('w1', { userId: 'w1', role: 'worker' })
      ).resolves.toBeDefined();
    });

    it('denies a worker reading another worker\'s availability', async () => {
      await expect(
        service.getAvailability('w2', { userId: 'w1', role: 'worker' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows admin unconditionally, cross-hotel', async () => {
      await expect(
        service.getAvailability('w1', { userId: 'admin1', role: 'admin' })
      ).resolves.toBeDefined();
    });

    // MODULE_SPEC.md's own matrix marks checker "(scope)" here, not "(all)"
    // like admin -- and no checker-scope model exists anywhere in this
    // codebase to resolve that against. This must NOT reuse
    // resolveHotelAccess()'s admin/checker cross-hotel bypass, which exists
    // for a different (hotel-centric, quality-review) reason; denying here
    // is failing closed on an open decision, not a gap.
    it('denies checker (no checker-scope model exists; spec marks this "(scope)", not "(all)")', async () => {
      await expect(
        service.getAvailability('w1', { userId: 'c1', role: 'checker' })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows a manager whose scope covers the worker\'s Hotel Group', async () => {
      mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const result = await service.getAvailability('w1', {
        userId: 'm1',
        role: 'manager',
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      });
      expect(result).toBeDefined();
    });

    it('denies a manager whose scope does not cover the worker\'s Hotel Group', async () => {
      mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      await expect(
        service.getAvailability('w1', {
          userId: 'm1',
          role: 'manager',
          scope: { type: 'hotel_group', hotel_group_id: 'g_other' },
        })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('denies a manager with no scope claim', async () => {
      mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      await expect(
        service.getAvailability('w1', { userId: 'm1', role: 'manager', scope: null })
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows a regional_manager whose group scope covers the worker (ADR-030 D-5)', async () => {
      mockEmploymentRecord.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const result = await service.getAvailability('w1', {
        userId: 'rm1',
        role: 'regional_manager',
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      });
      expect(result).toBeDefined();
    });
  });
});
