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
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  delete: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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
// isHotelInScope()'s hotel_group branch (reached when a MANAGER-initiated
// auto-cancel calls AssignmentService.update()) resolves the assignment's
// own hotel -> group.
const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockRating = {
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};
const mockAttendance = {
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  // Cancelling a shift closes its EXPECTED attendance row.
  updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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
  hotel: mockHotel,
  // refreshWorkerOverallRating() reads QualityVerification for the quality
  // half of the rating (2026-08-29). Neutral fixture: no checks recorded.
  qualityVerification: { aggregate: async () => ({ _avg: { score: null }, _count: 0 }), findMany: async () => [] },
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
  //
  // This is also the overlap guarantee: a worker can never hold both
  // VACATION and SICK on the same day. Two layers enforce it -- the
  // kind-agnostic @@unique([worker_id, day]) in schema.prisma, and this
  // upsert being keyed on that same composite, so a second mark of a
  // DIFFERENT kind replaces the row rather than adding one. (The move path
  // can still collide with an existing row and translates P2002 to
  // ConflictError -- asserted in the moveAbsence suite below.)
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
      create: {
        worker_id: 'w1',
        day: new Date('2026-07-28T00:00:00.000Z'),
        kind: 'SICK',
        reason: null,
        marked_by_id: 'w1',
      },
      update: { kind: 'SICK', reason: null, marked_by_id: 'w1' },
    });
    expect(result.kind).toBe('SICK');
    // Both marks went through upsert on the same composite key -- never a
    // bare create() that could add a second same-day row of the other kind.
    expect(mockCalendarAbsence.upsert).toHaveBeenCalledTimes(2);
    const keys = mockCalendarAbsence.upsert.mock.calls.map((c: any) => c[0].where);
    expect(keys[0]).toEqual(keys[1]);
  });

  // Regression (2026-08-07): the auto-cancel lookup used the legacy
  // `work_request: { shift_date }` join, which never matches a
  // calendar-placed or broadcast-accepted assignment (work_request_id is null
  // on both). A worker marking themselves sick left their shift CONFIRMED and
  // the manager still saw a staffed slot for someone who would not arrive.
  it('looks up the shift to auto-cancel by the denormalized day column, not the work_request relation', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue(null);

    await service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' });

    const where = mockWorkerAssignment.findFirst.mock.calls[0][0].where;
    expect(where.day).toEqual(new Date('2026-07-28T00:00:00.000Z'));
    expect(where.work_request).toBeUndefined();
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

  // Regression (2026-08-08): autoCancelSameDayAssignment() hardcoded
  // (workerId, 'worker') as the actor. AssignmentService.update() branches
  // its cancellation notification on `actorId === assignment.worker_id`
  // ("notify whoever did NOT initiate it"), so when a MANAGER marked a
  // worker sick, that hardcoded actor took the worker-initiated branch:
  // the shift was cancelled and the WORKER was never told, because the code
  // believed they had cancelled it themselves. The real actor is now passed
  // through, so the manager-initiated case notifies the worker.
  it('notifies the WORKER when a manager marks them sick on a day they were assigned', async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
    mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: 'rm1' });
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1', worker_id: 'w1', status: 'CONFIRMED' });
    mockWorkerAssignment.findUnique.mockResolvedValue({
      id: 'a1',
      status: 'CONFIRMED',
      worker_id: 'w1',
      hotel_id: 'h1',
      assigned_by_id: 'mgr_who_placed_it',
    });
    mockWorkerAssignment.update.mockResolvedValue({
      id: 'a1',
      status: 'CANCELLED',
      worker_id: 'w1',
      hotel_id: 'h1',
      work_request_id: null,
      assigned_by_id: 'mgr_who_placed_it',
      confirmed_at: new Date(),
      started_at: null,
      completed_at: null,
      cancelled_at: new Date(),
      cancellation_reason: 'Marked sick/vacation by a manager',
      updated_at: new Date(),
    });
    mockRating.aggregate.mockResolvedValue({ _avg: { score: 0 }, _count: 0 });
    mockWorkerAssignment.count.mockResolvedValue(0);
    mockAttendance.count.mockResolvedValue(0 as never);
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockNotification.create.mockResolvedValue({ id: 'n1' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'o1' });

    await service.markAbsenceForWorker(
      { worker_id: 'w1', day: '2026-07-28', kind: 'SICK' },
      { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );

    // The shift-cancellation notification must go to the worker, not to
    // whoever originally placed the shift -- the manager initiated this.
    const cancelNotif = mockNotification.create.mock.calls.find(
      (c: any) => c[0].data.type === 'ASSIGNMENT_CANCELLED'
    );
    expect(cancelNotif).toBeDefined();
    expect(cancelNotif![0].data.user_id).toBe('w1');
  });

  it('still notifies the placing manager when the WORKER marks themselves sick (unchanged self-service behaviour)', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1', worker_id: 'w1', status: 'CONFIRMED' });
    mockWorkerAssignment.findUnique.mockResolvedValue({
      id: 'a1',
      status: 'CONFIRMED',
      worker_id: 'w1',
      hotel_id: 'h1',
      assigned_by_id: 'mgr_who_placed_it',
    });
    mockWorkerAssignment.update.mockResolvedValue({
      id: 'a1',
      status: 'CANCELLED',
      worker_id: 'w1',
      hotel_id: 'h1',
      work_request_id: null,
      assigned_by_id: 'mgr_who_placed_it',
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
    mockNotification.create.mockResolvedValue({ id: 'n1' });
    mockOutboxEvent.create.mockResolvedValue({ id: 'o1' });

    await service.markAbsence('w1', { day: '2026-07-28', kind: 'SICK' });

    const cancelNotif = mockNotification.create.mock.calls.find(
      (c: any) => c[0].data.type === 'ASSIGNMENT_CANCELLED'
    );
    expect(cancelNotif).toBeDefined();
    expect(cancelNotif![0].data.user_id).toBe('mgr_who_placed_it');
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
    // `day` echoes back which day the answer is about. It was added with the
    // optional day parameter (2026-09-09) so a caller can never mistake an
    // answer about today for an answer about the day it asked for.
    expect(result).toEqual({ worker_id: 'w1', day: '2026-07-27', available: true });
  });

  /**
   * Defaults to today. Until 2026-09-09 this method was today-ONLY, and this
   * test was named for that; the day parameter below replaced the restriction,
   * not the default. `GET /calendar/availability` passes no day, so the route's
   * behaviour is exactly what it was.
   */
  it('reads today when no day is given', async () => {
    await service.getAvailability('w1', { userId: 'w1', role: 'worker' });
    // Filters on the denormalized `day` column, not the legacy work_request
    // relation join (2026-08-07): work_request_id is null for every assignment
    // the current creation paths produce, so the old join matched nothing.
    expect(mockWorkerAssignment.findFirst.mock.calls[0][0].where.day).toEqual(
      new Date('2026-07-27T00:00:00.000Z')
    );
    expect(mockCalendarAbsence.findUnique.mock.calls[0][0].where).toEqual({
      worker_id_day: { worker_id: 'w1', day: new Date('2026-07-27T00:00:00.000Z') } ,
    });
  });

  /**
   * The day parameter must reach BOTH queries.
   *
   * A version that threaded it into the assignment lookup and left the absence
   * lookup on today would answer "free" for a worker on holiday next Tuesday --
   * wrong in the direction that puts someone on a shift they cannot work. So
   * this asserts the WHERE of each query, not the returned boolean, which a
   * mock would happily produce either way.
   */
  it('answers about the day it was given, in both the assignment and absence lookups', async () => {
    const result = await service.getAvailability(
      'w1',
      { userId: 'w1', role: 'worker' },
      '2026-08-04'
    );

    const expected = new Date('2026-08-04T00:00:00.000Z');
    expect(mockWorkerAssignment.findFirst.mock.calls[0][0].where.day).toEqual(expected);
    expect(mockCalendarAbsence.findUnique.mock.calls[0][0].where).toEqual({
      worker_id_day: { worker_id: 'w1', day: expected },
    });
    expect(result.day).toBe('2026-08-04');
  });

  it('reports unavailable for a future day the worker is already booked on', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1' });
    const result = await service.getAvailability(
      'w1',
      { userId: 'w1', role: 'worker' },
      '2026-08-04'
    );
    expect({ day: result.day, available: result.available }).toEqual({
      day: '2026-08-04',
      available: false,
    });
  });

  // Regression (2026-08-07). Both getAvailability() and
  // autoCancelSameDayAssignment() filtered via `work_request: { shift_date }`.
  // Neither current creation path sets work_request_id -- placeOnCalendar()
  // and acceptBroadcast() both write null -- and a Prisma nested to-one filter
  // never matches a null relation, so the calendar was blind to every modern
  // assignment: it reported a fully-booked worker as available, and marking
  // yourself sick left the shift CONFIRMED.
  //
  // Asserting the WHERE shape rather than a boolean is deliberate: with the
  // old join the mock still returns whatever it is told to, so an
  // outcome-only test passes against the bug.
  it('queries by the denormalized day column, never the work_request relation', async () => {
    await service.getAvailability('w1', { userId: 'w1', role: 'worker' });

    const where = mockWorkerAssignment.findFirst.mock.calls[0][0].where;
    expect(where.day).toEqual(new Date('2026-07-27T00:00:00.000Z'));
    // The specific defect: a relation join here matches no calendar-placed or
    // broadcast-accepted row.
    expect(where.work_request).toBeUndefined();
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
    // like admin -- and no checker-specific worker-scope model is currently
    // defined by the frozen specification or implemented in the repository.
    // This must NOT reuse resolveHotelAccess()'s admin/checker cross-hotel
    // bypass, which exists for a different (hotel-centric, quality-review)
    // reason; denying here is failing closed on an open decision, not a gap.
    it('denies checker (no checker-scope model defined; spec marks this "(scope)", not "(all)")', async () => {
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

// Reason/manager-on-behalf-of/drag-to-move feature (2026-08-08): "mark
// attendance feature should also be in the calendar as a draggable and
// also include reason text box in it. and reason should be mandatory" +
// "both manager and the worker should be able to mark attendance. but
// everythings should be logged" + "same scenario could be possible for
// different hierarchies".
describe('CalendarService.markAbsenceForWorker (manager-on-behalf-of, 2026-08-08 feature)', () => {
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
      kind: 'VACATION',
      reason: 'Family trip',
      marked_by_id: 'mgr1',
      created_at: new Date('2026-07-27T00:00:00.000Z'),
      updated_at: new Date('2026-07-27T00:00:00.000Z'),
    });
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
    mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: 'rm1' });
    mockUser.findUnique.mockResolvedValue({ first_name: 'Ada', last_name: 'Lovelace' });
  });

  afterEach(() => restoreClock());

  it("allows a manager to mark an in-group worker's absence and records marked_by_id", async () => {
    await service.markAbsenceForWorker(
      { worker_id: 'w1', day: '2026-07-28', kind: 'VACATION', reason: 'Family trip' },
      { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );
    const call = mockCalendarAbsence.upsert.mock.calls[0][0];
    expect(call.create.marked_by_id).toBe('mgr1');
    expect(call.create.reason).toBe('Family trip');
  });

  it("denies a manager marking a worker outside their scope (ForbiddenError)", async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g_other' });
    await expect(
      service.markAbsenceForWorker(
        { worker_id: 'w1', day: '2026-07-28', kind: 'VACATION', reason: 'Family trip' },
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
      )
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(mockCalendarAbsence.upsert).not.toHaveBeenCalled();
  });

  it('allows an admin unconditionally, cross-group', async () => {
    await expect(
      service.markAbsenceForWorker(
        { worker_id: 'w1', day: '2026-07-28', kind: 'VACATION', reason: 'Family trip' },
        { userId: 'admin1', role: 'admin' }
      )
    ).resolves.toBeDefined();
  });

  // "everythings should be logged"
  it('writes an audit log entry for the mark', async () => {
    await service.markAbsenceForWorker(
      { worker_id: 'w1', day: '2026-07-28', kind: 'VACATION', reason: 'Family trip' },
      { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );
    expect(mockAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'MARK_ABSENCE',
          actor_id: 'mgr1',
          resource_type: 'CALENDAR_ABSENCE',
        }),
      })
    );
  });

  // "should push a notification to the resp manager, and resp worker"
  it('notifies the worker when a manager marks on their behalf', async () => {
    await service.markAbsenceForWorker(
      { worker_id: 'w1', day: '2026-07-28', kind: 'VACATION', reason: 'Family trip' },
      { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );
    const workerNotif = mockNotification.create.mock.calls.find(
      (c: any) => c[0].data.user_id === 'w1'
    );
    expect(workerNotif).toBeDefined();
    expect(workerNotif![0].data.type).toBe('CALENDAR_ABSENCE_MARKED_FOR_WORKER');
  });

  it("does not double-notify the RM when the RM is the one who acted", async () => {
    await service.markAbsenceForWorker(
      { worker_id: 'w1', day: '2026-07-28', kind: 'VACATION', reason: 'Family trip' },
      { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );
    const rmNotif = mockNotification.create.mock.calls.find((c: any) => c[0].data.user_id === 'rm1');
    expect(rmNotif).toBeUndefined();
  });
});

describe('MarkAbsenceSchema — reason (2026-08-08 feature: mandatory for VACATION, optional for SICK)', () => {
  it('rejects a VACATION mark with no reason', async () => {
    const { MarkAbsenceSchema } = await import('../modules/calendar/types.js');
    const result = MarkAbsenceSchema.safeParse({ day: '2026-08-01', kind: 'VACATION' });
    expect(result.success).toBe(false);
  });

  it('rejects a VACATION mark with an empty-string reason', async () => {
    const { MarkAbsenceSchema } = await import('../modules/calendar/types.js');
    const result = MarkAbsenceSchema.safeParse({ day: '2026-08-01', kind: 'VACATION', reason: '   ' });
    expect(result.success).toBe(false);
  });

  it('accepts a VACATION mark with a reason', async () => {
    const { MarkAbsenceSchema } = await import('../modules/calendar/types.js');
    const result = MarkAbsenceSchema.safeParse({
      day: '2026-08-01',
      kind: 'VACATION',
      reason: 'Family trip',
    });
    expect(result.success).toBe(true);
  });

  // Deliberately NOT mandatory -- see schema.prisma's CalendarAbsence.reason
  // comment for why (GDPR special-category / health-data avoidance).
  it('accepts a SICK mark with no reason', async () => {
    const { MarkAbsenceSchema } = await import('../modules/calendar/types.js');
    const result = MarkAbsenceSchema.safeParse({ day: '2026-08-01', kind: 'SICK' });
    expect(result.success).toBe(true);
  });

  it('accepts a SICK mark WITH a reason too (optional, not forbidden)', async () => {
    const { MarkAbsenceSchema } = await import('../modules/calendar/types.js');
    const result = MarkAbsenceSchema.safeParse({
      day: '2026-08-01',
      kind: 'SICK',
      reason: 'Doctor appointment',
    });
    expect(result.success).toBe(true);
  });
});

describe('CalendarService.moveAbsence (drag-to-move, 2026-08-08 feature)', () => {
  let service: CalendarService;
  let restoreClock: () => void;

  const existingAbsence = {
    id: 'abs1',
    worker_id: 'w1',
    day: new Date('2026-07-28T00:00:00.000Z'),
    kind: 'VACATION' as const,
    reason: 'Family trip',
    marked_by_id: 'w1',
    created_at: new Date('2026-07-27T00:00:00.000Z'),
    updated_at: new Date('2026-07-27T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalendarService();
    restoreClock = fixedToday('2026-07-27');
    mockCalendarAbsence.findUnique.mockResolvedValue(existingAbsence);
    mockCalendarAbsence.update.mockResolvedValue({
      ...existingAbsence,
      day: new Date('2026-07-29T00:00:00.000Z'),
    });
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
    mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: 'rm1' });
    mockUser.findUnique.mockResolvedValue({ first_name: 'Ada', last_name: 'Lovelace' });
  });

  afterEach(() => restoreClock());

  it('throws NotFoundError for an unknown absence', async () => {
    mockCalendarAbsence.findUnique.mockResolvedValue(null);
    await expect(
      service.moveAbsence('missing', { day: '2026-07-29' }, { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('allows the owning worker to move their own absence (self-service)', async () => {
    const result = await service.moveAbsence(
      'abs1',
      { day: '2026-07-29' },
      { userId: 'w1', role: 'worker' }
    );
    expect(result.day).toBe('2026-07-29');
  });

  it("allows a manager in scope to move an absence THEY marked", async () => {
    // Retargeted 2026-08-29. This used to run against the shared fixture,
    // which is self-marked (marked_by_id: 'w1') -- so it was asserting that a
    // manager may move a worker's own declaration, which is now refused.
    // Manager-on-behalf remains fully supported for marks a manager made.
    mockCalendarAbsence.findUnique.mockResolvedValue({
      ...existingAbsence,
      marked_by_id: 'mgr1',
    });
    await expect(
      service.moveAbsence(
        'abs1',
        { day: '2026-07-29' },
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
      )
    ).resolves.toBeDefined();
  });

  // Owner decision, 2026-08-29: a sick or vacation day the person marked
  // themselves is theirs. The register already refused to let a WORKER delete
  // a manager's mark; nothing stopped the reverse, so a manager could quietly
  // move or rewrite a worker's own declaration of their own sick day.
  describe("a self-marked absence is the worker's", () => {
    it('refuses a manager moving an absence the worker marked themselves', async () => {
      // The shared fixture is self-marked (marked_by_id === worker_id).
      await expect(
        service.moveAbsence(
          'abs1',
          { day: '2026-07-29' },
          { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('treats marked_by_id === null as self-marked', async () => {
      // Not a guess: the column was added on 2026-08-08 with no backfill, and
      // until that change there was no manager-on-behalf path at all -- every
      // NULL row was self-service by construction.
      mockCalendarAbsence.findUnique.mockResolvedValue({
        ...existingAbsence,
        marked_by_id: null,
      });
      await expect(
        service.moveAbsence(
          'abs1',
          { day: '2026-07-29' },
          { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        )
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('still lets the worker move their OWN self-marked absence', async () => {
      // The rule protects the owner; it must not lock them out of their own
      // record, which would make it unusable rather than protected.
      await expect(
        service.moveAbsence('abs1', { day: '2026-07-29' }, { userId: 'w1', role: 'worker' })
      ).resolves.toBeDefined();
    });

    it('exempts admin, the break-glass role', async () => {
      // Consistent with every other rule in this service, and necessary: a
      // genuinely wrong absence still has to be fixable by someone.
      await expect(
        service.moveAbsence('abs1', { day: '2026-07-29' }, { userId: 'admin1', role: 'admin' })
      ).resolves.toBeDefined();
    });

    it('reports scope before ownership for an out-of-scope manager', async () => {
      // An out-of-scope manager must not learn who marked an absence they may
      // not see at all.
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g_other' });
      await expect(
        service.moveAbsence(
          'abs1',
          { day: '2026-07-29' },
          { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
        )
      ).rejects.toMatchObject({ message: 'Cannot move this absence' });
    });
  });

  it("denies a manager out of scope (ForbiddenError)", async () => {
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g_other' });
    await expect(
      service.moveAbsence(
        'abs1',
        { day: '2026-07-29' },
        { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
      )
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
  });

  it("denies a different worker who is neither the owner nor a manager (ForbiddenError)", async () => {
    await expect(
      service.moveAbsence('abs1', { day: '2026-07-29' }, { userId: 'w2', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' });
  });

  it('allows an admin unconditionally', async () => {
    await expect(
      service.moveAbsence('abs1', { day: '2026-07-29' }, { userId: 'admin1', role: 'admin' })
    ).resolves.toBeDefined();
  });

  it('rejects moving an absence to a past day', async () => {
    await expect(
      service.moveAbsence('abs1', { day: '2026-07-01' }, { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('translates a P2002 (worker already has an absence that day) into ConflictError', async () => {
    mockCalendarAbsence.update.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.moveAbsence('abs1', { day: '2026-07-29' }, { userId: 'w1', role: 'worker' })
    ).rejects.toMatchObject({ name: 'ConflictError' });
  });

  it('writes an audit log entry for the move', async () => {
    await service.moveAbsence('abs1', { day: '2026-07-29' }, { userId: 'w1', role: 'worker' });
    expect(mockAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MOVE_ABSENCE', actor_id: 'w1' }),
      })
    );
  });

  it('notifies the worker when a manager moves the absence on their behalf', async () => {
    mockCalendarAbsence.findUnique.mockResolvedValue({ ...existingAbsence, marked_by_id: 'mgr1' });
    await service.moveAbsence(
      'abs1',
      { day: '2026-07-29' },
      { userId: 'mgr1', role: 'manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );
    const workerNotif = mockNotification.create.mock.calls.find(
      (c: any) => c[0].data.user_id === 'w1'
    );
    expect(workerNotif).toBeDefined();
  });

  it('does not notify the worker when they move their own absence (self-service, no on-behalf-of notification)', async () => {
    await service.moveAbsence('abs1', { day: '2026-07-29' }, { userId: 'w1', role: 'worker' });
    const workerNotif = mockNotification.create.mock.calls.find(
      (c: any) => c[0].data.user_id === 'w1'
    );
    expect(workerNotif).toBeUndefined();
  });
});

/**
 * Withdrawal gap (2026-08-13).
 *
 * Marking an absence auto-cancels that day's shift and releases the broadcast
 * slot. Withdrawing the absence frees the worker again but deliberately does
 * NOT un-cancel the shift -- the slot may already have been backfilled, so
 * restoring it could exceed headcount or double-book the day.
 *
 * The gap was that nobody was told. The RM's existing "cancelled" notification
 * said only that the absence went away; it never mentioned the shift cancelled
 * as a consequence, so an unstaffed shift sat on the calendar with the worker
 * showing as available and no prompt to re-staff it.
 */
describe('CalendarService.deleteAbsence — releasing an auto-cancelled shift', () => {
  let service: CalendarService;
  let restoreClock: () => void;

  const rmNotif = () =>
    mockNotification.create.mock.calls
      .map((c: any) => c[0].data)
      .find((d: any) => d.user_id === 'rm1');

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalendarService();
    restoreClock = fixedToday('2026-07-27');
    mockCalendarAbsence.findUnique.mockResolvedValue({
      id: 'abs1',
      worker_id: 'w1',
      day: new Date('2026-07-28T00:00:00.000Z'),
      kind: 'SICK',
      // Self-marked: markAbsenceInternal() always stamps marked_by_id, and
      // deleteAbsence now reads it to keep a worker from deleting an absence
      // a manager issued for them.
      marked_by_id: 'w1',
    });
    mockCalendarAbsence.delete.mockResolvedValue({ id: 'abs1' });
    mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
    mockHotelGroup.findUnique.mockResolvedValue({ id: 'g1', regional_manager_user_id: 'rm1' });
    mockUser.findUnique.mockResolvedValue({ first_name: 'Ada', last_name: 'Lovelace' });
    mockWorkerAssignment.findFirst.mockResolvedValue(null);
  });

  afterEach(() => restoreClock());

  it('only counts a shift cancelled BY the absence, not one cancelled deliberately', async () => {
    await service.deleteAbsence('abs1', { userId: 'w1', role: 'worker' });

    const where = mockWorkerAssignment.findFirst.mock.calls[0][0].where;
    expect(where.status).toBe('CANCELLED');
    expect(where.cancellation_reason.in).toEqual([
      'Worker marked sick/vacation',
      'Marked sick/vacation by a manager',
    ]);
  });

  it('tells the manager the shift is still unstaffed when one was released', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1', hotel_id: 'h1' });

    await service.deleteAbsence('abs1', { userId: 'w1', role: 'worker' });

    const notif = rmNotif();
    expect(notif.title).toBe('Shift needs re-staffing');
    expect(notif.message).toContain('still unstaffed');
    expect(notif.data).toMatchObject({ cancelled_assignment_id: 'a1', hotel_id: 'h1' });
  });

  it('keeps the plain wording when no shift was cancelled for that day', async () => {
    await service.deleteAbsence('abs1', { userId: 'w1', role: 'worker' });

    const notif = rmNotif();
    expect(notif.title).not.toBe('Shift needs re-staffing');
    expect(notif.data.cancelled_assignment_id).toBeUndefined();
  });

  // Restoring is a scheduling decision, not something to infer -- the slot may
  // already have been backfilled by someone else.
  it('never un-cancels the assignment', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1', hotel_id: 'h1' });

    await service.deleteAbsence('abs1', { userId: 'w1', role: 'worker' });

    expect(mockWorkerAssignment.update).not.toHaveBeenCalled();
  });

  it('records the left-cancelled shift on the audit entry', async () => {
    mockWorkerAssignment.findFirst.mockResolvedValue({ id: 'a1', hotel_id: 'h1' });

    await service.deleteAbsence('abs1', { userId: 'w1', role: 'worker' });

    const audit = mockAuditLog.create.mock.calls
      .map((c: any) => c[0].data)
      .find((d: any) => d.action === 'DELETE_ABSENCE');
    expect(audit.details).toMatchObject({ left_cancelled_assignment_id: 'a1' });
  });
});
