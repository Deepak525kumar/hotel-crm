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
    listPayroll: ok,
    createPayroll: ok,
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

  describe('list routes (Admin-only — no scope model to filter a manager view)', () => {
    it('allows admin on GET /hr/contracts', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: ['hr:read'], scope: null };
      const res = await request(makeApp()).get('/hr/contracts');
      expect(res.status).toBe(200);
    });

    it('denies manager on GET /hr/contracts (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:read'], scope: { type: 'global' } };
      const res = await request(makeApp()).get('/hr/contracts');
      expect(res.status).toBe(403);
    });

    it('denies manager on GET /hr/payroll (403)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: ['hr:read'], scope: { type: 'global' } };
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.status).toBe(403);
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

    it('denies worker and checker on POST /hr/contracts (403, blocked by role gate before scope check)', async () => {
      for (const role of ['worker', 'checker']) {
        testAuth = { userId: 'x1', role, permissions: [], scope: null };
        const res = await request(makeApp()).post('/hr/contracts').send({ worker_id: 'w1' });
        expect(res.status).toBe(403);
      }
      expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
    });
  });
});
