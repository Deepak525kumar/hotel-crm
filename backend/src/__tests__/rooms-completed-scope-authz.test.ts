import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Rooms-completed scope-authorization regression (ADR-028, OQ-ANALYTICS-03).
 *
 * Mirrors quality-scope-authz.test.ts's WRITE-verification/rating shape (Epic 5
 * PR 5.5, ADR-024): POST /assignments/:id/rooms-completed is guarded by
 * requireRole(['admin','manager']) at the route, and a manager is additionally
 * scope-bound to the assignment's hotel inside the service (assignment_id, not
 * hotel_id, is the path param, so checkHotelAccess() cannot read hotel_id off
 * the URL here — same shape as quality's createVerification/createRating).
 * Removing either guard turns the corresponding case below from 403 into 201.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

// assignment_id -> hotel it belongs to.
const assignments: Record<string, { id: string; hotel_id: string; worker_id: string }> = {
  asg_h1: { id: 'asg_h1', hotel_id: 'h1', worker_id: 'w1' },
  asg_h2: { id: 'asg_h2', hotel_id: 'h2', worker_id: 'w1' },
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

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerAssignment: {
      findUnique: async ({ where }: any) => assignments[where.id] ?? null,
    },
    roomsCompletedEntry: {
      create: async ({ data }: any) => ({
        id: 'rce_1',
        ...data,
        notes: data.notes ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    },
    hotel: {
      findUnique: async ({ where }: any) => ({ hotel_group_id: where.id === 'h1' ? 'g1' : 'g2' }),
    },
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
import assignmentsRouter from '../modules/assignments/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/assignments', assignmentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Rooms-completed scope authorization (ADR-028, OQ-ANALYTICS-03)', () => {
  beforeEach(() => {
    testAuth = null;
  });

  describe('ROLE gate', () => {
    it('denies a worker (403)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/assignments/asg_h1/rooms-completed')
        .send({ rooms_completed: 5 });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies a checker (403) — rooms-completed is manager-only per PIVOT §4.9, unlike quality writes', async () => {
      testAuth = { userId: 'chk1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/assignments/asg_h1/rooms-completed')
        .send({ rooms_completed: 5 });
      expect(res.status).toBe(403);
    });
  });

  describe('WRITE scope (manager hotel-bound, admin unrestricted)', () => {
    it('allows a manager to log rooms completed for an in-scope assignment (201)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .post('/assignments/asg_h1/rooms-completed')
        .send({ rooms_completed: 10 });
      expect(res.status).toBe(201);
      expect(res.body.data.rooms_completed).toBe(10);
    });

    it('denies a manager logging rooms completed for an out-of-scope assignment (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .post('/assignments/asg_h2/rooms-completed')
        .send({ rooms_completed: 10 });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to log rooms completed for any hotel (201)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/assignments/asg_h2/rooms-completed')
        .send({ rooms_completed: 3 });
      expect(res.status).toBe(201);
    });
  });

  describe('validation', () => {
    it('rejects a negative rooms_completed (422, ValidationError)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/assignments/asg_h1/rooms-completed')
        .send({ rooms_completed: -1 });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe('ValidationError');
    });

    it('rejects a missing assignment (404)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/assignments/asg_missing/rooms-completed')
        .send({ rooms_completed: 5 });
      expect(res.status).toBe(404);
    });
  });
});
