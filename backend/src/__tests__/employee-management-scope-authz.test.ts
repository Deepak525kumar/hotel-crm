import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Employee-management scope-authorization regression for Epic 5 PR 5.6
 * (SPEC-EMP-001 v0.2.0).
 *
 * Cites REQ-EMP-013 / RULE-EMP-08 / FIND-001 (checkHotelAccess bypass) /
 * REQ-EMP-007 / FIND-002.
 *
 * REQ-EMP-013 / RULE-EMP-08: group-wide employee visibility is deny-by-default
 * — a worker sees only their own profile; a manager/checker is bound to their
 * PR 5.4 JWT `scope` claim; an admin sees all. FIND-001: MODULE_SPEC.md's
 * Security disclosure warns that reusing checkHotelAccess()'s
 * admin/manager/checker bypass unmodified would grant every manager account
 * unrestricted cross-hotel/cross-group access — the blocklist routes below
 * reuse checkHotelAccess() safely only because it is scope-bound (manager
 * scope-authz, ADR-024/PR 5.5, is asserted live via the feature-flags mock).
 * REQ-EMP-007 / FIND-002: special-category fields (konfession, disability
 * status) are restricted to Admin, with a synchronous per-access audit write
 * on both the allow and deny paths, never best-effort.
 *
 * Drives the real employee-management router (real controller + real
 * service) end-to-end via supertest, with only the Prisma layer, auth
 * middleware, and logger mocked. Removing the hotel-scope guard on the
 * blocklist routes, the worker self-only check, or the special-category
 * Admin restriction must fail this suite.
 */

let testAuth:
  | { userId: string; role: string; permissions: string[]; scope: unknown }
  | null = null;

const employmentRecords: Record<string, any> = {
  'E-001': {
    id: 'emp_1',
    user_id: 'user_1',
    employee_id: 'E-001',
    job_title: 'Cleaner',
    start_date: new Date('2026-01-01'),
    status: 'ACTIVE',
    marked_suitable: false,
    hotel_group_id: 'g1',
    skills: [],
    personal_data: null,
    konfession: 'catholic',
    disability_status: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  },
};

const hotelGroups: Record<string, any> = {
  g1: {
    id: 'g1',
    name: 'North Region',
    regional_manager: { id: 'rm_1', first_name: 'Rita', last_name: 'Regional', email: 'rita@hotelcrm.test' },
    hotels: [
      { id: 'h1', name: 'Hotel One', manager: { id: 'mgr_1', first_name: 'Mo', last_name: 'Manager', email: 'mo@hotelcrm.test' } },
    ],
  },
};

const groupEmploymentRecords: Record<string, any[]> = {
  g1: [
    {
      employee_id: 'E-001',
      job_title: 'Cleaner',
      user: { id: 'user_1', first_name: 'Wanda', last_name: 'Worker' },
    },
  ],
};

const auditCalls: any[] = [];

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
    employmentRecord: {
      findUnique: async ({ where }: any) => employmentRecords[where.employee_id] ?? null,
      findMany: async ({ where }: any) => groupEmploymentRecords[where.hotel_group_id] ?? [],
    },
    employeeBlocklistEntry: {
      create: async ({ data }: any) => ({ id: 'bl_1', created_at: new Date(), ...data }),
      findMany: async () => [],
    },
    hotel: {
      findUnique: async ({ where }: any) => ({ hotel_group_id: where.id === 'h1' ? 'g1' : 'g2' }),
      findFirst: async () => null,
    },
    hotelGroup: {
      findFirst: async () => null,
      findUnique: async ({ where }: any) => hotelGroups[where.id] ?? null,
    },
    attendance: { findMany: async () => [] },
    rating: { findMany: async () => [] },
    auditLog: {
      create: async (args: any) => {
        auditCalls.push(args);
        return {};
      },
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

import express from 'express';
import request from 'supertest';
import employeeManagementRouter from '../modules/employee-management/routes.js';
import { AppError } from '../lib/errors.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/employees', employeeManagementRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('Employee-management scope authorization (REQ-EMP-013 / RULE-EMP-08 / FIND-001 / REQ-EMP-007 / FIND-002)', () => {
  beforeEach(() => {
    testAuth = null;
    auditCalls.length = 0;
  });

  describe('POST /employees/hotels/:hotel_id/blocklist — manager hotel-scope enforcement (FIND-001)', () => {
    it('allows a manager to blocklist within their in-scope hotel (201)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .post('/employees/hotels/h1/blocklist')
        .send({ employee_id: 'E-001', reason: 'No-show' });
      expect(res.status).toBe(201);
    });

    it('denies a manager blocklisting at an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp())
        .post('/employees/hotels/h2/blocklist')
        .send({ employee_id: 'E-001', reason: 'No-show' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to blocklist at any hotel (201)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:write'], scope: null };
      const res = await request(makeApp())
        .post('/employees/hotels/h2/blocklist')
        .send({ employee_id: 'E-001', reason: 'No-show' });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /employees/:employee_id/profile — worker self-only visibility (REQ-EMP-013 / RULE-EMP-08)', () => {
    it('allows a worker to view their own profile (200)', async () => {
      testAuth = { userId: 'user_1', role: 'worker', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).get('/employees/E-001/profile');
      expect(res.status).toBe(200);
    });

    it("denies a worker viewing another employee's profile (403)", async () => {
      testAuth = { userId: 'user_other', role: 'worker', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).get('/employees/E-001/profile');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });
  });

  describe('GET /employees/:employee_id/special-category/:field — Admin-only + synchronous audit (REQ-EMP-007 / FIND-002)', () => {
    it('denies a non-admin (manager) actor (403)', async () => {
      testAuth = {
        userId: 'mgr_1',
        role: 'manager',
        permissions: ['employees:special_category:read'],
        scope: { type: 'global' },
      };
      const res = await request(makeApp()).get('/employees/E-001/special-category/konfession');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin (200) and writes the access audit entry synchronously', async () => {
      testAuth = {
        userId: 'adm_1',
        role: 'admin',
        permissions: ['employees:special_category:read'],
        scope: null,
      };
      const res = await request(makeApp()).get('/employees/E-001/special-category/konfession');
      expect(res.status).toBe(200);
      expect(res.body.data.value).toBe('catholic');
      expect(auditCalls.some((c) => c.data.action === 'employee.special_category.access')).toBe(true);
    });
  });

  describe('GET /employees/hotels/:hotel_id/blocklist — hotel-scope enforcement (checkHotelAccess)', () => {
    it('allows a manager to read the blocklist of an in-scope hotel (200)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:read'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/employees/hotels/h1/blocklist');
      expect(res.status).toBe(200);
    });

    it('denies a manager reading the blocklist of an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:read'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).get('/employees/hotels/h2/blocklist');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to read any hotel blocklist (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).get('/employees/hotels/h2/blocklist');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /employees/hotel-groups/:hotel_group_id/org-chart — RM own-group/Admin-only (REQ-EMP-013)', () => {
    it('allows a regional_manager to view their own group\'s org chart (200)', async () => {
      testAuth = {
        userId: 'rm_1',
        role: 'regional_manager',
        permissions: ['employees:read'],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(200);
      expect(res.body.data.hotel_group_id).toBe('g1');
      expect(res.body.data.regional_manager.id).toBe('rm_1');
      expect(res.body.data.hotels).toHaveLength(1);
      expect(res.body.data.employees).toHaveLength(1);
      expect(res.body.data.employees[0].user.first_name).toBe('Wanda');
    });

    it("denies a regional_manager viewing another group's org chart (403)", async () => {
      testAuth = {
        userId: 'rm_2',
        role: 'regional_manager',
        permissions: ['employees:read'],
        scope: { type: 'hotel_group', hotel_group_id: 'g_other' },
      };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies a regional_manager with no scope claim (403)', async () => {
      testAuth = { userId: 'rm_3', role: 'regional_manager', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(403);
    });

    it('denies a hotel manager (not RM/Admin) outright (403)', async () => {
      testAuth = {
        userId: 'mgr_1',
        role: 'manager',
        permissions: ['employees:read'],
        scope: { type: 'hotel', hotel_id: 'h1' },
      };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(403);
    });

    it('denies a worker outright (403)', async () => {
      testAuth = { userId: 'user_1', role: 'worker', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(403);
    });

    it('allows an admin to view any group\'s org chart regardless of scope (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(200);
    });

    it('returns 404 for a hotel group that does not exist', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).get('/employees/hotel-groups/missing/org-chart');
      expect(res.status).toBe(404);
    });

    it('audit-logs the org chart view', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:read'], scope: null };
      await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(auditCalls.some((c) => c.data.action === 'employee.org_chart.view')).toBe(true);
    });
  });

  describe('POST /employees/:employee_id/lifecycle-signal — Admin-only transport (OD-EMP-09)', () => {
    it('denies a non-admin (manager) actor at the route (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:write'], scope: { type: 'global' } };
      const res = await request(makeApp())
        .post('/employees/E-001/lifecycle-signal')
        .send({ signal: 'submitted_for_review' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });
  });
});
