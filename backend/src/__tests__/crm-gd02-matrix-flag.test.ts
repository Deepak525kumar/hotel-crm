import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Route-gate regression for ADR-030 §6 PR-5 (D-3, D-9), behind
 * FEATURE_GD02_MATRIX.
 *
 * D-3: hotel writes narrow from {admin, manager} to admin-only.
 * D-9: hotel-groups routes require `hotel_groups:read`/`hotel_groups:write`
 * instead of `hotels:read`/`hotels:write` once the flag is on.
 *
 * Both must reproduce exact pre-PR-5 behavior while the flag is off (the
 * rollback guarantee) and switch atomically once it's on — read fresh per
 * request, not baked into the route at startup.
 */

let gd02Enabled = false;
let testAuth: { userId: string; role: string; permissions: string[]; scope: unknown } | null = null;

jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => gd02Enabled,
}));

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

const ok = (_req: Request, res: Response) => res.status(200).json({ ok: true });
jest.mock('../modules/crm/controller.js', () => ({
  crmController: {
    listHotels: [ok],
    createHotel: [ok],
    getHotel: ok,
    updateHotel: [ok],
    deleteHotel: ok,
    listHotelGroups: [ok],
    createHotelGroup: [ok],
    getHotelGroup: ok,
    updateHotelGroup: [ok],
    deleteHotelGroup: ok,
  },
}));

import express from 'express';
import request from 'supertest';
import crmRouter from '../modules/crm/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/crm', crmRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('D-3: hotel writes narrow to Admin-only behind FEATURE_GD02_MATRIX', () => {
  beforeEach(() => {
    gd02Enabled = false;
    testAuth = null;
  });

  it('flag OFF: a manager still 403s creating a hotel (matches pre-PR-5: MANAGER never held hotels:write)', async () => {
    testAuth = { userId: 'm1', role: 'manager', permissions: [], scope: null };
    const res = await request(makeApp()).post('/crm/hotels').send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('flag ON: a manager 403s creating a hotel at the role gate', async () => {
    gd02Enabled = true;
    testAuth = { userId: 'm1', role: 'manager', permissions: ['hotels:write'], scope: null };
    const res = await request(makeApp()).post('/crm/hotels').send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('flag ON: an admin still succeeds', async () => {
    gd02Enabled = true;
    testAuth = { userId: 'a1', role: 'admin', permissions: ['hotels:write'], scope: null };
    const res = await request(makeApp()).post('/crm/hotels').send({ name: 'X' });
    expect(res.status).toBe(200);
  });
});

describe('D-9: hotel-groups permission token split behind FEATURE_GD02_MATRIX', () => {
  beforeEach(() => {
    gd02Enabled = false;
    testAuth = null;
  });

  it('flag OFF: a manager with only hotels:read (legacy token) can list hotel groups', async () => {
    testAuth = { userId: 'm1', role: 'manager', permissions: ['hotels:read'], scope: null };
    const res = await request(makeApp()).get('/crm/hotel-groups');
    expect(res.status).toBe(200);
  });

  it('flag OFF: a manager with only the new hotel_groups:read token is denied (token not required yet)', async () => {
    testAuth = { userId: 'm1', role: 'manager', permissions: ['hotel_groups:read'], scope: null };
    const res = await request(makeApp()).get('/crm/hotel-groups');
    expect(res.status).toBe(403);
  });

  it('flag ON: a manager with only the legacy hotels:read token is now denied (M-2 has not backfilled them)', async () => {
    gd02Enabled = true;
    testAuth = { userId: 'm1', role: 'manager', permissions: ['hotels:read'], scope: null };
    const res = await request(makeApp()).get('/crm/hotel-groups');
    expect(res.status).toBe(403);
  });

  it('flag ON: a manager with the new hotel_groups:read token (post-M-2) succeeds', async () => {
    gd02Enabled = true;
    testAuth = { userId: 'm1', role: 'manager', permissions: ['hotel_groups:read'], scope: null };
    const res = await request(makeApp()).get('/crm/hotel-groups');
    expect(res.status).toBe(200);
  });

  it('flag ON: a regional_manager (F-02 fix) is no longer blocked at the role gate', async () => {
    gd02Enabled = true;
    testAuth = { userId: 'rm1', role: 'regional_manager', permissions: ['hotel_groups:read'], scope: null };
    const res = await request(makeApp()).get('/crm/hotel-groups');
    expect(res.status).toBe(200);
  });
});
