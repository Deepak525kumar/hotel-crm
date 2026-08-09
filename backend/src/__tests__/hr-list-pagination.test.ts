import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Pagination on GET /hr/contracts and GET /hr/payroll.
 *
 * These go through the real router + validateQuery middleware, not straight
 * into the service: Express hands every query param over as a STRING, and
 * both services pass page/limit into Prisma's skip/take, which require
 * numbers. A service-level test that calls `listContracts({page: 1})` with
 * real numbers cannot catch that — it never exercises the string the HTTP
 * layer actually delivers. `?limit=20` reaching `take: "20"` is a runtime
 * Prisma rejection, so these assert on the coerced TYPE, not just the value.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

const mockContractFindMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockContractCount = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockPayslipFindMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockPayslipCount = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
  },
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    contract: { findMany: mockContractFindMany, count: mockContractCount },
    payslipRequest: { findMany: mockPayslipFindMany, count: mockPayslipCount },
    auditLog: { create: jest.fn() },
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
import hrRouter from '../modules/hr/routes.js';
import { AppError } from '../lib/errors.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import { HR_DEFAULT_PAGE_SIZE, HR_MAX_PAGE_SIZE } from '../modules/hr/types.js';

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

describe('HR list pagination (query coercion through the real HTTP layer)', () => {
  beforeEach(() => {
    testAuth = { userId: 'a1', role: 'admin', permissions: [...ROLE_PERMISSIONS.ADMIN], scope: null };
    for (const m of [mockContractFindMany, mockContractCount, mockPayslipFindMany, mockPayslipCount]) {
      m.mockReset();
    }
    mockContractFindMany.mockResolvedValue([]);
    mockContractCount.mockResolvedValue(0);
    mockPayslipFindMany.mockResolvedValue([]);
    mockPayslipCount.mockResolvedValue(0);
  });

  describe('GET /hr/contracts', () => {
    it('coerces ?page/?limit strings into the NUMBERS Prisma skip/take require', async () => {
      const res = await request(makeApp()).get('/hr/contracts?page=3&limit=10');
      expect(res.status).toBe(200);

      const args = mockContractFindMany.mock.calls[0][0];
      expect(typeof args.skip).toBe('number');
      expect(typeof args.take).toBe('number');
      expect(args.skip).toBe(20); // (3 - 1) * 10
      expect(args.take).toBe(10);
    });

    it('applies the default page size when no limit is supplied', async () => {
      await request(makeApp()).get('/hr/contracts');
      const args = mockContractFindMany.mock.calls[0][0];
      expect(args.skip).toBe(0);
      expect(args.take).toBe(HR_DEFAULT_PAGE_SIZE);
    });

    it('rejects a non-numeric limit rather than passing NaN to Prisma', async () => {
      const res = await request(makeApp()).get('/hr/contracts?limit=abc');
      expect(res.status).toBe(422);
      expect(mockContractFindMany).not.toHaveBeenCalled();
    });

    it('rejects a limit above the maximum rather than allowing an unbounded scan', async () => {
      const res = await request(makeApp()).get(`/hr/contracts?limit=${HR_MAX_PAGE_SIZE + 1}`);
      expect(res.status).toBe(422);
      expect(mockContractFindMany).not.toHaveBeenCalled();
    });

    it('rejects page=0 (a 0-based page would silently skip negatively)', async () => {
      const res = await request(makeApp()).get('/hr/contracts?page=0');
      expect(res.status).toBe(422);
      expect(mockContractFindMany).not.toHaveBeenCalled();
    });

    it('returns the total count in meta alongside the data array', async () => {
      mockContractCount.mockResolvedValue(42);
      const res = await request(makeApp()).get('/hr/contracts');
      expect(res.body.meta.total).toBe(42);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /hr/payroll', () => {
    it('coerces ?page/?limit strings into numbers', async () => {
      const res = await request(makeApp()).get('/hr/payroll?page=2&limit=5');
      expect(res.status).toBe(200);

      const args = mockPayslipFindMany.mock.calls[0][0];
      expect(typeof args.skip).toBe('number');
      expect(typeof args.take).toBe('number');
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
    });

    it('rejects a non-numeric page', async () => {
      const res = await request(makeApp()).get('/hr/payroll?page=xyz');
      expect(res.status).toBe(422);
      expect(mockPayslipFindMany).not.toHaveBeenCalled();
    });

    it('returns the total count in meta', async () => {
      mockPayslipCount.mockResolvedValue(7);
      const res = await request(makeApp()).get('/hr/payroll');
      expect(res.body.meta.total).toBe(7);
    });
  });
});
