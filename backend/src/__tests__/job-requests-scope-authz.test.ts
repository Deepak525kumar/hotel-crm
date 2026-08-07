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
 * (unconditional since ADR-030 PR-5, M-4). Admin keeps unconditional
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
  h1: { id: 'h1', deleted_at: null, accepting_jobs: true, hotel_group_id: 'g1' },
  h2: { id: 'h2', deleted_at: null, accepting_jobs: true, hotel_group_id: 'g2' },
};

jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => false,
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
    jobRequest: {
      findUnique: async ({ where }: any) => workRequests[where.id] ?? null,
      // LIST manager-scope regression (2026-08-08): filters the fixture set
      // by the same where-clause shape the service builds (hotel_id direct
      // match or { in: [...] }, or hotel.hotel_group_id via the mocked
      // `hotels` lookup below) well enough to prove out-of-scope rows never
      // reach the response, without reimplementing Prisma's query engine.
      findMany: async ({ where }: any) => {
        const rows = Object.values(workRequests);
        const hotelIdFilter = where?.hotel_id;
        const groupFilter = where?.hotel?.hotel_group_id;
        return rows.filter((wr: any) => {
          if (groupFilter !== undefined) return hotels[wr.hotel_id]?.hotel_group_id === groupFilter;
          if (hotelIdFilter === undefined) return true;
          if (typeof hotelIdFilter === 'string') return wr.hotel_id === hotelIdFilter;
          if (hotelIdFilter?.in) return hotelIdFilter.in.includes(wr.hotel_id);
          return true;
        });
      },
      count: async ({ where }: any) => {
        const hotelIdFilter = where?.hotel_id;
        const groupFilter = where?.hotel?.hotel_group_id;
        return Object.values(workRequests).filter((wr: any) => {
          if (groupFilter !== undefined) return hotels[wr.hotel_id]?.hotel_group_id === groupFilter;
          if (hotelIdFilter === undefined) return true;
          if (typeof hotelIdFilter === 'string') return wr.hotel_id === hotelIdFilter;
          if (hotelIdFilter?.in) return hotelIdFilter.in.includes(wr.hotel_id);
          return true;
        }).length;
      },
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
    // Cancel-cascade fix (2026-08-05): JobRequestService.update() queries
    // for active assignments to cascade-cancel whenever the target status
    // is CANCELLED -- none of this file's fixtures have any, so an empty
    // result correctly makes the cascade a no-op.
    workerAssignment: { findMany: async () => [] },
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
import workRequestRouter from '../modules/job-requests/routes.js';
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
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).post('/work-requests').send(createBody);
      expect(res.status).toBe(201);
    });

    it('denies a manager creating a work request for an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).post('/work-requests').send({ ...createBody, hotel_id: 'h2' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to create a work request cross-hotel (201)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['staffing:write'], scope: null };
      const res = await request(makeApp()).post('/work-requests').send({ ...createBody, hotel_id: 'h2' });
      expect(res.status).toBe(201);
    });
  });

  describe('PATCH (SIR-JOBD-002 / FIND-SEC-002)', () => {
    it('allows a manager to patch a work request for an in-scope hotel (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h1')
        .send({ status: 'CANCELLED', cancellation_reason: 'no demand' });
      expect(res.status).toBe(200);
    });

    it('denies a manager patching a work request for an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h2')
        .send({ status: 'CANCELLED', cancellation_reason: 'no demand' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to patch a work request cross-hotel (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['staffing:write'], scope: null };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h2')
        .send({ status: 'CANCELLED', cancellation_reason: 'no demand' });
      expect(res.status).toBe(200);
    });
  });

  // IDOR fix (2026-08-08): list()/getById() previously ran no manager-scope
  // check at all -- create()/update() above already did. A manager could
  // read every work request platform-wide via GET /work-requests or
  // GET /work-requests/:id regardless of their scope claim.
  describe('LIST (manager-scope IDOR fix, 2026-08-08)', () => {
    it("scopes a hotel-scoped manager's list to their own hotel only", async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/work-requests');
      expect(res.status).toBe(200);
      const ids = res.body.data.map((wr: any) => wr.id);
      expect(ids).toContain('wr_h1');
      expect(ids).not.toContain('wr_h2');
    });

    it("scopes a regional_manager's list to their hotel_group only", async () => {
      testAuth = { userId: 'rm_1', role: 'regional_manager', permissions: ['staffing:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      const res = await request(makeApp()).get('/work-requests');
      expect(res.status).toBe(200);
      const ids = res.body.data.map((wr: any) => wr.id);
      expect(ids).toContain('wr_h1');
      expect(ids).not.toContain('wr_h2');
    });

    it('denies all rows to a scoped manager with no scope claim (deny-by-default)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: null };
      const res = await request(makeApp()).get('/work-requests');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('does not scope an admin (sees both hotels)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['staffing:write'], scope: { type: 'global' } };
      const res = await request(makeApp()).get('/work-requests');
      expect(res.status).toBe(200);
      const ids = res.body.data.map((wr: any) => wr.id);
      expect(ids).toContain('wr_h1');
      expect(ids).toContain('wr_h2');
    });
  });

  describe('GET /:id (manager-scope IDOR fix, 2026-08-08)', () => {
    it('allows a manager to read a work request for an in-scope hotel (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/work-requests/wr_h1');
      expect(res.status).toBe(200);
    });

    it('denies a manager reading a work request for an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['staffing:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/work-requests/wr_h2');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to read a work request cross-hotel (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['staffing:write'], scope: { type: 'global' } };
      const res = await request(makeApp()).get('/work-requests/wr_h2');
      expect(res.status).toBe(200);
    });
  });
});
