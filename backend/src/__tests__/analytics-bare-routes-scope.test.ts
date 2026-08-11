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
const getWorkerStats = jest.fn(async () => ({})) as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/analytics/service.js', () => ({
  analyticsService: { getLeaderboard, getDashboardStats, getHotelSummary, getWorkerStats },
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

  it('honors a manager-supplied ?hotel_id if it belongs to their hotel_group claim', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['analytics:read'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
    // h1 belongs to g1 based on the DB mock
    const res = await request(makeApp()).get('/analytics/leaderboard?hotel_id=h1');
    expect(res.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith('h1', undefined);
  });

  it('rejects with 403 if a manager supplies a ?hotel_id outside their hotel_group claim', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['analytics:read'], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
    // h2 belongs to g2, which is outside g1
    const res = await request(makeApp()).get('/analytics/leaderboard?hotel_id=h2');
    expect(res.status).toBe(403);
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it('honors a hotel-claim manager\'s own hotel_id on /stats', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['analytics:read'], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/analytics/stats?hotel_id=h1');
    expect(res.status).toBe(200);
    expect(getDashboardStats).toHaveBeenCalledWith('h1', undefined);
  });

  it('rejects with 403 if a hotel-claim manager supplies a different hotel_id', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['analytics:read'], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/analytics/stats?hotel_id=h2');
    expect(res.status).toBe(403);
    expect(getDashboardStats).not.toHaveBeenCalled();
  });

  it('denies (empty scope) a manager with no scope claim on /leaderboard', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['analytics:read'], scope: null };
    const res = await request(makeApp()).get('/analytics/leaderboard');
    expect(res.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith(undefined, '__none__');
  });

  it('lets an admin pass through an explicit ?hotel_id unfiltered on /stats', async () => {
    testAuth = { userId: 'adm_1', role: 'admin', permissions: ['admin:*'], scope: null };
    const res = await request(makeApp()).get('/analytics/stats?hotel_id=h2');
    expect(res.status).toBe(200);
    expect(getDashboardStats).toHaveBeenCalledWith('h2', undefined);
  });

  it('lets an admin omit ?hotel_id entirely (every hotel) on /leaderboard', async () => {
    testAuth = { userId: 'adm_1', role: 'admin', permissions: ['admin:*'], scope: null };
    const res = await request(makeApp()).get('/analytics/leaderboard');
    expect(res.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith(undefined, undefined);
  });

  it('rejects /stats for a worker (admin/manager/regional_manager only)', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    const res = await request(makeApp()).get('/analytics/stats');
    expect(res.status).toBe(403);
  });
});

describe('Analytics /my-stats (GD-06) — self-scoped, any authenticated role', () => {
  beforeEach(() => {
    testAuth = null;
    getWorkerStats.mockClear();
  });

  it('scopes to the caller\'s own userId — never a client-supplied worker id, and ignores any attempt to pass one', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
    const res = await request(makeApp()).get('/analytics/my-stats?worker_id=w2&userId=w2');
    expect(res.status).toBe(200);
    expect(getWorkerStats).toHaveBeenCalledWith('w1');
    expect(getWorkerStats).not.toHaveBeenCalledWith('w2');
  });

  it('permits any authenticated role, not just admin/manager', async () => {
    testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
    const res = await request(makeApp()).get('/analytics/my-stats');
    expect(res.status).toBe(200);
    expect(getWorkerStats).toHaveBeenCalledWith('a1');
  });

  it('rejects when unauthenticated', async () => {
    testAuth = null;
    const res = await request(makeApp()).get('/analytics/my-stats');
    expect(res.status).toBe(401);
  });
});
