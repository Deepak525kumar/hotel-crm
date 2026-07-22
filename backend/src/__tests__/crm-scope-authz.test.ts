import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * CRM hotel-access scope regression for Epic 5 PR 5.5 (ADR-024).
 *
 * Cites OQ-CRM-17 / SIR-CRM-017: GET /crm/hotels/:hotel_id is guarded by
 * checkHotelAccess(); a manager may only read hotels within their PR 5.4 JWT
 * `scope` claim. Removing the manager-scope flip re-opens cross-hotel reads and
 * turns the out-of-scope case below from 403 into 200.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

jest.mock('../config/feature-flags.js', () => ({
  isScopeAuthzEnabled: () => true,
  isRosterCutoverEnabled: () => false,
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

describe('CRM hotel access scope (OQ-CRM-17 / SIR-CRM-017)', () => {
  beforeEach(() => {
    testAuth = null;
  });

  it('allows a manager to read an in-scope hotel (200)', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['hotels:read'], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/crm/hotels/h1');
    expect(res.status).toBe(200);
  });

  it('denies a manager reading an out-of-scope hotel (403)', async () => {
    testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['hotels:read'], scope: { type: 'hotel', hotel_id: 'h1' } };
    const res = await request(makeApp()).get('/crm/hotels/h2');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });

  it('allows an admin to read any hotel (200)', async () => {
    testAuth = { userId: 'adm_1', role: 'admin', permissions: ['hotels:read'], scope: null };
    const res = await request(makeApp()).get('/crm/hotels/h2');
    expect(res.status).toBe(200);
  });
});
