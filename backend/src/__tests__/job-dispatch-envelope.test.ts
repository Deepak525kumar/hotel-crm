import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Envelope-shape regression for Epic 9 PR 9.1 (response-envelope extraction).
 *
 * `backend/src/lib/http-envelope.ts`'s `sendSuccess()`/`sendPaginated()` are a
 * pure extraction of the inline shape every `work-requests` and `assignments`
 * controller handler built before this PR (e.g.
 * `work-requests/controller.ts:30-34,56-68` pre-refactor) — no contract change.
 * This test asserts every job-dispatch-family endpoint still returns exactly
 * `{status, data, pagination?, meta:{timestamp, request_id}}`, so a future
 * change to the shared helper cannot silently alter the wire shape for either
 * remaining module without failing here.
 *
 * Epic 9 PR 9.2: the `work-applications` describe block (and its fixtures/
 * mocks) was removed here — the module it exercised (WorkApplication routes/
 * controller/service) was deleted in this PR (TREQ-011).
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

const workRequests: Record<string, any> = {
  wr_1: {
    id: 'wr_1',
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
    status: 'OPEN',
    published_at: new Date('2026-06-01T00:00:00Z'),
    expires_at: null,
    filled_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: new Date('2026-06-01T00:00:00Z'),
    updated_at: new Date('2026-06-01T00:00:00Z'),
  },
};

const assignments: Record<string, any> = {
  asg_1: {
    id: 'asg_1',
    work_request_id: 'wr_1',
    worker_id: 'wkr_1',
    hotel_id: 'h1',
    assigned_by_id: 'mgr_1',
    status: 'CONFIRMED',
    confirmed_at: new Date('2026-06-02T00:00:00Z'),
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    updated_at: new Date('2026-06-02T00:00:00Z'),
  },
};

const hotels: Record<string, any> = {
  h1: { id: 'h1', deleted_at: null, accepting_jobs: true, hotel_group_id: 'g1' },
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

jest.mock('../lib/roster-scope.js', () => ({
  isWorkerEligibleForHotel: async () => true,
  listEligibleHotelIds: async () => ['h1'],
  listEligibleWorkerIds: async () => ['wkr_1'],
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    hotel: {
      findUnique: async ({ where }: any) => hotels[where.id] ?? null,
    },
    jobRequest: {
      findUnique: async ({ where }: any) => workRequests[where.id] ?? null,
      findMany: async () => Object.values(workRequests),
      count: async () => Object.values(workRequests).length,
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
    workerAssignment: {
      findUnique: async ({ where }: any) => assignments[where.id] ?? null,
      findMany: async () => Object.values(assignments),
      count: async () => Object.values(assignments).length,
    },
    employmentRecord: { findMany: async () => [] },
    auditLog: { create: async () => undefined },
    $transaction: async (fn: any) =>
      fn({
        jobRequest: {
          update: async ({ where, data }: any) => ({
            ...workRequests[where.id],
            ...data,
            updated_at: new Date(),
          }),
          updateMany: async () => ({ count: 1 }),
          findUnique: async ({ where }: any) => workRequests[where.id] ?? null,
        },
        workerAssignment: { create: async ({ data }: any) => ({ id: 'asg_new', ...data }) },
        attendance: { create: async ({ data }: any) => ({ id: 'att_new', ...data }) },
      }),
  }),
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import workRequestRouter from '../modules/job-requests/routes.js';
import assignmentsRouter from '../modules/assignments/routes.js';
import { requestLoggerMiddleware } from '../middleware/requestLogger.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(requestLoggerMiddleware);
  app.use('/work-requests', workRequestRouter);
  app.use('/assignments', assignmentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

function expectSuccessEnvelope(body: any) {
  expect(body.status).toBe('success');
  expect(body).toHaveProperty('data');
  expect(body.meta).toHaveProperty('timestamp');
  expect(typeof body.meta.timestamp).toBe('string');
  expect(body.meta).toHaveProperty('request_id');
  expect(Object.keys(body).sort()).toEqual(['data', 'meta', 'status'].sort());
  expect(Object.keys(body.meta).sort()).toEqual(['request_id', 'timestamp'].sort());
}

function expectPaginatedEnvelope(body: any) {
  expect(body.status).toBe('success');
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('pagination');
  expect(Object.keys(body.pagination).sort()).toEqual(
    ['page', 'per_page', 'total', 'total_pages', 'has_next', 'has_prev'].sort()
  );
  expect(body.meta).toHaveProperty('timestamp');
  expect(body.meta).toHaveProperty('request_id');
  expect(Object.keys(body).sort()).toEqual(['data', 'meta', 'pagination', 'status'].sort());
}

describe('Job-dispatch response envelope (Epic 9 PR 9.1)', () => {
  beforeEach(() => {
    testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
  });

  describe('work-requests', () => {
    it('GET /work-requests (list) returns the paginated envelope', async () => {
      const res = await request(makeApp()).get('/work-requests');
      expect(res.status).toBe(200);
      expectPaginatedEnvelope(res.body);
    });

    it('GET /work-requests/:id returns the success envelope', async () => {
      const res = await request(makeApp()).get('/work-requests/wr_1');
      expect(res.status).toBe(200);
      expectSuccessEnvelope(res.body);
    });

    it('POST /work-requests returns the success envelope (201)', async () => {
      const res = await request(makeApp())
        .post('/work-requests')
        .send({
          hotel_id: 'h1',
          position: 'cleaner',
          workers_needed: 2,
          shift_date: '2026-07-01',
          shift_start_time: '08:00',
          shift_end_time: '16:00',
          status: 'DRAFT',
        });
      expect(res.status).toBe(201);
      expectSuccessEnvelope(res.body);
    });

    it('PATCH /work-requests/:id returns the success envelope', async () => {
      const res = await request(makeApp())
        .patch('/work-requests/wr_1')
        .send({ status: 'CANCELLED', cancellation_reason: 'no demand' });
      expect(res.status).toBe(200);
      expectSuccessEnvelope(res.body);
    });
  });

  describe('assignments', () => {
    it('GET /assignments (list) returns the paginated envelope', async () => {
      const res = await request(makeApp()).get('/assignments');
      expect(res.status).toBe(200);
      expectPaginatedEnvelope(res.body);
    });

    it('GET /assignments/:id returns the success envelope', async () => {
      const res = await request(makeApp()).get('/assignments/asg_1');
      expect(res.status).toBe(200);
      expectSuccessEnvelope(res.body);
    });
  });
});
