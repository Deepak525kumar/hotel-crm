import { ROLE_PERMISSIONS } from '../config/constants.js';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * SPEC-CALENDAR-001 REQ-CAL-T02/T03 route-level scope regression: /my-absences
 * (GET + POST) must scope strictly to req.auth.userId, never a client-supplied
 * worker id, and must accept any authenticated role (self-scope is itself the
 * authorization -- same pattern as GD-06's /analytics/my-stats).
 */

let testAuth: { userId: string; role: string; permissions: string[] } | null = null;

// Derived from the REAL matrix, exactly as middleware/auth.ts does
// (`ROLE_PERMISSIONS[user.role]`). These fixtures previously hardcoded
// `permissions: []`, which meant they never exercised a permission gate at
// all -- so when POST /my-absences gained `calendar:absence:write-own` on
// 2026-09-04 they failed with 403 while real users were unaffected. Reading
// the real sets makes this suite fail if that token is ever removed from a
// role, which is the protection worth having.
function realPermissions(role: string): string[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

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

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

const getOwnAbsences = jest.fn(async () => []) as jest.MockedFunction<(...args: any[]) => any>;
const markAbsence = jest.fn(async () => ({})) as jest.MockedFunction<(...args: any[]) => any>;
const getDailyOperations = jest.fn(async () => ({})) as jest.MockedFunction<(...args: any[]) => any>;
const createDailyOperation = jest.fn(async () => ({})) as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/calendar/service.js', () => ({
  calendarService: { getOwnAbsences, markAbsence, getDailyOperations, createDailyOperation },
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

describe('Calendar /my-absences (GD-18 narrow slice) — self-scoped, any authenticated role', () => {
  beforeEach(() => {
    testAuth = null;
    getOwnAbsences.mockClear();
    markAbsence.mockClear();
  });

  it('GET scopes to the caller\'s own userId, ignoring any client-supplied worker id', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: realPermissions('WORKER') };
    const res = await request(makeApp()).get('/calendar/my-absences?worker_id=w2');
    expect(res.status).toBe(200);
    expect(getOwnAbsences).toHaveBeenCalledWith('w1');
    expect(getOwnAbsences).not.toHaveBeenCalledWith('w2');
  });

  it('POST scopes to the caller\'s own userId, ignoring a worker_id in the body', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: realPermissions('WORKER') };
    const res = await request(makeApp())
      .post('/calendar/my-absences')
      .send({ day: '2026-08-01', kind: 'SICK', worker_id: 'w2' });
    expect(res.status).toBe(201);
    expect(markAbsence).toHaveBeenCalledWith('w1', { day: '2026-08-01', kind: 'SICK' });
  });

  it('rejects an invalid kind with 422 before reaching the service', async () => {
    testAuth = { userId: 'w1', role: 'worker', permissions: realPermissions('WORKER') };
    const res = await request(makeApp())
      .post('/calendar/my-absences')
      .send({ day: '2026-08-01', kind: 'PARENTAL_LEAVE' });
    expect(res.status).toBe(422);
    expect(markAbsence).not.toHaveBeenCalled();
  });

  it('permits any authenticated role, not just admin/manager', async () => {
    testAuth = { userId: 'a1', role: 'admin', permissions: realPermissions('ADMIN') };
    const res = await request(makeApp()).get('/calendar/my-absences');
    expect(res.status).toBe(200);
    expect(getOwnAbsences).toHaveBeenCalledWith('a1');
  });

  it('rejects GET when unauthenticated', async () => {
    testAuth = null;
    const res = await request(makeApp()).get('/calendar/my-absences');
    expect(res.status).toBe(401);
  });

  it('rejects POST when unauthenticated', async () => {
    testAuth = null;
    const res = await request(makeApp())
      .post('/calendar/my-absences')
      .send({ day: '2026-08-01', kind: 'SICK' });
    expect(res.status).toBe(401);
  });
});
