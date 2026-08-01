import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * SPEC-COMPLIANCE-001@0.1.0 REVIEW (NOT FROZEN), PR 3 of 4: route-level
 * authorization regression for IF-COMPLIANCE-FulfilSubjectRightsRequest.
 * Confirmed actor model: any authenticated role, self-scoped to the
 * caller's own worker_id (req.auth.userId) -- no Admin-on-behalf-of-worker
 * caller class is named in this interface's own spec row (unlike the
 * deferred IF-COMPLIANCE-GetGovernanceReport's undefined "Admin/DPO-
 * equivalent" class, OD-COMPLIANCE-006, not built here). Mirrors
 * retention-authz.test.ts's/consent-authz.test.ts's structure.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

// Mocks the SERVICE, not the controller, so the real ComplianceController's
// own `if (!req.auth) throw new UnauthorizedError()` guard actually runs
// (same precedent as retention-authz.test.ts/consent-authz.test.ts).
const fulfilSubjectRightsRequest = jest.fn(async (workerId: string) => ({
  worker_id: workerId,
  generated_at: '2026-08-02T12:00:00.000Z',
  documents: { status: 'ok', data: [] },
  consent_history: { status: 'ok', data: { data: [], total: 0 } },
  audit_trail: { status: 'ok', data: { data: [], total: 0 } },
})) as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/compliance/service.js', () => ({
  complianceService: { fulfilSubjectRightsRequest },
}));

import express from 'express';
import request from 'supertest';
import complianceRouter from '../modules/compliance/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/compliance', complianceRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Compliance route authorization (SPEC-COMPLIANCE-001)', () => {
  beforeEach(() => {
    testAuth = null;
    jest.clearAllMocks();
  });

  describe('POST /compliance/subject-rights-export — any authenticated role, self-scoped', () => {
    it('allows any authenticated role', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/compliance/subject-rights-export');
      expect(res.status).toBe(200);
      expect(fulfilSubjectRightsRequest).toHaveBeenCalled();
    });

    it('rejects an unauthenticated request with 401', async () => {
      testAuth = null;
      const res = await request(makeApp()).post('/compliance/subject-rights-export');
      expect(res.status).toBe(401);
      expect(fulfilSubjectRightsRequest).not.toHaveBeenCalled();
    });

    it('always derives worker_id from req.auth.userId, never from a body field', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      await request(makeApp())
        .post('/compliance/subject-rights-export')
        .send({ worker_id: 'someone-elses-id' });

      expect(fulfilSubjectRightsRequest).toHaveBeenCalledWith('w1');
    });

    it('scopes to the caller identity for every role, not just worker', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: null };
      await request(makeApp()).post('/compliance/subject-rights-export');

      expect(fulfilSubjectRightsRequest).toHaveBeenCalledWith('m1');
    });

    it('returns the assembled bundle in the response envelope', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/compliance/subject-rights-export');

      expect(res.body.status).toBe('success');
      expect(res.body.data.worker_id).toBe('w1');
      expect(res.body.meta.request_id).toBeTruthy();
    });
  });
});
