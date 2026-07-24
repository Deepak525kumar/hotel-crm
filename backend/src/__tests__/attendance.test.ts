import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockAttendance = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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
      mockAttendance.update.mockResolvedValue(makeRecord({ status: 'PRESENT', check_in_at: new Date() }));
      await service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker');
      const updateCall = mockAttendance.update.mock.calls[0][0].data;
      expect(updateCall.status).toBe('PRESENT');
    });

    it('marks LATE when arriving after expected_start', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue({ id: 'a1', worker_id: 'w1' });
      const earlyStart = new Date(Date.now() - 30 * 60000); // 30 min ago
      mockAttendance.findUnique.mockResolvedValue(makeRecord({ expected_start: earlyStart }));
      mockAttendance.update.mockResolvedValue(makeRecord({ status: 'LATE', check_in_at: new Date(), minutes_late: 30 }));
      await service.checkIn({ assignment_id: 'a1' }, 'w1', 'worker');
      const updateCall = mockAttendance.update.mock.calls[0][0].data;
      expect(updateCall.status).toBe('LATE');
      expect(updateCall.minutes_late).toBeGreaterThan(0);
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
      await service.update('att1', { is_verified: true }, 'mgr1', 'manager');
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

      await service.update('att1', { status: 'ABSENT' }, 'mgr1', 'manager');

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

      await service.update('att1', { status: 'ABSENT' }, 'mgr1', 'manager');

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
