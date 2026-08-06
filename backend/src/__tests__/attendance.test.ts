import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockAttendance = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUniqueOrThrow: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockOutboxEvent = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  attendance: mockAttendance,
  workerAssignment: mockWorkerAssignment,
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

// ADR-029 (GD-01, Epic 7 PR 7.3): default resolved values so enqueue() inside
// update()'s transaction has something to read `.id` off of.
mockNotification.create.mockResolvedValue({ id: 'notif-default' });
mockOutboxEvent.create.mockResolvedValue({ id: 'outbox-default' });

const mockVerifyGeofence = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockIsGeofenceConfigured = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../modules/geo/service.js', () => ({
  geoService: { verifyGeofence: mockVerifyGeofence, isGeofenceConfigured: mockIsGeofenceConfigured },
}));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
    ATTENDANCE_EARLY_CHECK_IN_GRACE_MINUTES: 120,
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { AttendanceService } from '../modules/attendance/service.js';

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'att1',
  assignment_id: 'a1',
  worker_id: 'w1',
  hotel_id: 'h1',
  status: 'EXPECTED' as const,
  check_in_at: null,
  check_out_at: null,
  expected_start: new Date('2026-07-01T08:00:00Z'),
  expected_end: new Date('2026-07-01T16:00:00Z'),
  minutes_late: null,
  minutes_worked: null,
  notes: null,
  is_verified: false,
  verified_by_id: null,
  verified_at: null,
  created_at: new Date('2026-06-01T00:00:00Z'),
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AttendanceService();
    mockVerifyGeofence.mockReset();
    mockIsGeofenceConfigured.mockReset();
    // checkIn()'s review fix uses updateMany (compare-and-swap) + a
    // follow-up findUniqueOrThrow instead of a plain update -- default the
    // common-case success shape so tests that don't care about the
    // race-condition path don't need to restate this every time.
    mockAttendance.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('checkIn', () => {
    it('throws NotFoundError when assignment does not exist', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('throws ForbiddenError when worker tries to check in to another\'s assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w2' });
      await expect(service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
    });

    it('throws ConflictError when already checked in', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord({ status: 'PRESENT' }));
      await expect(service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker')).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('marks PRESENT when on time', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1' });
      // expected_start in the future — worker is early, so minutes_late === 0 → PRESENT
      const futureStart = new Date(Date.now() + 10 * 60000);
      mockAttendance.findUnique.mockResolvedValue(makeRecord({ expected_start: futureStart }));
      mockAttendance.findUniqueOrThrow.mockResolvedValue(
        makeRecord({ status: 'PRESENT', check_in_at: new Date() })
      );
      await service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker');
      const updateCall = mockAttendance.updateMany.mock.calls[0][0].data;
      expect(updateCall.status).toBe('PRESENT');
    });

    it('marks LATE when arriving after expected_start', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1' });
      const earlyStart = new Date(Date.now() - 30 * 60000); // 30 min ago
      mockAttendance.findUnique.mockResolvedValue(makeRecord({ expected_start: earlyStart }));
      mockAttendance.findUniqueOrThrow.mockResolvedValue(
        makeRecord({ status: 'LATE', check_in_at: new Date(), minutes_late: 30 })
      );
      await service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker');
      const updateCall = mockAttendance.updateMany.mock.calls[0][0].data;
      expect(updateCall.status).toBe('LATE');
      expect(updateCall.minutes_late).toBeGreaterThan(0);
    });

    it('deferred-bug fix: rejects with ForbiddenError when checking in more than 2 hours before expected_start', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1' });
      // 2h30m out, comfortably past the 2h window. Deliberately NOT 2h+1min:
      // the service floors (expected_start - now) to whole minutes, and the
      // sub-millisecond gap between computing this value and the service
      // reading `now` floors 121 down to exactly 120, landing on the boundary
      // rather than past it -- a self-inflicted flake, not a real guard gap.
      const tooEarlyStart = new Date(Date.now() + 150 * 60000);
      mockAttendance.findUnique.mockResolvedValue(makeRecord({ expected_start: tooEarlyStart }));

      await expect(service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CHECK_IN_DENIED_TOO_EARLY',
            resource_type: 'ATTENDANCE',
          }),
        })
      );
    });

    it('deferred-bug fix: allows check-in exactly at the 2-hour grace boundary', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1' });
      const atBoundary = new Date(Date.now() + 120 * 60000); // exactly 2h from now
      mockAttendance.findUnique.mockResolvedValue(makeRecord({ expected_start: atBoundary }));
      mockAttendance.findUniqueOrThrow.mockResolvedValue(
        makeRecord({ status: 'PRESENT', check_in_at: new Date() })
      );

      await service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker');

      expect(mockAttendance.updateMany).toHaveBeenCalledTimes(1);
    });

    it('deferred-bug fix: does not apply the early-check-in guard when expected_start is null', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord({ expected_start: null }));
      mockAttendance.findUniqueOrThrow.mockResolvedValue(
        makeRecord({ status: 'PRESENT', check_in_at: new Date(), expected_start: null })
      );

      await service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker');

      expect(mockAttendance.updateMany).toHaveBeenCalledTimes(1);
    });

    it('review fix (concurrency): rejects with ConflictError when a concurrent caller already checked in between the read and the compare-and-swap', async () => {
      // Simulates the TOCTOU race this fix closes: the initial findUnique()
      // still sees EXPECTED (a concurrent caller's write hasn't landed there
      // yet), so the fast-path check passes -- but by the time this
      // caller's updateMany() WHERE clause is evaluated, the row has
      // already been flipped by the other caller, so updateMany() matches
      // zero rows.
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockAttendance.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker')).rejects.toMatchObject({
        name: 'ConflictError',
      });

      expect(mockAttendance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'att1', status: 'EXPECTED' } })
      );
      expect(mockAttendance.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('checkIn — GD-14 geofence verification (SPEC-GEO-001 wiring)', () => {
    it('proceeds without calling Geo\'s distance check when no coordinates are supplied and the hotel has no geofence configured', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1', hotel_id: 'h1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockAttendance.findUniqueOrThrow.mockResolvedValue(
        makeRecord({ status: 'PRESENT', check_in_at: new Date() })
      );
      mockIsGeofenceConfigured.mockResolvedValue(false);

      await service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker');

      expect(mockIsGeofenceConfigured).toHaveBeenCalledWith('h1');
      expect(mockVerifyGeofence).not.toHaveBeenCalled();
      expect(mockAttendance.updateMany).toHaveBeenCalledTimes(1);
    });

    it('fails closed when no coordinates are supplied but the hotel HAS a geofence configured (no permission-denial bypass)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1', hotel_id: 'h1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockIsGeofenceConfigured.mockResolvedValue(true);

      await expect(service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker')).rejects.toMatchObject({
        name: 'ForbiddenError',
      });

      expect(mockVerifyGeofence).not.toHaveBeenCalled();
      expect(mockAttendance.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CHECK_IN_DENIED_GEOFENCE',
            resource_type: 'ATTENDANCE',
          }),
        })
      );
    });

    it('proceeds with check-in when the hotel has no coordinates configured (not_configured)', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1', hotel_id: 'h1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockAttendance.findUniqueOrThrow.mockResolvedValue(
        makeRecord({ status: 'PRESENT', check_in_at: new Date() })
      );
      mockVerifyGeofence.mockResolvedValue({ status: 'not_configured' });

      await service.checkIn({ assignment_id: 'a1', latitude: 52.52, longitude: 13.405 }, 'w1', 'worker');

      expect(mockVerifyGeofence).toHaveBeenCalledWith(
        'w1',
        { hotel_id: 'h1', latitude: 52.52, longitude: 13.405 },
        'worker',
        undefined
      );
      expect(mockAttendance.updateMany).toHaveBeenCalledTimes(1);
    });

    it('proceeds with check-in when verified inside the geofence radius', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1', hotel_id: 'h1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockAttendance.findUniqueOrThrow.mockResolvedValue(
        makeRecord({ status: 'PRESENT', check_in_at: new Date() })
      );
      mockVerifyGeofence.mockResolvedValue({ status: 'verified', insideRadius: true, distanceMeters: 5 });

      const result = await service.checkIn(
        { assignment_id: 'a1', latitude: 52.52, longitude: 13.405 },
        'w1',
        'worker'
      );

      expect(result.status).toBe('PRESENT');
      expect(mockAttendance.updateMany).toHaveBeenCalledTimes(1);
    });

    it('fails closed with ForbiddenError when verified outside the geofence radius', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1', hotel_id: 'h1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockVerifyGeofence.mockResolvedValue({ status: 'verified', insideRadius: false, distanceMeters: 5000 });

      await expect(
        service.checkIn({ assignment_id: 'a1', latitude: 52.57, longitude: 13.405 }, 'w1', 'worker')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });

      expect(mockAttendance.updateMany).not.toHaveBeenCalled();
    });

    it('audit-logs a denied check-in without writing the attendance record', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1', hotel_id: 'h1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockVerifyGeofence.mockResolvedValue({ status: 'verified', insideRadius: false, distanceMeters: 5000 });

      await expect(
        service.checkIn({ assignment_id: 'a1', latitude: 52.57, longitude: 13.405 }, 'w1', 'worker')
      ).rejects.toBeTruthy();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CHECK_IN_DENIED_GEOFENCE',
            resource_type: 'ATTENDANCE',
          }),
        })
      );
    });

    it('passes the actor IP through to Geo for audit logging', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1', hotel_id: 'h1' });
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockAttendance.findUniqueOrThrow.mockResolvedValue(
        makeRecord({ status: 'PRESENT', check_in_at: new Date() })
      );
      mockVerifyGeofence.mockResolvedValue({ status: 'verified', insideRadius: true, distanceMeters: 5 });

      await service.checkIn(
        { assignment_id: 'a1', latitude: 52.52, longitude: 13.405 },
        'w1',
        'worker',
        '203.0.113.7'
      );

      expect(mockVerifyGeofence).toHaveBeenCalledWith(
        'w1',
        { hotel_id: 'h1', latitude: 52.52, longitude: 13.405 },
        'worker',
        '203.0.113.7'
      );
    });
  });

  describe('update', () => {
    it('throws ConflictError when worker tries to check out without checking in', async () => {
      mockAttendance.findUnique.mockResolvedValue(makeRecord({ worker_id: 'w1' }));
      await expect(
        service.update('att1', { check_out_at: new Date().toISOString() }, 'w1', 'worker')
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('throws ConflictError on double check-out', async () => {
      mockAttendance.findUnique.mockResolvedValue(
        makeRecord({ worker_id: 'w1', check_in_at: new Date(), check_out_at: new Date() })
      );
      await expect(
        service.update('att1', { check_out_at: new Date().toISOString() }, 'w1', 'worker')
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('allows worker to check out and computes minutes_worked', async () => {
      const checkIn = new Date(Date.now() - 60 * 60000); // 1 hour ago
      mockAttendance.findUnique.mockResolvedValue(
        makeRecord({ worker_id: 'w1', check_in_at: checkIn })
      );
      mockAttendance.update.mockResolvedValue(
        makeRecord({ check_in_at: checkIn, check_out_at: new Date(), minutes_worked: 60 })
      );
      await service.update('att1', { check_out_at: new Date().toISOString() }, 'w1', 'worker');
      const data = mockAttendance.update.mock.calls[0][0].data;
      expect(data.check_out_at).toBeInstanceOf(Date);
      expect(data.minutes_worked).toBeGreaterThanOrEqual(55);
    });

    it('blocks worker from setting verification fields', async () => {
      mockAttendance.findUnique.mockResolvedValue(
        makeRecord({ worker_id: 'w1', check_in_at: new Date() })
      );
      await expect(
        service.update('att1', { is_verified: true }, 'w1', 'worker')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows manager to verify and sets verified_by_id', async () => {
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockAttendance.update.mockResolvedValue(
        makeRecord({ is_verified: true, verified_by_id: 'mgr1', verified_at: new Date() })
      );
      await service.update('att1', { is_verified: true }, 'mgr1', 'admin');
      const data = mockAttendance.update.mock.calls[0][0].data;
      expect(data.is_verified).toBe(true);
      expect(data.verified_by).toEqual({ connect: { id: 'mgr1' } });
      expect(data.verified_at).toBeInstanceOf(Date);

      // ADR-029 (GD-01, Epic 7 PR 7.3): single commit for the attendance
      // write and the ATTENDANCE_VERIFIED enqueue.
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockOutboxEvent.create).toHaveBeenCalledTimes(1);
      expect(mockOutboxEvent.create.mock.calls[0][0].data.source_module).toBe('ATTENDANCE');
      const notifData = mockNotification.create.mock.calls[0][0].data;
      expect(notifData.type).toBe('ATTENDANCE_VERIFIED');
      expect(notifData.user_id).toBe('w1'); // record.worker_id
    });

    it('enqueues WORKER_NO_SHOW to the assignment manager when marked ABSENT', async () => {
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockAttendance.update.mockResolvedValue(makeRecord({ status: 'ABSENT' }));
      mockWorkerAssignment.findUnique.mockResolvedValue({ assigned_by_id: 'mgr1' });

      await service.update('att1', { status: 'ABSENT' }, 'mgr1', 'admin');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockOutboxEvent.create).toHaveBeenCalledTimes(1);
      const notifData = mockNotification.create.mock.calls[0][0].data;
      expect(notifData.type).toBe('WORKER_NO_SHOW');
      expect(notifData.user_id).toBe('mgr1'); // assignment.assigned_by_id
    });

    it('does not enqueue WORKER_NO_SHOW when the assignment lookup finds nothing', async () => {
      mockAttendance.findUnique.mockResolvedValue(makeRecord());
      mockAttendance.update.mockResolvedValue(makeRecord({ status: 'ABSENT' }));
      mockWorkerAssignment.findUnique.mockResolvedValue(null);

      await service.update('att1', { status: 'ABSENT' }, 'mgr1', 'admin');

      expect(mockOutboxEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('scopes worker to own records', async () => {
      mockAttendance.findMany.mockResolvedValue([]);
      mockAttendance.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
      const where = mockAttendance.findMany.mock.calls[0][0].where;
      expect(where.worker_id).toBe('w1');
    });

    it('does not scope manager', async () => {
      mockAttendance.findMany.mockResolvedValue([]);
      mockAttendance.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'mgr1', role: 'manager' });
      const where = mockAttendance.findMany.mock.calls[0][0].where;
      expect(where.worker_id).toBeUndefined();
    });
  });
});
