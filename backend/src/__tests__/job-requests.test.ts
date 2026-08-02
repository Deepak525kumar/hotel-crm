import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockWorkRequest = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockNotification = {
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockOutboxEvent = {
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

const mockPrisma = {
  hotel: mockHotel,
  jobRequest: mockWorkRequest,
  employmentRecord: mockEmploymentRecord,
  notification: mockNotification,
  outboxEvent: mockOutboxEvent,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
  $transaction: jest.fn(async (cb: any) => cb(mockPrisma)) as jest.MockedFunction<(...args: any[]) => any>,
};

// ADR-029 (GD-01, Epic 7 PR 7.3): default resolved values so enqueue() inside
// the publish transaction has something to read `.id` off of.
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

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import workRequestRouter from '../modules/job-requests/routes.js';
import { JobRequestService } from '../modules/job-requests/service.js';

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
  let service: JobRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobRequestService();
  });

  describe('create', () => {
    it('throws NotFoundError when hotel does not exist', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue(null);
      await expect(service.create(baseInput, { userId: 'mgr1', role: 'admin' })).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('creates a DRAFT request without publishing', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
      mockWorkRequest.create.mockResolvedValue(makeRow());
      const dto = await service.create(baseInput, { userId: 'mgr1', role: 'admin' });
      expect(dto.status).toBe('DRAFT');
      expect(dto.shift_date).toBe('2026-07-01');
      const data = mockWorkRequest.create.mock.calls[0][0].data;
      expect(data.status).toBe('DRAFT');
      expect(data.published_at).toBeNull();
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('sets published_at when created directly as OPEN', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: true });
      mockWorkRequest.create.mockResolvedValue(makeRow({ status: 'OPEN', published_at: new Date() }));
      await service.create({ ...baseInput, status: 'OPEN' }, { userId: 'mgr1', role: 'admin' });
      const data = mockWorkRequest.create.mock.calls[0][0].data;
      expect(data.status).toBe('OPEN');
      expect(data.published_at).toBeInstanceOf(Date);
    });

    it('GD-05: rejects creation when the hotel has paused accepting_jobs', async () => {
      mockPrisma.hotel.findUnique.mockResolvedValue({ id: 'h1', deleted_at: null, accepting_jobs: false });
      await expect(service.create(baseInput, { userId: 'mgr1', role: 'admin' })).rejects.toMatchObject({
        name: 'ConflictError',
      });
      expect(mockWorkRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects an illegal status transition', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'OPEN' }));
      await expect(
        service.update('wr1', { status: 'DRAFT' }, { userId: 'mgr1', role: 'admin' })
      ).rejects.toMatchObject({ name: 'ConflictError' });
    });

    it('publishes a DRAFT (DRAFT -> OPEN) and bumps version', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'DRAFT' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      mockEmploymentRecord.findMany.mockResolvedValue([]);
      await service.update('wr1', { status: 'OPEN' }, { userId: 'mgr1', role: 'admin' });
      const data = mockWorkRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('OPEN');
      expect(data.published_at).toBeInstanceOf(Date);
      expect(data.version).toEqual({ increment: 1 });
    });

    it('does not notify on a non-publish PATCH (e.g. cancellation)', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'CANCELLED' }));
      await service.update('wr1', { status: 'CANCELLED', cancellation_reason: 'x' }, { userId: 'mgr1', role: 'admin' });
      expect(mockEmploymentRecord.findMany).not.toHaveBeenCalled();
      expect(mockNotification.create).not.toHaveBeenCalled();
    });

    it('cancels with a reason', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'CANCELLED' }));
      await service.update('wr1', { status: 'CANCELLED', cancellation_reason: 'no demand' }, { userId: 'mgr1', role: 'admin' });
      const data = mockWorkRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('CANCELLED');
      expect(data.cancelled_at).toBeInstanceOf(Date);
      expect(data.cancellation_reason).toBe('no demand');
    });

    it('does not edit terms once the request is OPEN', async () => {
      mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'OPEN' }));
      mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
      await service.update('wr1', { position: 'supervisor' }, { userId: 'mgr1', role: 'admin' });
      const data = mockWorkRequest.update.mock.calls[0][0].data;
      expect(data.position).toBeUndefined();
    });

    // notifyRosterPublished's fan-out reads listEligibleWorkerIds()
    // (EmploymentRecord group scope) on publish.
    describe('notifyRosterPublished', () => {
      it('emits WORK_REQUEST_PUBLISHED to each ACTIVE employee in the hotel group', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'DRAFT' }));
        mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        mockEmploymentRecord.findMany.mockResolvedValue([{ user_id: 'w1' }, { user_id: 'w2' }]);
        mockNotification.create.mockResolvedValue({ id: 'n1' });

        await service.update('wr1', { status: 'OPEN' }, { userId: 'mgr1', role: 'admin' });

        expect(mockEmploymentRecord.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { hotel_group_id: 'g1', status: 'ACTIVE' } })
        );
        expect(mockNotification.create).toHaveBeenCalledTimes(2);
        const types = mockNotification.create.mock.calls.map((c) => c[0].data.type);
        expect(types).toEqual(['WORK_REQUEST_PUBLISHED', 'WORK_REQUEST_PUBLISHED']);
        const recipients = mockNotification.create.mock.calls.map((c) => c[0].data.user_id);
        expect(recipients).toEqual(['w1', 'w2']);

        // ADR-029 (GD-01, Epic 7 PR 7.3): the fan-out now enqueues an
        // OutboxEvent per recipient, inside the same publish transaction.
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockOutboxEvent.create).toHaveBeenCalledTimes(2);
        const sourceModules = mockOutboxEvent.create.mock.calls.map((c) => c[0].data.source_module);
        expect(sourceModules).toEqual(['WORK_REQUESTS', 'WORK_REQUESTS']);
        const transports = mockOutboxEvent.create.mock.calls.map((c) => c[0].data.transport);
        expect(transports).toEqual(['PUSH', 'PUSH']);
        // Each recipient is its own logical notification event (ADR-029 §2:
        // correlation_id ties together one enqueue() call's transport
        // fan-out, not separate recipients) — so the two rows get distinct,
        // well-formed correlation_ids.
        const correlationIds = mockOutboxEvent.create.mock.calls.map((c) => c[0].data.correlation_id);
        expect(correlationIds[0]).not.toBe(correlationIds[1]);
        expect(correlationIds[0]).toMatch(/^[0-9a-f-]{36}$/);
        expect(correlationIds[1]).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('notifies nobody when the hotel has no hotel_group_id (deny-by-default)', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeRow({ status: 'DRAFT' }));
        mockWorkRequest.update.mockResolvedValue(makeRow({ status: 'OPEN' }));
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: null });

        await service.update('wr1', { status: 'OPEN' }, { userId: 'mgr1', role: 'admin' });

        expect(mockEmploymentRecord.findMany).not.toHaveBeenCalled();
        expect(mockNotification.create).not.toHaveBeenCalled();
        // Zero eligible recipients -> the publish transaction still runs (the
        // WorkRequest write itself is unconditional on isPublishing), it just
        // enqueues nothing.
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockOutboxEvent.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('list', () => {
    it('does not scope an admin', async () => {
      mockWorkRequest.findMany.mockResolvedValue([]);
      mockWorkRequest.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });
      const where = mockWorkRequest.findMany.mock.calls[0][0].where;
      expect(where.hotel_id).toBeUndefined();
      expect(mockEmploymentRecord.findUnique).not.toHaveBeenCalled();
    });

    // Reverse case — reads listEligibleHotelIds() (EmploymentRecord group
    // scope).
    describe('worker roster scope', () => {
      it('scopes a worker to every hotel in their EmploymentRecord group', async () => {
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
        mockWorkRequest.findMany.mockResolvedValue([makeRow()]);
        mockWorkRequest.count.mockResolvedValue(1);
        await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
        const where = mockWorkRequest.findMany.mock.calls[0][0].where;
        expect(where.hotel_id).toEqual({ in: ['h1', 'h2'] });
      });

      it('returns empty for a worker with no EmploymentRecord (deny-by-default)', async () => {
        mockEmploymentRecord.findUnique.mockResolvedValue(null);
        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
        expect(res).toEqual({ data: [], total: 0 });
        expect(mockWorkRequest.findMany).not.toHaveBeenCalled();
      });
    });

    // Job Dispatch Phase 2 follow-up: list() previously never included
    // skill_slots, so a broadcast row (raiseBroadcast()) was
    // indistinguishable from a marketplace row (create()) on this endpoint —
    // getById() already included it; this brings list() to the same
    // contract WorkRequestDto documents.
    describe('skill_slots (broadcast discriminator)', () => {
      it('includes skill_slots in the Prisma query and maps it onto each row', async () => {
        const skillSlot = {
          id: 'slot1',
          job_request_id: 'jr1',
          skill: 'CLEANER' as const,
          headcount: 2,
          confirmed_count: 1,
          created_at: new Date('2026-07-29T00:00:00Z'),
          updated_at: new Date('2026-07-29T00:00:00Z'),
        };
        mockWorkRequest.findMany.mockResolvedValue([makeRow({ skill_slots: [skillSlot] })]);
        mockWorkRequest.count.mockResolvedValue(1);

        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });

        expect(mockWorkRequest.findMany.mock.calls[0][0].include).toEqual({ skill_slots: true });
        expect(res.data[0].skill_slots).toEqual([
          { id: 'slot1', skill: 'CLEANER', headcount: 2, confirmed_count: 1 },
        ]);
      });

      it('omits skill_slots on a marketplace row (no skill slots)', async () => {
        mockWorkRequest.findMany.mockResolvedValue([makeRow({ skill_slots: [] })]);
        mockWorkRequest.count.mockResolvedValue(1);

        const res = await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });

        expect(res.data[0].skill_slots).toBeUndefined();
      });

      it('is_broadcast=true filters to rows with at least one skill slot', async () => {
        mockWorkRequest.findMany.mockResolvedValue([]);
        mockWorkRequest.count.mockResolvedValue(0);

        await service.list(
          { page: 1, per_page: 20, is_broadcast: true } as any,
          { userId: 'a1', role: 'admin' }
        );

        const where = mockWorkRequest.findMany.mock.calls[0][0].where;
        expect(where.skill_slots).toEqual({ some: {} });
      });

      it('is_broadcast=false filters to rows with no skill slots', async () => {
        mockWorkRequest.findMany.mockResolvedValue([]);
        mockWorkRequest.count.mockResolvedValue(0);

        await service.list(
          { page: 1, per_page: 20, is_broadcast: false } as any,
          { userId: 'a1', role: 'admin' }
        );

        const where = mockWorkRequest.findMany.mock.calls[0][0].where;
        expect(where.skill_slots).toEqual({ none: {} });
      });

      it('omits the skill_slots where-filter when is_broadcast is not passed', async () => {
        mockWorkRequest.findMany.mockResolvedValue([]);
        mockWorkRequest.count.mockResolvedValue(0);

        await service.list({ page: 1, per_page: 20 } as any, { userId: 'a1', role: 'admin' });

        const where = mockWorkRequest.findMany.mock.calls[0][0].where;
        expect(where.skill_slots).toBeUndefined();
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

    // Worker roster access: reads the EmploymentRecord group scope,
    // deny-by-default.
    describe('worker roster access', () => {
      it('allows a worker whose EmploymentRecord group matches the work request hotel group', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeRow({ hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
        mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
        const dto = await service.getById('wr1', { userId: 'w1', role: 'worker' });
        expect(dto.id).toBe('wr1');
      });

      it('denies a worker with no EmploymentRecord (deny-by-default)', async () => {
        mockWorkRequest.findUnique.mockResolvedValue(makeRow({ hotel_id: 'h1' }));
        mockEmploymentRecord.findUnique.mockResolvedValue(null);
        await expect(service.getById('wr1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
          name: 'ForbiddenError',
        });
      });
    });
  });

  // Epic 9 PR 9.2 (TREQ-011): WorkApplication and its routes/controller/
  // service were deleted in this PR — there is no apply endpoint any more.
  // This asserts the route stays gone (Express's default unmatched-route
  // 404), guarding against it being accidentally reintroduced or re-mounted.
  describe('POST /work-requests/:id/applications (removed route)', () => {
    it('returns 404 — no apply endpoint exists post-PR-9.2', async () => {
      const app = express();
      app.use(express.json());
      app.use('/work-requests', workRequestRouter);
      const res = await request(app)
        .post('/work-requests/wr1/applications')
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
