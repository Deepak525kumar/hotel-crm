import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * HR route-authorization regression for ADR-030 PR-1 (C-10 / OD-HR-13 /
 * FIND-SEC-HR-04).
 *
 * Prior state: all /hr routes gated on requirePermission('hr:read'/'hr:write')
 * only — no role gate, no hotel/group-scope enforcement. Since MANAGER held
 * both hr:read and hr:write, any manager could reach any worker's contract or
 * payroll data. This suite pins: list routes are Admin-only (no scope model
 * exists yet to filter a manager's view); write routes are scoped via
 * checkWorkerScope() (group-grain, matching EmploymentRecord.hotel_group_id).
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

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

const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    hotel: { findUnique: mockHotelFindUnique },
  }),
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

const ok = (_req: Request, res: Response) => res.status(200).json({ ok: true });
jest.mock('../modules/hr/controller.js', () => ({
  hrController: {
    listContracts: ok,
    createContract: ok,
    getContractStatus: ok,
    uploadSignedContract: ok,
    confirmContractSigned: ok,
    extendContract: ok,
    manualLapseContract: ok,
    listPayroll: ok,
    createPayroll: ok,
    requestPayslip: ok,
    fulfilPayslipRequest: ok,
    uploadDocument: ok,
  },
}));

import express from 'express';
import request from 'supertest';
import hrRouter from '../modules/hr/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/hr', hrRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('HR route authorization (ADR-030 C-10)', () => {
  beforeEach(() => {
    testAuth = null;
    mockEmploymentRecordFindUnique.mockReset();
    mockHotelFindUnique.mockReset();
  });

  describe('list routes (ADR-043: Admin unscoped, Manager scoped server-side inside the service)', () => {
    it('allows admin on GET /hr/contracts', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: ['hr:read'], scope: null };
      const res = await request(makeApp()).get('/hr/contracts');
      expect(res.status).toBe(200);
    });

    it('allows manager on GET /hr/contracts (result-scoping happens inside hrService.listContracts, covered by hr-contract-lifecycle.test.ts)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:read'], scope: { type: 'global' } };
      const res = await request(makeApp()).get('/hr/contracts');
      expect(res.status).toBe(200);
    });

    it('allows manager on GET /hr/payroll (result-scoping happens inside hrService.listPayroll)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:read'], scope: { type: 'global' } };
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.status).toBe(200);
    });

    it('denies worker and checker on GET /hr/contracts (403)', async () => {
      for (const role of ['worker', 'checker']) {
        testAuth = { userId: 'x1', role, permissions: [], scope: null };
        const res = await request(makeApp()).get('/hr/contracts');
        expect(res.status).toBe(403);
      }
    });
  });

  describe('write routes (worker-id scoped)', () => {
    it('allows admin to create a contract for any worker', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: ['hr:write'], scope: null };
      const res = await request(makeApp()).post('/hr/contracts').send({ worker_id: 'w1' });
      expect(res.status).toBe(200);
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });

    it('allows a manager to create a contract for a worker in their group scope', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/hr/contracts').send({ worker_id: 'w1' });
      expect(res.status).toBe(200);
    });

    it('denies a manager creating a contract for a worker outside their group scope (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/hr/contracts').send({ worker_id: 'w1' });
      expect(res.status).toBe(403);
    });

    it('denies a manager creating payroll for a worker outside their group scope (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/hr/payroll').send({ worker_id: 'w1' });
      expect(res.status).toBe(403);
    });

    it('denies a manager uploading a document for a worker outside their group scope (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/hr/workers/w1/documents').send({});
      expect(res.status).toBe(403);
    });

    it('allows a manager in scope to POST /hr/workers/:worker_id/contract-scan', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/hr/workers/w1/contract-scan').send({});
      expect(res.status).toBe(200);
    });

    it('denies a manager outside scope on POST /hr/workers/:worker_id/contract-scan (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/hr/workers/w1/contract-scan').send({});
      expect(res.status).toBe(403);
    });

    it('denies worker on POST /hr/workers/:worker_id/contract-scan (403 — manager/admin only)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/hr/workers/w1/contract-scan').send({});
      expect(res.status).toBe(403);
    });

    it('allows a manager in scope to POST /hr/workers/:worker_id/contract-confirm', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/hr/workers/w1/contract-confirm').send({});
      expect(res.status).toBe(200);
    });

    it('denies a manager outside scope on POST /hr/workers/:worker_id/contract-confirm (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/hr/workers/w1/contract-confirm').send({});
      expect(res.status).toBe(403);
    });

    it('denies worker on POST /hr/workers/:worker_id/contract-confirm (403 — manager/admin only)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/hr/workers/w1/contract-confirm').send({});
      expect(res.status).toBe(403);
    });

    it('allows a manager in scope on POST /hr/workers/:worker_id/contract-extend (RULE-HR-06/07, ADR-040)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/hr/workers/w1/contract-extend').send({});
      expect(res.status).toBe(200);
    });

    it('denies a manager outside scope on POST /hr/workers/:worker_id/contract-extend (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).post('/hr/workers/w1/contract-extend').send({});
      expect(res.status).toBe(403);
    });

    it('denies worker on POST /hr/workers/:worker_id/contract-extend (403 — no worker-side veto/confirm, ADR-040)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/hr/workers/w1/contract-extend').send({});
      expect(res.status).toBe(403);
    });

    it('allows a manager in scope on POST /hr/workers/:worker_id/contract-lapse (ADR-040 PATH a)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).post('/hr/workers/w1/contract-lapse').send({});
      expect(res.status).toBe(200);
    });

    it('denies worker on POST /hr/workers/:worker_id/contract-lapse (403 — no worker-side veto, ADR-040)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/hr/workers/w1/contract-lapse').send({});
      expect(res.status).toBe(403);
    });

    it('denies worker and checker on POST /hr/contracts (403, blocked by role gate before scope check)', async () => {
      for (const role of ['worker', 'checker']) {
        testAuth = { userId: 'x1', role, permissions: [], scope: null };
        const res = await request(makeApp()).post('/hr/contracts').send({ worker_id: 'w1' });
        expect(res.status).toBe(403);
      }
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('POST /hr/payslip-requests (ADR-042: hr:payslip:request, worker self-scoped)', () => {
    it('allows a worker with hr:payslip:request', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: ['hr:payslip:request'], scope: null };
      const res = await request(makeApp()).post('/hr/payslip-requests').send({});
      expect(res.status).toBe(200);
    });

    it('denies a worker without hr:payslip:request (403)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/hr/payslip-requests').send({});
      expect(res.status).toBe(403);
    });

    it('denies manager/admin (this route is worker-only; they use POST /hr/payroll instead)', async () => {
      for (const role of ['admin', 'manager']) {
        testAuth = { userId: 'x1', role, permissions: ['hr:read', 'hr:write'], scope: null };
        const res = await request(makeApp()).post('/hr/payslip-requests').send({});
        expect(res.status).toBe(403);
      }
    });
  });

  describe('POST /hr/payroll/:request_id/fulfil (IF-HR-FulfilPayslipRequest, Manager/Admin only)', () => {
    it('allows manager', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:write'], scope: null };
      const res = await request(makeApp()).post('/hr/payroll/req1/fulfil').send({});
      expect(res.status).toBe(200);
    });

    it('allows admin', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: ['hr:write'], scope: null };
      const res = await request(makeApp()).post('/hr/payroll/req1/fulfil').send({});
      expect(res.status).toBe(200);
    });

    it('denies worker', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).post('/hr/payroll/req1/fulfil').send({});
      expect(res.status).toBe(403);
    });
  });

  describe('GET /hr/workers/:worker_id/contract-status (ADR-042/OD-HR-10, mixed actor set)', () => {
    it('allows admin unconditionally', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: ['hr:read'], scope: null };
      const res = await request(makeApp()).get('/hr/workers/w1/contract-status');
      expect(res.status).toBe(200);
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });

    it('allows a manager in scope (checkWorkerScope, group-grain)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:read'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const res = await request(makeApp()).get('/hr/workers/w1/contract-status');
      expect(res.status).toBe(200);
    });

    it('denies a manager outside scope (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:read'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const res = await request(makeApp()).get('/hr/workers/w1/contract-status');
      expect(res.status).toBe(403);
    });

    it('denies a manager without hr:read, even in scope (403 — requireContractReadAccess() enforces the token, not just the role)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      const res = await request(makeApp()).get('/hr/workers/w1/contract-status');
      expect(res.status).toBe(403);
    });

    it('allows a worker holding hr:contract:read-own to reach the route (ADR-042, enforced by requireContractReadAccess())', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: ['hr:contract:read-own'], scope: null };
      const res = await request(makeApp()).get('/hr/workers/w1/contract-status');
      expect(res.status).toBe(200);
      // scopeWorkerRoute() lets 'worker' straight through checkWorkerScope() —
      // (and its EmploymentRecord lookup) is never invoked for this role.
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });

    it('denies a worker with no hr:* permission at all (403, before scopeWorkerRoute — ADR-042 is enforced, not bypassed)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/hr/workers/w1/contract-status');
      expect(res.status).toBe(403);
    });

    it('denies checker (not in the actor set)', async () => {
      testAuth = { userId: 'x1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/hr/workers/w1/contract-status');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /hr/payroll (ADR-042: hr:payslip:read-own for worker self-read)', () => {
    it('allows admin (hr:read)', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: ['hr:read'], scope: null };
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.status).toBe(200);
    });

    it('allows manager (hr:read; result-scoping happens inside hrService.listPayroll)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:read'], scope: { type: 'global' } };
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.status).toBe(200);
    });

    it('allows a worker holding hr:payslip:read-own (ADR-042, enforced by requirePayslipReadAccess())', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: ['hr:payslip:read-own'], scope: null };
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.status).toBe(200);
    });

    it('denies a worker with no hr:* permission at all (403, ADR-042 enforced — not bypassed by role admission)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.status).toBe(403);
    });

    it('denies a worker holding only hr:payslip:request but not hr:payslip:read-own (403 — write token does not imply read)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: ['hr:payslip:request'], scope: null };
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.status).toBe(403);
    });

    it('denies checker (not in the actor set for this route)', async () => {
      testAuth = { userId: 'x1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.status).toBe(403);
    });
  });
});
