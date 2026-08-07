import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Attendance scope-authorization regression for Epic 5 PR 5.5 (ADR-024).
 *
 * Cites ATT OQ-02 / SIR-ATT-002: a manager must not read or mutate attendance
 * for hotels outside their PR 5.4 JWT `scope` claim. The primary
 * removal-detector here is update() cross-hotel: restoring the old manager
 * bypass makes the out-of-scope PATCH return 200 instead of 403.
 *
 * Drives the real attendance router end-to-end via supertest with authMiddleware
 * replaced by a test-context injector.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

// Attendance rows keyed by id, returned by the mocked findUnique.
const records: Record<string, { id: string; hotel_id: string; worker_id: string }> = {
  att_h1: { id: 'att_h1', hotel_id: 'h1', worker_id: 'w1' },
  att_h2: { id: 'att_h2', hotel_id: 'h2', worker_id: 'w1' },
};

let capturedListWhere: any = null;

function fullRecord(base: { id: string; hotel_id: string; worker_id: string }) {
  return {
    ...base,
    assignment_id: 'asg_1',
    status: 'PRESENT',
    check_in_at: new Date('2026-07-21T08:00:00Z'),
    check_out_at: null,
    expected_start: null,
    expected_end: null,
    minutes_late: null,
    minutes_worked: null,
    notes: null,
    is_verified: false,
    verified_by_id: null,
    verified_at: null,
    created_at: new Date('2026-07-21T07:00:00Z'),
    updated_at: new Date('2026-07-21T07:00:00Z'),
  };
}

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../modules/notifications/service.js', () => ({
  notificationService: {
    sendNotification: async () => undefined,
    enqueue: async () => ({ notification: { id: 'notif-stub' }, outboxEvents: [] }),
  },
}));

const dbMock = {
  attendance: {
    findUnique: async ({ where }: any) => {
      const r = records[where.id];
      return r ? fullRecord(r) : null;
    },
    findMany: async ({ where }: any) => {
      capturedListWhere = where;
      return [];
    },
    count: async () => 0,
    update: async ({ where }: any) => fullRecord(records[where.id] ?? records.att_h1),
  },
  hotel: {
    findUnique: async ({ where }: any) => ({ hotel_group_id: where.id === 'h1' ? 'g1' : 'g2' }),
  },
  auditLog: { create: async () => undefined },
  workerAssignment: { findUnique: async () => ({ assigned_by_id: 'mgr_1' }) },
  // ADR-029 (GD-01, Epic 7 PR 7.3): AttendanceService.update() now wraps its
  // write + notification enqueue in $transaction; hand the same mock object
  // back as `tx` so tx.attendance.update / tx.workerAssignment.findUnique hit
  // the mocks above.
  $transaction: async (cb: any) => cb(dbMock),
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => dbMock,
}));

jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import attendanceRouter from '../modules/attendance/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/attendance', attendanceRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Attendance scope authorization (ATT OQ-02 / SIR-ATT-002)', () => {
  beforeEach(() => {
    testAuth = null;
    capturedListWhere = null;
  });

  describe('PATCH /attendance/:id — manager scope enforcement (removal-detector)', () => {
    it('allows a manager to update an in-scope record (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).patch('/attendance/att_h1').send({ notes: 'ok' });
      expect(res.status).toBe(200);
    });

    it('denies a manager updating an out-of-scope record (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).patch('/attendance/att_h2').send({ notes: 'nope' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    // C-26 write path: an RM may correct attendance for a hotel in its group,
    // and must be denied outside it. Previously the `role === 'manager'` guard
    // skipped the scope check for an RM, and the `isWorker` computation below it
    // evaluated TRUE for an RM — so an RM was treated as a worker on write too.
    it('allows a regional_manager to update an in-group record (200)', async () => {
      testAuth = {
        userId: 'rm_1',
        role: 'regional_manager',
        permissions: [],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).patch('/attendance/att_h1').send({ notes: 'ok' });
      expect(res.status).toBe(200);
    });

    it('denies a regional_manager updating an out-of-group record (403)', async () => {
      testAuth = {
        userId: 'rm_1',
        role: 'regional_manager',
        permissions: [],
        scope: { type: 'hotel_group', hotel_group_id: 'g_other' },
      };
      const res = await request(makeApp()).patch('/attendance/att_h1').send({ notes: 'nope' });
      expect(res.status).toBe(403);
    });

    it('allows an admin to update any record (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp()).patch('/attendance/att_h2').send({ notes: 'ok' });
      expect(res.status).toBe(200);
    });

    it('allows a checker to update any record (cross-hotel preserved, 200)', async () => {
      testAuth = { userId: 'chk_1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).patch('/attendance/att_h2').send({ notes: 'ok' });
      expect(res.status).toBe(200);
    });

    it('denies a worker updating another worker\'s record (403)', async () => {
      testAuth = { userId: 'w_other', role: 'worker', permissions: [], scope: null };
      const res = await request(makeApp()).patch('/attendance/att_h1').send({ notes: 'x' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });
  });

  describe('GET /attendance — manager list scoping', () => {
    it('constrains the manager list query to the scoped hotel', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/attendance');
      expect(res.status).toBe(200);
      expect(capturedListWhere.hotel_id).toBe('h1');
    });

    it('constrains the manager list to the scoped hotel_group', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      const res = await request(makeApp()).get('/attendance');
      expect(res.status).toBe(200);
      expect(capturedListWhere.hotel).toEqual({ hotel_group_id: 'g1' });
    });

    it('denies rows for a manager with no scope (empty-in)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: null };
      const res = await request(makeApp()).get('/attendance');
      expect(res.status).toBe(200);
      expect(capturedListWhere.hotel_id).toEqual({ in: [] });
    });

    it('does not scope-restrict an admin list', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp()).get('/attendance');
      expect(res.status).toBe(200);
      expect(capturedListWhere.hotel_id).toBeUndefined();
      expect(capturedListWhere.hotel).toBeUndefined();
    });

    // Regression: `role !== 'admin' && role !== 'manager' && role !== 'checker'`
    // MATCHED regional_manager, self-scoping an RM to its own attendance rows,
    // while the `role === 'manager'` group filter skipped it — a 200 with the
    // wrong rows. ADR-030 §3 C-26 grants RM `✓ᶜ` on attendance.
    it('constrains a regional_manager list to their hotel_group, not to their own rows (C-26)', async () => {
      testAuth = {
        userId: 'rm_1',
        role: 'regional_manager',
        permissions: [],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).get('/attendance');
      expect(res.status).toBe(200);
      expect(capturedListWhere.hotel).toEqual({ hotel_group_id: 'g1' });
      // The self-scoping regression would have set this to the actor's own id.
      expect(capturedListWhere.worker_id).toBeUndefined();
    });

    it('denies rows for a regional_manager with no scope (empty-in)', async () => {
      testAuth = { userId: 'rm_1', role: 'regional_manager', permissions: [], scope: null };
      const res = await request(makeApp()).get('/attendance');
      expect(res.status).toBe(200);
      expect(capturedListWhere.hotel_id).toEqual({ in: [] });
    });
  });

  // IDOR fix (2026-08-08): getById() never accepted or checked actor.scope
  // at all -- list() and update() in the same file already scope a
  // manager/regional_manager correctly, but getById() let a manager read
  // any single attendance record platform-wide by id, unscoped.
  describe('GET /attendance/:id — manager scope enforcement (IDOR fix, 2026-08-08)', () => {
    it('allows a manager to read an in-scope record (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/attendance/att_h1');
      expect(res.status).toBe(200);
    });

    it('denies a manager reading an out-of-scope record (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/attendance/att_h2');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows a regional_manager to read an in-group record (200)', async () => {
      testAuth = {
        userId: 'rm_1',
        role: 'regional_manager',
        permissions: [],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).get('/attendance/att_h1');
      expect(res.status).toBe(200);
    });

    it('denies a regional_manager reading an out-of-group record (403)', async () => {
      testAuth = {
        userId: 'rm_1',
        role: 'regional_manager',
        permissions: [],
        scope: { type: 'hotel_group', hotel_group_id: 'g_other' },
      };
      const res = await request(makeApp()).get('/attendance/att_h1');
      expect(res.status).toBe(403);
    });

    it('denies a manager with no scope claim (deny-by-default, 403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: [], scope: null };
      const res = await request(makeApp()).get('/attendance/att_h1');
      expect(res.status).toBe(403);
    });

    it('allows an admin to read any record (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: [], scope: null };
      const res = await request(makeApp()).get('/attendance/att_h2');
      expect(res.status).toBe(200);
    });

    it('allows a checker to read any record (cross-hotel preserved, 200)', async () => {
      testAuth = { userId: 'chk_1', role: 'checker', permissions: [], scope: null };
      const res = await request(makeApp()).get('/attendance/att_h2');
      expect(res.status).toBe(200);
    });
  });
});
