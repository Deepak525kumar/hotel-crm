import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Quality scope-authorization regression for Epic 5 PR 5.5 (ADR-024).
 *
 * Cites OQ-03 / OQ-09 / SIR-QUAL-003 / SIR-QUAL-004:
 *  - READ (OQ-03): GET /quality/leaderboard/by-hotel/:hotel_id is guarded by
 *    checkHotelAccess() — a manager may only read in-scope hotels.
 *  - WRITE (OQ-09): POST /quality/verifications and /ratings enforce a manager
 *    scope check inside the service before mutating; checker keeps cross-hotel
 *    write access (preserved). Removing the manager-scope flip turns the
 *    out-of-scope cases from 403 into success.
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

jest.mock('../modules/notifications/service.js', () => ({
  notificationService: {
    sendNotification: async () => undefined,
  },
}));

const txStub = {
  workerAssignment: {
    findUnique: async ({ where }: any) => assignments[where.id] ?? null,
    count: async () => 1,
    findFirst: async () => null,
  },
  rating: {
    create: async ({ data }: any) => ({ id: 'rat_1', ...data }),
    aggregate: async () => ({ _avg: { score: 80 }, _count: 1 }),
  },
  attendance: { count: async () => 1 },
  workerOverallRating: { upsert: async () => undefined },
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerAssignment: {
      findUnique: async ({ where }: any) => assignments[where.id] ?? null,
    },
    qualityVerification: {
      findUnique: async () => null,
      create: async ({ data }: any) => ({ id: 'ver_1', ...data }),
    },
    workerOverallRating: { findMany: async () => [] },
    hotel: {
      findUnique: async ({ where }: any) => ({ hotel_group_id: where.id === 'h1' ? 'g1' : 'g2' }),
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
import qualityRouter from '../modules/quality/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/quality', qualityRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Quality scope authorization', () => {
  beforeEach(() => {
    testAuth = null;
  });

  describe('READ leaderboard by hotel (OQ-03 / SIR-QUAL-003)', () => {
    it('allows a manager to read an in-scope hotel (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['quality:read'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/quality/leaderboard/by-hotel/h1');
      expect(res.status).toBe(200);
    });

    it('denies a manager reading an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['quality:read'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/quality/leaderboard/by-hotel/h2');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to read any hotel (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['quality:read'], scope: null };
      const res = await request(makeApp()).get('/quality/leaderboard/by-hotel/h2');
      expect(res.status).toBe(200);
    });
  });

  describe('WRITE verifications (OQ-09 / SIR-QUAL-004)', () => {
    it('allows a manager to verify an in-scope assignment (201)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['quality:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).post('/quality/verifications').send({ assignment_id: 'asg_h1', score: 80 });
      expect(res.status).toBe(201);
    });

    it('denies a manager verifying an out-of-scope assignment (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['quality:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).post('/quality/verifications').send({ assignment_id: 'asg_h2', score: 80 });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows a checker to verify cross-hotel (preserved, 201)', async () => {
      testAuth = { userId: 'chk_1', role: 'checker', permissions: ['quality:write'], scope: null };
      const res = await request(makeApp()).post('/quality/verifications').send({ assignment_id: 'asg_h2', score: 80 });
      expect(res.status).toBe(201);
    });
  });

  describe('WRITE ratings (OQ-09 / SIR-QUAL-004)', () => {
    it('allows a manager to rate an in-scope assignment (201)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['quality:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .post('/quality/ratings')
        .send({ assignment_id: 'asg_h1', worker_id: 'w1', score: 80 });
      expect(res.status).toBe(201);
    });

    it('denies a manager rating an out-of-scope assignment (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['quality:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .post('/quality/ratings')
        .send({ assignment_id: 'asg_h2', worker_id: 'w1', score: 80 });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows a checker to rate cross-hotel (preserved, 201)', async () => {
      testAuth = { userId: 'chk_1', role: 'checker', permissions: ['quality:write'], scope: null };
      const res = await request(makeApp())
        .post('/quality/ratings')
        .send({ assignment_id: 'asg_h2', worker_id: 'w1', score: 80 });
      expect(res.status).toBe(201);
    });
  });
});
