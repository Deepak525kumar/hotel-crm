import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Scope regression for the bare /analytics/leaderboard and /analytics/stats
 * routes (ADR-030 PR-4, D-7).
 *
 * Unlike /leaderboard/by-hotel/:hotel_id and /hotel-summary/:hotel_id (both
 * already guarded by checkHotelAccess(), covered in
 * analytics-scope-authz.test.ts), these two bare routes have no route-level
 * scope check at all: prior to PR-4, a manager could pass any client
 * `?hotel_id` (or omit it entirely, reading every hotel/group). This suite
 * mocks the *service*, not the controller, so it exercises the controller's
 * own `resolveScopedFilter` — the fix under test.
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

const getLeaderboard = jest.fn(async () => []) as jest.MockedFunction<(...args: any[]) => any>;
const getDashboardStats = jest.fn(async () => ({})) as jest.MockedFunction<(...args: any[]) => any>;
const getHotelSummary = jest.fn(async () => ({})) as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/analytics/service.js', () => ({
  analyticsService: { getLeaderboard, getDashboardStats, getHotelSummary },
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

describe('Analytics bare-route scope (ADR-030 PR-4)', () => {
  beforeEach(() => {
    testAuth = null;
    getLeaderboard.mockClear();
    getDashboardStats.mockClear();
  });

  it('ignores a manager-supplied ?hotel_id and scopes to their own hotel_group claim', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
    const res = await request(makeApp()).get('/analytics/leaderboard?hotel_id=h_other');
    expect(res.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith(undefined, 'g1');
  });

  it('resolves a hotel-claim manager to their hotel\'s group on /stats, ignoring any client hotel_id', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/analytics/stats?hotel_id=h_other');
    expect(res.status).toBe(200);
    expect(getDashboardStats).toHaveBeenCalledWith(undefined, 'g1');
  });

  it('denies (empty scope) a manager with no scope claim on /leaderboard', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: null };
    const res = await request(makeApp()).get('/analytics/leaderboard');
    expect(res.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith(undefined, '__none__');
  });

  it('lets an admin pass through an explicit ?hotel_id unfiltered on /stats', async () => {
    testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).get('/analytics/stats?hotel_id=h2');
    expect(res.status).toBe(200);
    expect(getDashboardStats).toHaveBeenCalledWith('h2', undefined);
  });

  it('lets an admin omit ?hotel_id entirely (every hotel) on /leaderboard', async () => {
    testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).get('/analytics/leaderboard');
    expect(res.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith(undefined, undefined);
  });
});
