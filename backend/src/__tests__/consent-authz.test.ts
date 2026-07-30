import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * SPEC-CONSENT-001@0.2.0 FROZEN, ADR-015/ADR-037 (GD-17 Decided 2026-07-28):
 * route-level authorization + validation regression. Confirmed actor model:
 * self-scoped writes for any authenticated role (self-scope is itself the
 * authorization, same pattern as GeoService's /checkins); GetAuditHistory is
 * self-or-Admin (OD-CONSENT-011/ADR-037), enforced service-side.
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

// Mocks the SERVICE, not the controller, so the real ConsentController's own
// `if (!req.auth) throw new UnauthorizedError()` guard actually runs (same
// precedent as geo-authz.test.ts).
const checkStatus = jest.fn(async () => ({ status: 'absent' })) as jest.MockedFunction<
  (...args: any[]) => any
>;
const requestConsent = jest.fn(async () => ({
  consent_instance: 'daily-access-gate',
  notice_version: 'v1',
  notice_content: '[de] ...',
  language: 'de',
  rtl: false,
})) as jest.MockedFunction<(...args: any[]) => any>;
const recordDecision = jest.fn(async () => ({
  id: 'c1',
  worker_id: 'w1',
  consent_instance: 'daily-access-gate',
  notice_version: 'v1',
  decision: 'GRANTED',
  decided_at: '2026-07-30T00:00:00.000Z',
})) as jest.MockedFunction<(...args: any[]) => any>;
const withdrawConsent = jest.fn(async () => ({
  id: 'c1',
  worker_id: 'w1',
  consent_instance: 'daily-access-gate',
  notice_version: 'v1',
  decision: 'WITHDRAWN',
  decided_at: '2026-07-30T00:00:00.000Z',
})) as jest.MockedFunction<(...args: any[]) => any>;
const getAuditHistory = jest.fn(async () => ({ data: [], total: 0 })) as jest.MockedFunction<
  (...args: any[]) => any
>;

jest.mock('../modules/consent/service.js', () => ({
  consentService: { checkStatus, requestConsent, recordDecision, withdrawConsent, getAuditHistory },
}));

import express from 'express';
import request from 'supertest';
import consentRouter from '../modules/consent/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/consent', consentRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Consent route authorization (SPEC-CONSENT-001, ADR-015/ADR-037)', () => {
  beforeEach(() => {
    testAuth = null;
    jest.clearAllMocks();
  });

  describe('GET /consent/status — self-scoped, any authenticated role', () => {
    it('allows a worker to check their own status', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/consent/status?consent_instance=daily-access-gate');
      expect(res.status).toBe(200);
    });

    it('rejects an unauthenticated request with 401', async () => {
      testAuth = null;
      const res = await request(makeApp()).get('/consent/status?consent_instance=daily-access-gate');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /consent/decisions — self-scoped', () => {
    it('allows a worker to record their own decision', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/consent/decisions')
        .send({ consent_instance: 'daily-access-gate', decision: 'GRANTED', notice_version: 'v1' });
      expect(res.status).toBe(201);
      expect(recordDecision).toHaveBeenCalledWith(
        'w1',
        'worker',
        expect.objectContaining({ decision: 'GRANTED' }),
        expect.anything()
      );
    });

    it('rejects an unauthenticated request with 401', async () => {
      testAuth = null;
      const res = await request(makeApp())
        .post('/consent/decisions')
        .send({ consent_instance: 'daily-access-gate', decision: 'GRANTED', notice_version: 'v1' });
      expect(res.status).toBe(401);
    });

    it('rejects an invalid decision value with 422', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/consent/decisions')
        .send({ consent_instance: 'daily-access-gate', decision: 'MAYBE', notice_version: 'v1' });
      expect(res.status).toBe(422);
    });
  });

  describe('POST /consent/withdraw — self-scoped', () => {
    it('allows a worker to withdraw their own consent', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/consent/withdraw')
        .send({ consent_instance: 'daily-access-gate' });
      expect(res.status).toBe(201);
      expect(withdrawConsent).toHaveBeenCalledWith('w1', 'worker', 'daily-access-gate', expect.anything());
    });

    it('rejects an unauthenticated request with 401', async () => {
      testAuth = null;
      const res = await request(makeApp())
        .post('/consent/withdraw')
        .send({ consent_instance: 'daily-access-gate' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /consent/audit-history — self-or-Admin (service-side scoping)', () => {
    it('allows an authenticated request through the route gate (ownership binding is service-side)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/consent/audit-history?worker_id=w1');
      expect(res.status).toBe(200);
    });

    it('rejects an unauthenticated request with 401', async () => {
      testAuth = null;
      const res = await request(makeApp()).get('/consent/audit-history?worker_id=w1');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /consent/request — presents notice content', () => {
    it('allows an authenticated caller to request the current notice', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/consent/request')
        .send({ consent_instance: 'daily-access-gate' });
      expect(res.status).toBe(200);
    });

    it('rejects a missing consent_instance with 422', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/consent/request').send({});
      expect(res.status).toBe(422);
    });
  });
});
