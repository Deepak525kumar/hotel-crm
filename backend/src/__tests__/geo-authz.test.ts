import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * SPEC-GEO-001 @0.1.2 FROZEN, GD-14 Decided 2026-07-27: route-level
 * authorization + validation regression. GD-14's confirmed actor model:
 * self-checkin (worker, any authenticated role — self-scope is itself the
 * authorization, same pattern as GD-18's /calendar/my-absences and GD-06's
 * /analytics/my-stats); admin/manager read (scoped to hotels/workers within
 * their own scope, enforced service-side, not route-side).
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

// Mocks the SERVICE, not the controller, so the real GeoController's own
// `if (!req.auth) throw new UnauthorizedError()` guard actually runs --
// mocking the controller directly would bypass exactly the check these
// tests exist to pin (same precedent as calendar-my-absences-scope.test.ts).
const checkIn = jest.fn(async () => ({
  id: 'c1',
  worker_id: 'w1',
  hotel_id: 'h1',
  distance_meters: 5,
  inside_radius: true,
  checked_at: '2026-07-28T00:00:00.000Z',
})) as jest.MockedFunction<(...args: any[]) => any>;
const listCheckins = jest.fn(async () => ({ data: [], total: 0 })) as jest.MockedFunction<
  (...args: any[]) => any
>;
const getCheckin = jest.fn(async () => ({
  id: 'c1',
  worker_id: 'w1',
  hotel_id: 'h1',
  distance_meters: 5,
  inside_radius: true,
  checked_at: '2026-07-28T00:00:00.000Z',
})) as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/geo/service.js', () => ({
  geoService: { checkIn, listCheckins, getCheckin },
}));

import express from 'express';
import request from 'supertest';
import geoRouter from '../modules/geo/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/geo', geoRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Geo route authorization (SPEC-GEO-001, GD-14)', () => {
  beforeEach(() => {
    testAuth = null;
  });

  describe('POST /geo/checkins — self-scoped, any authenticated role', () => {
    it('allows a worker to check in', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/geo/checkins')
        .send({ hotel_id: 'h1', latitude: 52.52, longitude: 13.405 });
      expect(res.status).toBe(201);
    });

    it('allows any authenticated role (self-scope is itself the authorization)', async () => {
      testAuth = { userId: 'a1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp())
        .post('/geo/checkins')
        .send({ hotel_id: 'h1', latitude: 52.52, longitude: 13.405 });
      expect(res.status).toBe(201);
    });

    it('rejects an unauthenticated check-in with 401', async () => {
      testAuth = null;
      const res = await request(makeApp())
        .post('/geo/checkins')
        .send({ hotel_id: 'h1', latitude: 52.52, longitude: 13.405 });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /geo/checkins — read (service-side scoping, not route-side)', () => {
    it('allows a worker to list (own check-ins, self-scoped server-side)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/geo/checkins');
      expect(res.status).toBe(200);
    });

    it('allows a manager to list (scope enforced service-side)', async () => {
      testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/geo/checkins');
      expect(res.status).toBe(200);
    });

    it('rejects an unauthenticated list with 401', async () => {
      testAuth = null;
      const res = await request(makeApp()).get('/geo/checkins');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /geo/checkins/:checkin_id', () => {
    it('allows an authenticated request through the route gate (ownership binding is service-side)', async () => {
      testAuth = { userId: 'w1', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/geo/checkins/c1');
      expect(res.status).toBe(200);
    });

    it('rejects an unauthenticated request with 401', async () => {
      testAuth = null;
      const res = await request(makeApp()).get('/geo/checkins/c1');
      expect(res.status).toBe(401);
    });
  });
});
