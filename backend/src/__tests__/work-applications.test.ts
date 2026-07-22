import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockWorkApplication = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkRequest = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  updateMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerAssignment = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockAttendance = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerOverallRating = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  workApplication: mockWorkApplication,
  workRequest: mockWorkRequest,
  workerAssignment: mockWorkerAssignment,
  attendance: mockAttendance,
  workerOverallRating: mockWorkerOverallRating,
  employmentRecord: mockEmploymentRecord,
  hotel: mockHotel,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
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

import { WorkApplicationService } from '../modules/work-applications/service.js';

const makeWr = (overrides: Record<string, unknown> = {}) => ({
  id: 'wr1',
  hotel_id: 'h1',
  status: 'OPEN' as const,
  workers_needed: 2,
  workers_confirmed: 0,
  version: 0,
  shift_date: new Date('2026-07-01T00:00:00Z'),
  shift_start_time: '08:00',
  shift_end_time: '16:00',
  ...overrides,
});

const makeApp = (overrides: Record<string, unknown> = {}) => ({
  id: 'app1',
  work_request_id: 'wr1',
  worker_id: 'w1',
  reviewed_by_id: null,
  status: 'PENDING' as const,
  cover_note: null,
  worker_rating_snapshot: null,
  reviewed_at: null,
  rejection_reason: null,
  applied_at: new Date('2026-06-01T00:00:00Z'),
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

describe('WorkApplicationService', () => {
  let service: WorkApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkApplicationService();
  });

  describe('apply', () => {
    it('throws NotFoundError when work request does not exist', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(null);
      await expect(service.apply('wr1', {}, 'w1', 'worker')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('throws ConflictError when work request is not open', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeWr({ status: 'DRAFT' }));
      await expect(service.apply('wr1', {}, 'w1', 'worker')).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    // Worker roster access: reads the EmploymentRecord group scope,
    // deny-by-default.
    describe('worker roster access', () => {
      it('allows a worker whose EmploymentRecord group matches the work request hotel group', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeWr());
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        mockWorkApplication.findUnique.mockResolvedValue(null);
        mockWorkerOverallRating.findUnique.mockResolvedValue(null);
        mockWorkApplication.create.mockResolvedValue(makeApp());
        const dto = await service.apply('wr1', {}, 'w1', 'worker');
        expect(dto.id).toBe('app1');
      });

      it('denies a worker with no EmploymentRecord (deny-by-default)', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeWr());
        mockEmploymentRecord.findUnique.mockResolvedValue(null);
        await expect(service.apply('wr1', {}, 'w1', 'worker')).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });

      it('denies a worker whose EmploymentRecord group does not match the work request hotel group', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeWr());
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g2' });
        await expect(service.apply('wr1', {}, 'w1', 'worker')).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });
    });

    it('throws ConflictError on duplicate PENDING application', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeWr());
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockWorkApplication.findUnique.mockResolvedValue(makeApp({ status: 'PENDING' }));
      await expect(service.apply('wr1', {}, 'w1', 'worker')).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('creates application and sets rating snapshot', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeWr());
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockWorkApplication.findUnique.mockResolvedValue(null);
      mockWorkerOverallRating.findUnique.mockResolvedValue({ average_score: 4.5 });
      mockWorkApplication.create.mockResolvedValue(makeApp({ worker_rating_snapshot: 4.5 }));
      const dto = await service.apply('wr1', { cover_note: 'hi' }, 'w1', 'worker');
      expect(dto.worker_rating_snapshot).toBe(4.5);
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('re-applies after withdrawal by updating existing row', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeWr());
      mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockWorkApplication.findUnique.mockResolvedValue(makeApp({ status: 'WITHDRAWN' }));
      mockWorkerOverallRating.findUnique.mockResolvedValue(null);
      mockWorkApplication.update.mockResolvedValue(makeApp({ status: 'PENDING' }));
      const dto = await service.apply('wr1', {}, 'w1', 'worker');
      expect(dto.status).toBe('PENDING');
      expect(mockWorkApplication.update).toHaveBeenCalled();
      expect(mockWorkApplication.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFoundError for unknown application', async () => {
      mockWorkApplication.findUnique.mockResolvedValue(null);
      await expect(service.update('wr1', 'app1', { status: 'REJECTED' }, 'mgr1', 'manager')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('throws ConflictError when application is already resolved', async () => {
      mockWorkApplication.findUnique.mockResolvedValue(makeApp({ status: 'ACCEPTED' }));
      await expect(service.update('wr1', 'app1', { status: 'REJECTED' }, 'mgr1', 'manager')).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('rejects with reason', async () => {
      mockWorkApplication.findUnique.mockResolvedValue(makeApp());
      mockWorkApplication.update.mockResolvedValue(makeApp({ status: 'REJECTED', rejection_reason: 'not qualified' }));
      const dto = await service.update('wr1', 'app1', { status: 'REJECTED', rejection_reason: 'not qualified' }, 'mgr1', 'manager');
      expect(dto.status).toBe('REJECTED');
      expect(dto.rejection_reason).toBe('not qualified');
    });

    it('prevents worker from approving application', async () => {
      mockWorkApplication.findUnique.mockResolvedValue(makeApp({ worker_id: 'w1' }));
      await expect(
        service.update('wr1', 'app1', { status: 'ACCEPTED' }, 'w1', 'worker')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('prevents worker from modifying another worker\'s application', async () => {
      mockWorkApplication.findUnique.mockResolvedValue(makeApp({ worker_id: 'w2' }));
      await expect(
        service.update('wr1', 'app1', { status: 'WITHDRAWN' }, 'w1', 'worker')
      ).rejects.toMatchObject({ name: 'ForbiddenError' });
    });

    it('allows worker to withdraw own application', async () => {
      mockWorkApplication.findUnique.mockResolvedValue(makeApp({ worker_id: 'w1' }));
      mockWorkApplication.update.mockResolvedValue(makeApp({ status: 'WITHDRAWN' }));
      const dto = await service.update('wr1', 'app1', { status: 'WITHDRAWN' }, 'w1', 'worker');
      expect(dto.status).toBe('WITHDRAWN');
    });
  });

  describe('list', () => {
    it('throws NotFoundError when work request does not exist', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(null);
      await expect(
        service.list('wr1', { page: 1, per_page: 20 } as any, { userId: 'mgr1', role: 'manager' })
      ).rejects.toMatchObject({ name: 'NotFoundError' });
    });

    it('returns only own application for a worker', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeWr());
      mockWorkApplication.findUnique.mockResolvedValue(makeApp());
      const res = await service.list('wr1', { page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
      expect(res.total).toBe(1);
      expect(res.data[0].worker_id).toBe('w1');
      expect(mockWorkApplication.findMany).not.toHaveBeenCalled();
    });

    it('returns all applications for a manager', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeWr());
      mockWorkApplication.findMany.mockResolvedValue([makeApp()]);
      mockWorkApplication.count.mockResolvedValue(1);
      const res = await service.list('wr1', { page: 1, per_page: 20 } as any, { userId: 'mgr1', role: 'manager' });
      expect(res.total).toBe(1);
    });
  });
});
