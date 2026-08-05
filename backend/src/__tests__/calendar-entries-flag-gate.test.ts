import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Route-level end-to-end verification of FEATURE_JOBDISPATCH_PHASE2's gate on
 * POST/GET /assignments/calendar-entries (assignments/routes.ts:28-52).
 *
 * assignments-daily-exclusivity.test.ts and calendar-entries.test.ts already
 * cover placeOnCalendar()'s business logic directly against the service, but
 * nothing previously exercised the route-level flag gate itself through a
 * real Express request — this closes that gap by asserting both flag states
 * produce the documented behavior ("both-off = current behavior", i.e. a 404
 * from falling through to no matching route, vs. a real 201/200 when on).
 */

let flagEnabled = false;

jest.mock('../config/feature-flags.js', () => ({
  isJobDispatchPhase2Enabled: () => flagEnabled,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

let testAuth: { userId: string; role: string; scope: unknown } | null = null;

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

const placeOnCalendar = jest.fn(async () => ({
  id: 'ce1',
  assignment_id: 'a1',
  worker_id: 'w1',
  hotel_id: 'h1',
  day: '2026-08-10',
  placed_by_id: 'admin_1',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})) as jest.MockedFunction<(...args: any[]) => any>;

const listCalendarEntries = jest.fn(async () => ({ data: [], total: 0 })) as jest.MockedFunction<
  (...args: any[]) => any
>;

const moveCalendarEntry = jest.fn(async () => ({
  assignment: { id: 'a1', worker_id: 'w1', hotel_id: 'h1' },
  calendar_entry: {
    id: 'ce1',
    assignment_id: 'a1',
    worker_id: 'w1',
    hotel_id: 'h1',
    day: '2026-08-12',
    placed_by_id: 'admin_1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
})) as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../modules/assignments/service.js', () => ({
  assignmentService: {
    placeOnCalendar,
    listCalendarEntries,
    moveCalendarEntry,
    list: jest.fn(async () => ({ data: [], total: 0 })) as jest.MockedFunction<(...args: any[]) => any>,
    getById: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    update: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    logRoomsCompleted: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

import express from 'express';
import request from 'supertest';
import assignmentsRouter from '../modules/assignments/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/assignments', assignmentsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Calendar-entries route: FEATURE_JOBDISPATCH_PHASE2 gate (end-to-end)', () => {
  beforeEach(() => {
    flagEnabled = false;
    testAuth = { userId: 'admin_1', role: 'admin', scope: null };
    placeOnCalendar.mockClear();
    listCalendarEntries.mockClear();
    moveCalendarEntry.mockClear();
  });

  describe('flag OFF (default)', () => {
    it('POST /assignments/calendar-entries falls through to 404, never calling the service', async () => {
      const res = await request(makeApp())
        .post('/assignments/calendar-entries')
        .send({ worker_id: 'w1', hotel_id: 'h1', day: '2026-08-10' });

      expect(res.status).toBe(404);
      expect(placeOnCalendar).not.toHaveBeenCalled();
    });

    it('GET /assignments/calendar-entries never reaches listCalendarEntries', async () => {
      const res = await request(makeApp()).get('/assignments/calendar-entries');
      void res;
      expect(listCalendarEntries).not.toHaveBeenCalled();
    });

    it('PATCH /assignments/calendar-entries/:id/move falls through to 404, never calling the service', async () => {
      const res = await request(makeApp())
        .patch('/assignments/calendar-entries/ce1/move')
        .send({ day: '2026-08-12' });

      expect(res.status).toBe(404);
      expect(moveCalendarEntry).not.toHaveBeenCalled();
    });
  });

  describe('flag ON', () => {
    beforeEach(() => {
      flagEnabled = true;
    });

    it('POST /assignments/calendar-entries reaches the service and returns 201 for an admitted role', async () => {
      const res = await request(makeApp())
        .post('/assignments/calendar-entries')
        .send({ worker_id: 'w1', hotel_id: 'h1', day: '2026-08-10' });

      expect(res.status).toBe(201);
      expect(placeOnCalendar).toHaveBeenCalledTimes(1);
      expect(res.body.data ?? res.body).toMatchObject({ worker_id: 'w1', hotel_id: 'h1', day: '2026-08-10' });
    });

    it('POST /assignments/calendar-entries rejects a worker (not admin/manager/regional_manager) with 403', async () => {
      testAuth = { userId: 'w1', role: 'worker', scope: null };

      const res = await request(makeApp())
        .post('/assignments/calendar-entries')
        .send({ worker_id: 'w1', hotel_id: 'h1', day: '2026-08-10' });

      expect(res.status).toBe(403);
      expect(placeOnCalendar).not.toHaveBeenCalled();
    });

    it('GET /assignments/calendar-entries reaches the service with no role gate (any authenticated role)', async () => {
      testAuth = { userId: 'w1', role: 'worker', scope: null };

      const res = await request(makeApp()).get('/assignments/calendar-entries');

      expect(res.status).toBe(200);
      expect(listCalendarEntries).toHaveBeenCalledTimes(1);
    });

    it('POST /assignments/calendar-entries rejects a malformed body with 400, never calling the service', async () => {
      const res = await request(makeApp())
        .post('/assignments/calendar-entries')
        .send({ worker_id: 'w1' }); // missing hotel_id/day

      expect(res.status).toBe(422);
      expect(placeOnCalendar).not.toHaveBeenCalled();
    });

    it('PATCH /assignments/calendar-entries/:id/move reaches the service and returns 200 for an admitted role', async () => {
      const res = await request(makeApp())
        .patch('/assignments/calendar-entries/ce1/move')
        .send({ day: '2026-08-12' });

      expect(res.status).toBe(200);
      expect(moveCalendarEntry).toHaveBeenCalledTimes(1);
      expect(moveCalendarEntry.mock.calls[0]?.[0]).toBe('ce1');
      expect(moveCalendarEntry.mock.calls[0]?.[1]).toEqual({ day: '2026-08-12' });
    });

    it('PATCH /assignments/calendar-entries/:id/move admits manager and regional_manager', async () => {
      testAuth = { userId: 'mgr1', role: 'manager', scope: null };
      const managerRes = await request(makeApp())
        .patch('/assignments/calendar-entries/ce1/move')
        .send({ day: '2026-08-12' });
      expect(managerRes.status).toBe(200);

      testAuth = { userId: 'rm1', role: 'regional_manager', scope: null };
      const rmRes = await request(makeApp())
        .patch('/assignments/calendar-entries/ce1/move')
        .send({ day: '2026-08-12' });
      expect(rmRes.status).toBe(200);

      expect(moveCalendarEntry).toHaveBeenCalledTimes(2);
    });

    it('PATCH /assignments/calendar-entries/:id/move rejects a worker with 403', async () => {
      testAuth = { userId: 'w1', role: 'worker', scope: null };

      const res = await request(makeApp())
        .patch('/assignments/calendar-entries/ce1/move')
        .send({ day: '2026-08-12' });

      expect(res.status).toBe(403);
      expect(moveCalendarEntry).not.toHaveBeenCalled();
    });

    it('PATCH /assignments/calendar-entries/:id/move rejects a malformed body with 422, never calling the service', async () => {
      const res = await request(makeApp())
        .patch('/assignments/calendar-entries/ce1/move')
        .send({ day: 'not-a-date' });

      expect(res.status).toBe(422);
      expect(moveCalendarEntry).not.toHaveBeenCalled();
    });
  });
});
