import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * SPEC-RETENTION-001@0.2.0 REVIEW (NOT FROZEN), PR 5 of 5: route-level
 * authorization + validation regression for GetDeletionAuditLog/
 * CheckEligibility. Confirmed actor model: any authenticated role, no
 * Admin-only gate (OD-RETENTION-05 explicitly OPEN for GetDeletionAuditLog;
 * CheckEligibility names no Admin caller class at all) -- mirrors
 * consent-authz.test.ts's structure.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

// Mocks the SERVICE, not the controller, so the real RetentionController's
// own `if (!req.auth) throw new UnauthorizedError()` guard actually runs
// (same precedent as consent-authz.test.ts).
const getDeletionAuditLog = jest.fn(async () => ({ data: [], total: 0 })) as jest.MockedFunction<
  (...args: any[]) => any
>;
const checkEligibility = jest.fn(async () => ({ status: 'not_found' })) as jest.MockedFunction<
  (...args: any[]) => any
>;

jest.mock('../modules/retention/service.js', () => ({
  retentionService: { getDeletionAuditLog, checkEligibility },
}));

import express from 'express';
import request from 'supertest';
import retentionRouter from '../modules/retention/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/retention', retentionRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Retention route authorization (SPEC-RETENTION-001)', () => {
  beforeEach(() => {
    testAuth = null;
    jest.clearAllMocks();
  });

  describe('GET /retention/audit-log — any authenticated role, no Admin gate (OD-RETENTION-05 open)', () => {
    it('allows any authenticated role', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/retention/audit-log');
      expect(res.status).toBe(200);
      expect(getDeletionAuditLog).toHaveBeenCalled();
    });

    it('rejects an unauthenticated request with 401', async () => {
      testAuth = null;
      const res = await request(makeApp()).get('/retention/audit-log');
      expect(res.status).toBe(401);
      expect(getDeletionAuditLog).not.toHaveBeenCalled();
    });

    it('rejects per_page above 100 with 422', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/retention/audit-log?per_page=101');
      expect(res.status).toBe(422);
      expect(getDeletionAuditLog).not.toHaveBeenCalled();
    });

    it('passes parsed query filters through to the service', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      await request(makeApp()).get('/retention/audit-log?module_id=attendance&category_id=shift_coordinate');
      expect(getDeletionAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ module_id: 'attendance', category_id: 'shift_coordinate' })
      );
    });

    it('returns pagination metadata in the response envelope', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      getDeletionAuditLog.mockResolvedValueOnce({ data: [], total: 25 });
      const res = await request(makeApp()).get('/retention/audit-log?page=2&per_page=10');
      expect(res.body.pagination).toEqual({
        page: 2,
        per_page: 10,
        total: 25,
        total_pages: 3,
        has_next: true,
        has_prev: true,
      });
    });
  });

  describe('GET /retention/eligibility — any authenticated role, no Admin caller class named', () => {
    it('allows any authenticated role', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get(
        '/retention/eligibility?module_id=attendance&category_id=shift_coordinate'
      );
      expect(res.status).toBe(200);
      expect(checkEligibility).toHaveBeenCalled();
    });

    it('rejects an unauthenticated request with 401', async () => {
      testAuth = null;
      const res = await request(makeApp()).get(
        '/retention/eligibility?module_id=attendance&category_id=shift_coordinate'
      );
      expect(res.status).toBe(401);
      expect(checkEligibility).not.toHaveBeenCalled();
    });

    it('rejects a missing module_id with 422', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/retention/eligibility?category_id=shift_coordinate');
      expect(res.status).toBe(422);
      expect(checkEligibility).not.toHaveBeenCalled();
    });

    it('rejects a missing category_id with 422', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/retention/eligibility?module_id=attendance');
      expect(res.status).toBe(422);
      expect(checkEligibility).not.toHaveBeenCalled();
    });

    it('passes an optional record_ref through to the service', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      await request(makeApp()).get(
        '/retention/eligibility?module_id=attendance&category_id=shift_coordinate&record_ref=rec-42'
      );
      expect(checkEligibility).toHaveBeenCalledWith(
        expect.objectContaining({ module_id: 'attendance', category_id: 'shift_coordinate', record_ref: 'rec-42' })
      );
    });

    it('omits record_ref from the parsed query when not supplied', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      await request(makeApp()).get(
        '/retention/eligibility?module_id=attendance&category_id=shift_coordinate'
      );
      const call = checkEligibility.mock.calls[0][0] as Record<string, unknown>;
      expect(call.record_ref).toBeUndefined();
    });
  });

  describe('unrouted interfaces (RegisterCategory/TagRecord remain in-process-only)', () => {
    it('has no route for category registration', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/retention/categories')
        .send({ module_id: 'attendance', category_id: 'shift_coordinate', tier: 'TIER_1' });
      expect(res.status).toBe(404);
    });

    it('has no route for record tagging', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/retention/records')
        .send({ module_id: 'attendance', category_id: 'shift_coordinate', record_ref: 'r1', tagged_at: '2026-08-01' });
      expect(res.status).toBe(404);
    });
  });
});
