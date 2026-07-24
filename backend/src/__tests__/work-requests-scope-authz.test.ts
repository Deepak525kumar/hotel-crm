import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Work-request scope-authorization regression for Epic 8 (SIR-JOBD-002 /
 * FIND-SEC-002).
 *
 * Mirrors `quality-scope-authz.test.ts` (Epic 5 PR 5.5): work requests were
 * role-guarded (`admin`/`manager`) but never hotel-scoped, so a manager could
 * create or patch a work request belonging to a hotel outside their scope
 * claim. `create()`/`update()` now run the same in-service
 * `isHotelInScope()` check as `quality/service.ts` and `attendance/service.ts`
 * whenever `FEATURE_SCOPE_AUTHZ` is enabled. Admin keeps unconditional
 * cross-hotel access (unchanged, by design). Removing the manager-scope
 * check turns the out-of-scope cases below from 403 into success.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

// wr_id -> the WorkRequest row (hotel_id drives the scope decision).
const workRequests: Record<string, any> = {
  wr_h1: {
    id: 'wr_h1',
    hotel_id: 'h1',
    created_by_id: 'mgr_1',
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
    status: 'DRAFT',
    published_at: null,
    expires_at: null,
    filled_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: new Date('2026-06-01T00:00:00Z'),
    updated_at: new Date('2026-06-01T00:00:00Z'),
  },
  wr_h2: {
    id: 'wr_h2',
    hotel_id: 'h2',
    created_by_id: 'mgr_2',
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
    status: 'DRAFT',
    published_at: null,
    expires_at: null,
    filled_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: new Date('2026-06-01T00:00:00Z'),
    updated_at: new Date('2026-06-01T00:00:00Z'),
  },
};

const hotels: Record<string, any> = {
  h1: { id: 'h1', deleted_at: null, hotel_group_id: 'g1' },
  h2: { id: 'h2', deleted_at: null, hotel_group_id: 'g2' },
};

jest.mock('../config/feature-flags.js', () => ({
  isScopeAuthzEnabled: () => true,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../modules/notifications/service.js', () => ({
  notificationService: {
    sendNotification: async () => undefined,
    enqueue: async () => ({ notification: { id: 'notif-stub' }, outboxEvents: [] }),
  },
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    hotel: {
      findUnique: async ({ where }: any) => hotels[where.id] ?? null,
    },
    workRequest: {
      findUnique: async ({ where }: any) => workRequests[where.id] ?? null,
      create: async ({ data }: any) => ({
        id: 'wr_new',
        version: 0,
        workers_confirmed: 0,
        hourly_rate: null,
        currency: 'EUR',
        description: null,
        requirements: null,
        published_at: null,
        expires_at: null,
        filled_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        created_at: new Date(),
        updated_at: new Date(),
        ...data,
      }),
      update: async ({ where, data }: any) => ({
        ...workRequests[where.id],
        ...data,
        updated_at: new Date(),
      }),
    },
    employmentRecord: { findMany: async () => [] },
    auditLog: { create: async () => undefined },
  }),
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import workRequestRouter from '../modules/work-requests/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/work-requests', workRequestRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

const createBody = {
  hotel_id: 'h1',
  position: 'cleaner',
  workers_needed: 2,
  shift_date: '2026-07-01',
  shift_start_time: '08:00',
  shift_end_time: '16:00',
  status: 'DRAFT',
};

describe('Work-request scope authorization', () => {
  beforeEach(() => {
    testAuth = null;
  });

  describe('CREATE (SIR-JOBD-002 / FIND-SEC-002)', () => {
    it('allows a manager to create a work request for an in-scope hotel (201)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).post('/work-requests').send(createBody);
      expect(res.status).toBe(201);
    });

    it('denies a manager creating a work request for an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).post('/work-requests').send({ ...createBody, hotel_id: 'h2' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to create a work request cross-hotel (201)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp()).post('/work-requests').send({ ...createBody, hotel_id: 'h2' });
      expect(res.status).toBe(201);
    });
  });

  describe('PATCH (SIR-JOBD-002 / FIND-SEC-002)', () => {
    it('allows a manager to patch a work request for an in-scope hotel (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h1')
        .send({ status: 'CANCELLED', cancellation_reason: 'no demand' });
      expect(res.status).toBe(200);
    });

    it('denies a manager patching a work request for an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h2')
        .send({ status: 'CANCELLED', cancellation_reason: 'no demand' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to patch a work request cross-hotel (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h2')
        .send({ status: 'CANCELLED', cancellation_reason: 'no demand' });
      expect(res.status).toBe(200);
    });
  });
});
