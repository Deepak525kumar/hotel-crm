import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Analytics hotel-access scope regression for Epic 5 PR 5.5 (ADR-024).
 *
 * Cites OQ-ANALYTICS-12 / SIR-ANLY-014: GET
 * /analytics/leaderboard/by-hotel/:hotel_id is guarded by requireRole +
 * checkHotelAccess(); a manager may only read hotels within their PR 5.4 JWT
 * `scope` claim. Removing the manager-scope flip turns the out-of-scope case
 * below from 403 into 200.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

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
    hotelWorker: { findFirst: async () => null },
    hotel: {
      findUnique: async ({ where }: any) => ({ hotel_group_id: where.id === 'h1' ? 'g1' : 'g2' }),
    },
  }),
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

jest.mock('../modules/analytics/controller.js', () => ({
  analyticsController: {
    getLeaderboard: (_req: Request, res: Response) => res.status(200).json({ ok: true }),
    getDashboardStats: (_req: Request, res: Response) => res.status(200).json({ ok: true }),
    getHotelSummary: (_req: Request, res: Response) => res.status(200).json({ ok: true }),
  },
}));

import express from 'express';
import request from 'supertest';
import analyticsRouter from '../modules/analytics/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use('/analytics', analyticsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Analytics hotel access scope (OQ-ANALYTICS-12 / SIR-ANLY-014)', () => {
  beforeEach(() => {
    testAuth = null;
  });

  it('allows a manager to read an in-scope hotel (200)', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/analytics/leaderboard/by-hotel/h1');
    expect(res.status).toBe(200);
  });

  it('denies a manager reading an out-of-scope hotel (403)', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/analytics/leaderboard/by-hotel/h2');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });

  it('allows an admin to read any hotel (200)', async () => {
    testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).get('/analytics/leaderboard/by-hotel/h2');
    expect(res.status).toBe(200);
  });
});

// OQ-ANALYTICS-12 also covers /analytics/hotel-summary/:hotel_id, whose
// top_workers slice discloses cross-hotel worker PII. This route gains
// checkHotelAccess() so a manager is scoped to their hotels here too.
describe('Analytics hotel-summary scope (OQ-ANALYTICS-12 / SIR-ANLY-014)', () => {
  beforeEach(() => {
    testAuth = null;
  });

  it('allows a manager to read an in-scope hotel summary (200)', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/analytics/hotel-summary/h1');
    expect(res.status).toBe(200);
  });

  it('denies a manager reading an out-of-scope hotel summary (403)', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/analytics/hotel-summary/h2');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });

  it('allows an admin to read any hotel summary (200)', async () => {
    testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).get('/analytics/hotel-summary/h2');
    expect(res.status).toBe(200);
  });
});
