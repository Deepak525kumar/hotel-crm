import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Calendar route-authorization regression for ADR-030 PR-1 (C-13).
 *
 * Prior state: both /calendar/hotels/:hotel_id/operations routes gated on
 * checkHotelAccess() only — no role gate. Since a worker on the hotel's
 * roster passes checkHotelAccess(), a worker could reach the write path for
 * what CRR §19 documents as manager-entered reception/operations data. This
 * suite pins: both routes now require admin/manager; checkHotelAccess()'s
 * existing hotel-scope behavior for those roles is unchanged.
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

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    hotel: { findUnique: async ({ where }: any) => ({ hotel_group_id: where.id === 'h1' ? 'g1' : 'g2' }) },
    employmentRecord: { findUnique: async () => ({ status: 'ACTIVE', hotel_group_id: 'g1' }) },
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
jest.mock('../modules/calendar/controller.js', () => ({
  calendarController: {
    getDailyOperations: ok,
    createDailyOperation: ok,
    getOwnAbsences: ok,
    markAbsence: ok,
    getAvailability: ok,
  },
}));

import express from 'express';
import request from 'supertest';
import calendarRouter from '../modules/calendar/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/calendar', calendarRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Calendar route authorization (ADR-030 C-13)', () => {
  beforeEach(() => {
    testAuth = null;
  });

  it('denies a worker on the hotel roster from reading operations (403)', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    const res = await request(makeApp()).get('/calendar/hotels/h1/operations');
    expect(res.status).toBe(403);
  });

  it('denies a worker on the hotel roster from writing operations (403)', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    const res = await request(makeApp()).post('/calendar/hotels/h1/operations').send({});
    expect(res.status).toBe(403);
  });

  it('denies a checker (previously bypassed checkHotelAccess) from reading operations (403)', async () => {
    testAuth = { userId: 'c1', role: 'checker', permissions: [], scope: null };
    const res = await request(makeApp()).get('/calendar/hotels/h1/operations');
    expect(res.status).toBe(403);
  });

  it('allows a manager with in-scope hotel access to read operations', async () => {
    testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/calendar/hotels/h1/operations');
    expect(res.status).toBe(200);
  });

  it('denies a manager with out-of-scope hotel access (403)', async () => {
    testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h_other' } };
    const res = await request(makeApp()).get('/calendar/hotels/h1/operations');
    expect(res.status).toBe(403);
  });

  it('allows an admin unconditionally', async () => {
    testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).post('/calendar/hotels/h1/operations').send({});
    expect(res.status).toBe(200);
  });
});
