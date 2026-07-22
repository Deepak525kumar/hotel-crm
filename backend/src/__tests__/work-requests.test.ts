import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockWorkRequest = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotelWorker = {
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockEmploymentRecord = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkApplication = {
  findFirst: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  hotel: mockHotel,
  workRequest: mockWorkRequest,
  hotelWorker: mockHotelWorker,
  employmentRecord: mockEmploymentRecord,
  workApplication: mockWorkApplication,
  notification: mockNotification,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
};

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

// Epic 5 PR 5.7 (ADR-024 D1/D2/D4, sites #5/#6/#7): roster cutover flag.
// Defaults OFF so the existing characterization tests below stay untouched.
let rosterCutoverEnabled = false;
jest.mock('../config/feature-flags.js', () => ({
  isRosterCutoverEnabled: () => rosterCutoverEnabled,
}));
jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { WorkRequestService } from '../modules/work-requests/service.js';

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'wr1',
  hotel_id: 'h1',
  created_by_id: 'mgr1',
  position: 'cleaner',
  workers_needed: 2,
  workers_confirmed: 0,
  version: 0,
  shift_date: new Date('2026-07-01T00:00:00Z'),
  shift_start_time: '08:00',
  shift_end_time: '16:00',
  hourly_rate: null,
  currency: 'EUR',
  description: null,
  requirements: null,
  status: 'DRAFT' as const,
  published_at: null,
  expires_at: null,
  filled_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: new Date('2026-06-01T00:00:00Z'),
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

const baseInput = {
  hotel_id: 'h1',
  position: 'cleaner',
  workers_needed: 2,
  shift_date: '2026-07-01',
  shift_start_time: '08:00',
  shift_end_time: '16:00',
  currency: 'EUR',
  status: 'DRAFT' as const,
};

describe('WorkRequestService', () => {
  let service: WorkRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    rosterCutoverEnabled = false;
    service = new WorkRequestService();
  });

  describe('create', () => {
    it('throws NotFoundError when hotel does not exist', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(null);
      await expect(service.create(baseInput, 'mgr1', 'manager')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('creates a DRAFT request without publishing', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null });
      mockWorkRequest.create.mockResolvedValue(makeRow());
      const dto = await service.create(baseInput, 'mgr1', 'manager');
      expect(dto.status).toBe('DRAFT');
      expect(dto.shift_date).toBe('2026-07-01');
      const data = mockWorkRequest.create.mock.calls[0][0].data;
      expect(data.status).toBe('DRAFT');
      expect(data.published_at).toBeNull();
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('sets published_at when created directly as OPEN', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null });
      mockWorkRequest.create.mockResolvedValue(makeRow({ status: 'OPEN', published_at: new Date() }));
      await service.create({ ...baseInput, status: 'OPEN' }, 'mgr1', 'manager');
      const data = mockWorkRequest.create.mock.calls[0][0].data;
      expect(data.status).toBe('OPEN');
      expect(data.published_at).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    it('rejects an illegal status transition', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'OPEN' }));
      await expect(
        service.update('wr1', { status: 'DRAFT' }, 'mgr1', 'manager')
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('publishes a DRAFT (DRAFT -> OPEN) and bumps version', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'DRAFT' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockHotelWorker.findMany.mockResolvedValue([]);
      await service.update('wr1', { status: 'OPEN' }, 'mgr1', 'manager');
      const data = mockWorkRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('OPEN');
      expect(data.published_at).toBeInstanceOf(Date);
      expect(data.version).toEqual({ increment: 1 });
    });

    it('emits WORK_REQUEST_PUBLISHED to each active roster worker on publish', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'DRAFT' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockHotelWorker.findMany.mockResolvedValue([
        { worker_id: 'w1' },
        { worker_id: 'w2' },
      ]);
      mockNotification.create.mockResolvedValue({ id: 'n1' });

      await service.update('wr1', { status: 'OPEN' }, 'mgr1', 'manager');

      const rosterWhere = mockHotelWorker.findMany.mock.calls[0][0].where;
      expect(rosterWhere).toMatchObject({ hotel_id: 'h1', status: 'ACTIVE' });
      expect(mockNotification.create).toHaveBeenCalledTimes(2);
      const types = mockNotification.create.mock.calls.map((c) => c[0].data.type);
      expect(types).toEqual(['WORK_REQUEST_PUBLISHED', 'WORK_REQUEST_PUBLISHED']);
      const recipients = mockNotification.create.mock.calls.map((c) => c[0].data.user_id);
      expect(recipients).toEqual(['w1', 'w2']);
    });

    it('does not notify on a non-publish PATCH (e.g. cancellation)', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'CANCELLED' }));
      await service.update('wr1', { status: 'CANCELLED', cancellation_reason: 'x' }, 'mgr1', 'manager');
      expect(mockHotelWorker.findMany).not.toHaveBeenCalled();
      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('cancels with a reason', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'CANCELLED' }));
      await service.update('wr1', { status: 'CANCELLED', cancellation_reason: 'no demand' }, 'mgr1', 'manager');
      const data = mockWorkRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('CANCELLED');
      expect(data.cancelled_at).toBeInstanceOf(Date);
      expect(data.cancellation_reason).toBe('no demand');
    });

    it('does not edit terms once the request is OPEN', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
      await service.update('wr1', { position: 'supervisor' }, 'mgr1', 'manager');
      const data = mockWorkRequest.update.mock.calls[0][0].data;
      expect(data.position).toBeUndefined();
    });

    // Epic 5 PR 5.7 (ADR-024 D1/D2, site #7): notifyRosterPublished's fan-out
    // reads listEligibleWorkerIds() (EmploymentRecord group scope) instead of
    // HotelWorker when the roster cutover flag is ON.
    describe('roster cutover (flag ON, site #7)', () => {
      beforeEach(() => {
        rosterCutoverEnabled = true;
      });

      it('emits WORK_REQUEST_PUBLISHED to each ACTIVE employee in the hotel group', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'DRAFT' }));
        mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        mockEmploymentRecord.findMany.mockResolvedValue([{ user_id: 'w1' }, { user_id: 'w2' }]);
        mockNotification.create.mockResolvedValue({ id: 'n1' });

        await service.update('wr1', { status: 'OPEN' }, 'mgr1', 'manager');

        expect(mockHotelWorker.findMany).not.toHaveBeenCalled();
        expect(mockEmploymentRecord.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { hotel_group_id: 'g1', status: 'ACTIVE' } })
        );
        const recipients = mockNotification.create.mock.calls.map((c) => c[0].data.user_id);
        expect(recipients).toEqual(['w1', 'w2']);
      });

      it('notifies nobody when the hotel has no hotel_group_id (deny-by-default)', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'DRAFT' }));
        mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: null });

        await service.update('wr1', { status: 'OPEN' }, 'mgr1', 'manager');

        expect(mockEmploymentRecord.findMany).not.toHaveBeenCalled();
        expect(mockNotification.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('list', () => {
    it('scopes a worker to their active rosters', async () => {
      mockHotelWorker.findMany.mockResolvedValue([{ hotel_id: 'h1' }, { hotel_id: 'h2' }]);
      mockWorkRequest.findMany.mockResolvedValue([makeRow()]);
      mockWorkRequest.count.mockResolvedValue(1);
      await service.list(
        { page: 1, per_page: 20 } as any,
        { userId: 'w1', role: 'worker' }
      );
      const where = mockWorkRequest.findMany.mock.calls[0][0].where;
      expect(where.hotel_id).toEqual({ in: ['h1', 'h2'] });
    });

    it('returns empty for a worker with no active roster', async () => {
      mockHotelWorker.findMany.mockResolvedValue([]);
      const res = await service.list(
        { page: 1, per_page: 20 } as any,
        { userId: 'w1', role: 'worker' }
      );
      expect(res).toEqual({ data: [], total: 0 });
      expect(mockWorkRequest.findMany).not.toHaveBeenCalled();
    });

    it('does not scope an admin', async () => {
      mockWorkRequest.findMany.mockResolvedValue([]);
      mockWorkRequest.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });
      const where = mockWorkRequest.findMany.mock.calls[0][0].where;
      expect(where.hotel_id).toBeUndefined();
      expect(mockHotelWorker.findMany).not.toHaveBeenCalled();
    });

    // Epic 5 PR 5.7 (ADR-024 D1/D2, site #5): reverse case — reads
    // listEligibleHotelIds() (EmploymentRecord group scope) instead of
    // HotelWorker when the roster cutover flag is ON.
    describe('roster cutover (flag ON, site #5)', () => {
      beforeEach(() => {
        rosterCutoverEnabled = true;
      });

      it('scopes a worker to every hotel in their EmploymentRecord group', async () => {
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
        mockWorkRequest.findMany.mockResolvedValue([makeRow()]);
        mockWorkRequest.count.mockResolvedValue(1);
        await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
        const where = mockWorkRequest.findMany.mock.calls[0][0].where;
        expect(where.hotel_id).toEqual({ in: ['h1', 'h2'] });
        expect(mockHotelWorker.findMany).not.toHaveBeenCalled();
      });

      it('returns empty for a worker with no EmploymentRecord (deny-by-default)', async () => {
        mockEmploymentRecord.findUnique.mockResolvedValue(null);
        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
        expect(res).toEqual({ data: [], total: 0 });
        expect(mockWorkRequest.findMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('getById', () => {
    it('throws NotFoundError for a missing work request', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(null);
      await expect(service.getById('wr1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('allows a worker with an ACTIVE HotelWorker membership row', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ hotel_id: 'h1' }));
      mockHotelWorker.findFirst.mockResolvedValue({ id: 'hw1' });
      const dto = await service.getById('wr1', { userId: 'w1', role: 'worker' });
      expect(dto.id).toBe('wr1');
    });

    it('throws ForbiddenError when the worker has no ACTIVE membership', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ hotel_id: 'h1' }));
      mockHotelWorker.findFirst.mockResolvedValue(null);
      await expect(service.getById('wr1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
    });

    // Epic 5 PR 5.7 (ADR-024 D1/D2, site #6): roster cutover ON reads the
    // EmploymentRecord group scope instead of HotelWorker, deny-by-default.
    describe('roster cutover (flag ON, site #6)', () => {
      beforeEach(() => {
        rosterCutoverEnabled = true;
      });

      it('allows a worker whose EmploymentRecord group matches the work request hotel group', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeRow({ hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        const dto = await service.getById('wr1', { userId: 'w1', role: 'worker' });
        expect(dto.id).toBe('wr1');
        expect(mockHotelWorker.findFirst).not.toHaveBeenCalled();
      });

      it('denies a worker with no EmploymentRecord (deny-by-default)', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeRow({ hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue(null);
        await expect(service.getById('wr1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
        expect(mockHotelWorker.findFirst).not.toHaveBeenCalled();
      });
    });
  });
});
