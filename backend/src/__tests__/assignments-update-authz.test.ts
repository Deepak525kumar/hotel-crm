import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Security-regression test for FIND-SEC-001 / OQ-01 (SPEC-JOB-DISPATCH-001).
 *
 * Guards the fix to `AssignmentService.update()` (PATCH /assignments/:id),
 * which previously had no authorization check at all: any authenticated
 * user of any role could drive any assignment's lifecycle
 * (CONFIRMED -> IN_PROGRESS -> COMPLETED/CANCELLED) for any worker at any
 * hotel. `update()` now applies the same deny-by-default guard already used
 * by `getById()`: admin/manager may act on any assignment; a worker may act
 * only on their own assignment (worker_id match) or one at a hotel in their
 * ACTIVE EmploymentRecord's hotel group.
 *
 * These tests exercise the real assignments router stack end-to-end via
 * supertest, asserting the guard is enforced. Removing it re-opens the
 * defect and fails this suite.
 */

// Test-controlled auth context injected by the mocked authMiddleware.
let testAuth: { userId: string; role: string } | null = null;
// Hotels the actor is eligible at, via the mocked EmploymentRecord/hotel
// group-scope lookup (lib/roster-scope.ts).
let membershipHotelIds: string[] = [];

const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  work_request_id: 'wr1',
  worker_id: 'w1',
  hotel_id: 'h1',
  assigned_by_id: 'mgr1',
  application_id: 'app1',
  status: 'CONFIRMED' as const,
  confirmed_at: new Date('2026-06-01T00:00:00Z'),
  started_at: null,
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  previous_assignment_id: null,
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

let currentAssignment: ReturnType<typeof makeAssignment>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
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

// getPrisma() backs both the assignment lookup/update and the membership check.
jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerAssignment: {
      findUnique: async () => currentAssignment,
      update: async ({ data }: any) => ({ ...currentAssignment, ...data }),
    },
    employmentRecord: {
      findUnique: async ({ where }: any) =>
        membershipHotelIds.length > 0 && where.user_id === testAuth?.userId
          ? { status: 'ACTIVE', hotel_group_id: 'g1' }
          : null,
    },
    hotel: {
      findUnique: async ({ where }: any) =>
        membershipHotelIds.includes(where.id) ? { hotel_group_id: 'g1' } : { hotel_group_id: 'g2' },
    },
    auditLog: { create: async () => ({}) },
  }),
}));

// Replace real JWT auth with an injector of the test-controlled context.
jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import assignmentsRouter from '../modules/assignments/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/assignments', assignmentsRouter);
  // Minimal error handler mapping AppError → its statusCode (mirrors prod).
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('PATCH /assignments/:id authorization (FIND-SEC-001 / OQ-01 regression)', () => {
  beforeEach(() => {
    testAuth = null;
    membershipHotelIds = [];
    currentAssignment = makeAssignment();
  });

  it('allows a worker to transition their OWN assignment (200)', async () => {
    testAuth = { userId: 'w1', role: 'worker' };
    currentAssignment = makeAssignment({ worker_id: 'w1' });
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
  });

  it('denies a worker transitioning ANOTHER worker\'s assignment with no hotel membership (403)', async () => {
    testAuth = { userId: 'w1', role: 'worker' };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h1' });
    membershipHotelIds = [];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });

  it('allows a worker transitioning another worker\'s assignment when holding an ACTIVE hotel membership (200)', async () => {
    testAuth = { userId: 'w1', role: 'worker' };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h1' });
    membershipHotelIds = ['h1'];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
  });

  it('allows a manager regardless of ownership/membership (200)', async () => {
    testAuth = { userId: 'mgr_other', role: 'manager' };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9' });
    membershipHotelIds = [];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
  });

  it('allows an admin regardless of ownership/membership (200)', async () => {
    testAuth = { userId: 'admin_other', role: 'admin' };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9' });
    membershipHotelIds = [];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
  });
});
