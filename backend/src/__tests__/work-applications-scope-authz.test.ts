import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Work-application scope-authorization regression for Epic 8 (SIR-JOBD-002 /
 * FIND-SEC-003).
 *
 * Mirrors `quality-scope-authz.test.ts` (Epic 5 PR 5.5): application
 * approve/reject was role-guarded (`admin`/`manager`) but never
 * hotel-scoped, so a manager could approve or reject an application
 * belonging to a work request outside their scope claim. `approve()` (the
 * ACCEPTED path) and `update()`'s REJECTED path now run the same in-service
 * `isHotelInScope()` check as `quality/service.ts` and `attendance/service.ts`
 * whenever `FEATURE_SCOPE_AUTHZ` is enabled. Admin keeps unconditional
 * cross-hotel access (unchanged, by design); workers (withdraw path) are
 * unaffected. Removing the manager-scope check turns the out-of-scope cases
 * below from 403 into success.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

// wr_id -> the WorkRequest row (hotel_id drives the scope decision).
const workRequests: Record<string, any> = {
  wr_h1: {
    id: 'wr_h1',
    hotel_id: 'h1',
    status: 'OPEN',
    workers_needed: 2,
    workers_confirmed: 0,
    version: 0,
    shift_date: new Date('2026-07-01T00:00:00Z'),
    shift_start_time: '08:00',
    shift_end_time: '16:00',
  },
  wr_h2: {
    id: 'wr_h2',
    hotel_id: 'h2',
    status: 'OPEN',
    workers_needed: 2,
    workers_confirmed: 0,
    version: 0,
    shift_date: new Date('2026-07-01T00:00:00Z'),
    shift_start_time: '08:00',
    shift_end_time: '16:00',
  },
};

// application_id -> the WorkApplication row.
const applications: Record<string, any> = {
  app_h1: {
    id: 'app_h1',
    work_request_id: 'wr_h1',
    worker_id: 'w1',
    reviewed_by_id: null,
    status: 'PENDING',
    cover_note: null,
    worker_rating_snapshot: null,
    reviewed_at: null,
    rejection_reason: null,
    applied_at: new Date('2026-06-01T00:00:00Z'),
    updated_at: new Date('2026-06-01T00:00:00Z'),
  },
  app_h2: {
    id: 'app_h2',
    work_request_id: 'wr_h2',
    worker_id: 'w2',
    reviewed_by_id: null,
    status: 'PENDING',
    cover_note: null,
    worker_rating_snapshot: null,
    reviewed_at: null,
    rejection_reason: null,
    applied_at: new Date('2026-06-01T00:00:00Z'),
    updated_at: new Date('2026-06-01T00:00:00Z'),
  },
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
  },
}));

const txStub = {
  workRequest: {
    updateMany: async () => ({ count: 1 }),
    findUnique: async ({ where }: any) => workRequests[where.id] ?? null,
    update: async ({ where, data }: any) => ({ ...workRequests[where.id], ...data }),
  },
  workApplication: {
    update: async ({ where, data }: any) => ({ ...applications[where.id], ...data }),
  },
  workerAssignment: {
    create: async ({ data }: any) => ({ id: 'asg_new', ...data }),
  },
  attendance: {
    create: async ({ data }: any) => ({ id: 'att_new', ...data }),
  },
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workApplication: {
      findUnique: async ({ where }: any) => applications[where.id] ?? null,
      update: async ({ where, data }: any) => ({ ...applications[where.id], ...data }),
    },
    workRequest: {
      findUnique: async ({ where }: any) => workRequests[where.id] ?? null,
    },
    auditLog: { create: async () => undefined },
    $transaction: async (cb: any) => cb(txStub),
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
import workApplicationRouter from '../modules/work-applications/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/work-requests/:id/applications', workApplicationRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Work-application scope authorization', () => {
  beforeEach(() => {
    testAuth = null;
  });

  describe('APPROVE / ACCEPTED (SIR-JOBD-002 / FIND-SEC-003)', () => {
    it('allows a manager to approve an application for an in-scope hotel (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h1/applications/app_h1')
        .send({ status: 'ACCEPTED' });
      expect(res.status).toBe(200);
    });

    it('denies a manager approving an application for an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h2/applications/app_h2')
        .send({ status: 'ACCEPTED' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to approve an application cross-hotel (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h2/applications/app_h2')
        .send({ status: 'ACCEPTED' });
      expect(res.status).toBe(200);
    });
  });

  describe('REJECT (SIR-JOBD-002 / FIND-SEC-003)', () => {
    it('allows a manager to reject an application for an in-scope hotel (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h1/applications/app_h1')
        .send({ status: 'REJECTED', rejection_reason: 'not qualified' });
      expect(res.status).toBe(200);
    });

    it('denies a manager rejecting an application for an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h2/applications/app_h2')
        .send({ status: 'REJECTED', rejection_reason: 'not qualified' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to reject an application cross-hotel (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp())
        .patch('/work-requests/wr_h2/applications/app_h2')
        .send({ status: 'REJECTED', rejection_reason: 'not qualified' });
      expect(res.status).toBe(200);
    });
  });
});
