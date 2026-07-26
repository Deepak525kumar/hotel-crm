import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Security-regression test for S0-6 (EPIC-SECREM).
 *
 * Guards the fix landed by S0-5 (PR #157) for the Critical authorization
 * defect OQ-ANALYTICS-01 / SIR-ANLY-001: GET /analytics/leaderboard and
 * /analytics/leaderboard/by-hotel/:hotel_id previously ran under
 * authMiddleware only, letting any authenticated actor of any role
 * (including a self-signup WORKER) read any hotel's worker names and
 * performance ratings by passing an arbitrary hotel_id.
 *
 * These tests exercise the real analytics router stack end-to-end via
 * supertest, asserting the role guard (requireRole) and hotel-access guard
 * (checkHotelAccess) are enforced. Removing either guard re-opens the
 * defect and fails this suite.
 */

// Test-controlled auth context injected by the mocked authMiddleware.
let testAuth: { userId: string; role: string; hotel_ids: string[]; permissions: string[] } | null =
  null;
// Active memberships the mocked checkHotelAccess DB lookup will find.
let membershipHotelIds: string[] = [];

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

// checkHotelAccess() queries hotelWorker.findFirst for an ACTIVE membership.
jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    hotelWorker: {
      findFirst: async ({ where }: any) =>
        membershipHotelIds.includes(where.hotel_id) && where.worker_id === testAuth?.userId
          ? { id: 'hw_test' }
          : null,
    },
  }),
}));

// Replace real JWT auth with an injector of the test-controlled context.
jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

// Isolate authorization from business logic: a reached controller means the
// guards let the request through.
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
  // Minimal error handler mapping AppError → its statusCode (mirrors prod).
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Analytics leaderboard authorization (S0-6 regression / OQ-ANALYTICS-01)', () => {
  beforeEach(() => {
    testAuth = null;
    membershipHotelIds = [];
  });

  describe('GET /analytics/leaderboard — requireRole([admin, manager])', () => {
    it('denies a worker (403)', async () => {
      testAuth = { userId: 'u_worker', role: 'worker', hotel_ids: [], permissions: [] };
      const res = await request(makeApp()).get('/analytics/leaderboard');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies a checker (403)', async () => {
      testAuth = { userId: 'u_checker', role: 'checker', hotel_ids: [], permissions: [] };
      const res = await request(makeApp()).get('/analytics/leaderboard');
      expect(res.status).toBe(403);
    });

    it('allows an admin (200)', async () => {
      testAuth = { userId: 'u_admin', role: 'admin', hotel_ids: [], permissions: ['admin:*'] };
      const res = await request(makeApp()).get('/analytics/leaderboard');
      expect(res.status).toBe(200);
    });

    it('allows a manager (200)', async () => {
      testAuth = { userId: 'u_mgr', role: 'manager', hotel_ids: [], permissions: ['analytics:read'] };
      const res = await request(makeApp()).get('/analytics/leaderboard');
      expect(res.status).toBe(200);
    });

    // ADR-030 PR-7 follow-up (D-5/C-31): regional_manager was missing from
    // this route's role gate entirely until now — the generated route x role
    // matrix (PR-7) surfaced it as a live gap once FEATURE_RM_ROLE ships.
    it('allows a regional_manager (200)', async () => {
      testAuth = { userId: 'u_rm', role: 'regional_manager', hotel_ids: [], permissions: ['analytics:read'] };
      const res = await request(makeApp()).get('/analytics/leaderboard');
      expect(res.status).toBe(200);
    });

    it('denies a manager lacking the analytics:read token (403)', async () => {
      testAuth = { userId: 'u_mgr', role: 'manager', hotel_ids: [], permissions: [] };
      const res = await request(makeApp()).get('/analytics/leaderboard');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /analytics/leaderboard/by-hotel/:hotel_id — requireRole + checkHotelAccess', () => {
    it('denies a worker before any hotel scoping (403) — the original attack path', async () => {
      testAuth = { userId: 'u_worker', role: 'worker', hotel_ids: [], permissions: [] };
      membershipHotelIds = ['h_arbitrary']; // even a member worker must be role-denied
      const res = await request(makeApp()).get('/analytics/leaderboard/by-hotel/h_arbitrary');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin for any hotel (200)', async () => {
      testAuth = { userId: 'u_admin', role: 'admin', hotel_ids: [], permissions: ['admin:*'] };
      const res = await request(makeApp()).get('/analytics/leaderboard/by-hotel/h_any');
      expect(res.status).toBe(200);
    });

    // Superseded by Epic 5 PR 5.5's scope-authz flip (now unconditional,
    // ADR-030 PR-5 M-4): a manager with no scope claim denies, they don't
    // bypass. See analytics-scope-authz.test.ts for the in-scope/out-of-scope
    // matrix this test predates.
    it('denies a manager with no scope claim for any hotel (403)', async () => {
      testAuth = { userId: 'u_mgr', role: 'manager', hotel_ids: [], permissions: ['analytics:read'] };
      const res = await request(makeApp()).get('/analytics/leaderboard/by-hotel/h_any');
      expect(res.status).toBe(403);
    });
  });
});
