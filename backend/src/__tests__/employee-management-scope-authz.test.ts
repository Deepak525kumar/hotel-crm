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

// Mutable (not `const`, reset per describe.beforeEach below) since
// removeBlocklist tests actually delete from this map.
let blocklistEntries: Record<string, any> = {
  bl_h1: { id: 'bl_h1', hotel_id: 'h1', employment_record_id: 'emp_1', reason: 'No-show', created_by_id: 'adm_1', created_at: new Date() },
  bl_h2: { id: 'bl_h2', hotel_id: 'h2', employment_record_id: 'emp_1', reason: 'No-show', created_by_id: 'adm_1', created_at: new Date() },
};

const groupEmploymentRecords: Record<string, any[]> = {
  g1: [
    {
      employee_id: 'E-001',
      job_title: 'Cleaner',
      status: 'ACTIVE',
      user: { id: 'user_1', first_name: 'Wanda', last_name: 'Worker' },
    },
    {
      employee_id: 'E-002',
      job_title: 'Waiter',
      status: 'UNDER_REVIEW',
      user: { id: 'user_2', first_name: 'Ravi', last_name: 'Review' },
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

// isWorkerInGroupScope (lib/scope.ts) looks up EmploymentRecord BY user_id,
// not employee_id -- a second index alongside `employmentRecords` (keyed by
// employee_id) so the scope check resolves the same fixture record.
const employmentRecordsByUserId: Record<string, any> = Object.fromEntries(
  Object.values(employmentRecords).map((r) => [r.user_id, r])
);

const mockDb = {
  employmentRecord: {
    findUnique: async ({ where }: any) =>
      (where.employee_id ? employmentRecords[where.employee_id] : employmentRecordsByUserId[where.user_id]) ?? null,
    findMany: async ({ where }: any) => groupEmploymentRecords[where.hotel_group_id] ?? [],
    update: async ({ where, data }: any) => {
      const record = Object.values(employmentRecords).find((r) => r.id === where.id);
      Object.assign(record, data);
      return record;
    },
  },
  employmentStatusHistory: {
    create: async (args: any) => ({ id: 'hist_1', ...args.data }),
  },
  user: {
    update: async ({ data }: any) => ({ id: 'user_1', ...data }),
    findUnique: async () => ({ id: 'user_1', role: 'WORKER' }),
  },
  employeeBlocklistEntry: {
    create: async ({ data }: any) => ({ id: 'bl_1', created_at: new Date(), ...data }),
    findMany: async () => [],
    count: async () => 0,
    findUnique: async ({ where }: any) => blocklistEntries[where.id] ?? null,
    delete: async ({ where }: any) => {
      const entry = blocklistEntries[where.id];
      delete blocklistEntries[where.id];
      return entry;
    },
  },
  hotel: {
    findUnique: async ({ where }: any) => ({ hotel_group_id: where.id === 'h1' ? 'g1' : 'g2' }),
    findFirst: async () => null,
  },
  workerDocument: {
    findMany: async () => [
      { category: 'TAX_NUMBER' },
      { category: 'SOCIAL_SECURITY_NUMBER' },
      { category: 'HEALTH_INSURANCE' },
      { category: 'ID_CARD' },
      { category: 'PASSPORT' },
      { category: 'ADDRESS' },
      { category: 'WORK_PERMIT' }
    ],
  },
  contract: {
    findFirst: async () => ({ id: 'mock_contract_1', status: 'ACTIVE' }),
  },
  hotelGroup: {
    findFirst: async () => null,
    findUnique: async ({ where }: any) => hotelGroups[where.id] ?? null,
  },
  attendance: { findMany: async () => [] },
  // The worker's inspection history reads checks since the Rating merge
  // (2026-08-29).
  qualityVerification: { findMany: async () => [] },
  rating: { findMany: async () => [] },
  workerAssignment: { findMany: async () => [] },
  auditLog: {
    create: async (args: any) => {
      auditCalls.push(args);
      return {};
    },
  },
  $transaction: async (cb: any) => cb(mockDb),
};

jest.mock('../lib/db.js', () => ({
  getPrisma: () => mockDb,
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
    // E-001's mutable fields get reset between tests: several new tests in
    // this suite (submit-for-review) call the real service.update(), which
    // mutates the shared fixture object in place via mockDb above.
    employmentRecords['E-001'].status = 'ACTIVE';
    employmentRecords['E-001'].submitted_for_review_at = null;
    // removeBlocklist tests delete from this map; reset between tests.
    blocklistEntries = {
      bl_h1: { id: 'bl_h1', hotel_id: 'h1', employment_record_id: 'emp_1', reason: 'No-show', created_by_id: 'adm_1', created_at: new Date() },
      bl_h2: { id: 'bl_h2', hotel_id: 'h2', employment_record_id: 'emp_1', reason: 'No-show', created_by_id: 'adm_1', created_at: new Date() },
    };
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

  // IF-EMP-RemoveBlocklist (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06):
  // same authorization shape as the POST above -- whoever can add a block
  // can also remove one, hotel-scoped the same way.
  describe('DELETE /employees/hotels/:hotel_id/blocklist/:entry_id — manager hotel-scope enforcement', () => {
    it('allows a manager to remove a block within their in-scope hotel (204)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).delete('/employees/hotels/h1/blocklist/bl_h1');
      expect(res.status).toBe(204);
    });

    it('denies a manager removing a block at an out-of-scope hotel (403)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).delete('/employees/hotels/h2/blocklist/bl_h2');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('allows an admin to remove a block at any hotel (204)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:write'], scope: null };
      const res = await request(makeApp()).delete('/employees/hotels/h2/blocklist/bl_h2');
      expect(res.status).toBe(204);
    });

    it('denies a worker outright (403)', async () => {
      testAuth = { userId: 'w_1', role: 'worker', permissions: ['employees:write'], scope: null };
      const res = await request(makeApp()).delete('/employees/hotels/h1/blocklist/bl_h1');
      expect(res.status).toBe(403);
    });

    it('returns 404 for an entry that does not exist', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:write'], scope: null };
      const res = await request(makeApp()).delete('/employees/hotels/h1/blocklist/bl_missing');
      expect(res.status).toBe(404);
    });

    // IDOR regression, end-to-end (found by adversarial review, 2026-08-06):
    // checkHotelAccess() validates only the PATH's hotel_id (h1 here) --
    // it has no visibility into which hotel the target entry_id actually
    // belongs to. A manager scoped to h1 who supplies bl_h2 (an entry that
    // genuinely belongs to h2, a hotel they cannot access) must be denied,
    // not silently succeed against the wrong hotel's data.
    it('does NOT delete an entry belonging to a DIFFERENT hotel than the path, even for an in-scope manager (404, entry survives)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:write'], scope: { type: 'hotel', hotel_id: 'h1' } };
      const res = await request(makeApp()).delete('/employees/hotels/h1/blocklist/bl_h2');
      expect(res.status).toBe(404);
      expect(blocklistEntries['bl_h2']).toBeDefined();
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
        permissions: ['employees:read', 'org_chart:read'],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(200);
      expect(res.body.data.hotel_group_id).toBe('g1');
      expect(res.body.data.regional_manager.id).toBe('rm_1');
      expect(res.body.data.hotels).toHaveLength(1);
      // Not status-filtered (REQ-EMP-013 names no lifecycle-status
      // carve-out): both the ACTIVE and UNDER_REVIEW fixture records are
      // returned, each carrying its own `status`.
      expect(res.body.data.employees).toHaveLength(2);
      expect(res.body.data.employees.map((e: any) => e.user.first_name).sort()).toEqual(['Ravi', 'Wanda']);
      expect(res.body.data.employees.find((e: any) => e.employee_id === 'E-002').status).toBe('UNDER_REVIEW');
    });

    it("denies a regional_manager viewing another group's org chart (403)", async () => {
      testAuth = {
        userId: 'rm_2',
        role: 'regional_manager',
        permissions: ['employees:read', 'org_chart:read'],
        scope: { type: 'hotel_group', hotel_group_id: 'g_other' },
      };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies a regional_manager with no scope claim (403)', async () => {
      testAuth = { userId: 'rm_3', role: 'regional_manager', permissions: ['employees:read', 'org_chart:read'], scope: null };
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

    // ADR-060 / ADR-030 §3 C-33 / CRR §1:23: the org chart is visible ONLY to
    // Regional Manager and Admin. This route previously gated on
    // `employees:read` — held by every role, MANAGER and WORKER included — so
    // the restriction rested entirely on the in-service role check. It is now
    // gated on `org_chart:read`, which MANAGER does not hold, giving two
    // independent layers. The case below pins the ROUTE layer specifically: a
    // manager carrying a hotel_group scope that WOULD satisfy the service's
    // ownership check is still denied, because the token stops it first.
    it('denies a hotel manager at the route gate even with a matching group scope (org_chart:read, ADR-060)', async () => {
      testAuth = {
        userId: 'mgr_1',
        role: 'manager',
        permissions: ['employees:read'],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies a worker outright (403)', async () => {
      testAuth = { userId: 'user_1', role: 'worker', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(403);
    });

    it('allows an admin to view any group\'s org chart regardless of scope (200)', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:read', 'org_chart:read'], scope: null };
      const res = await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(res.status).toBe(200);
    });

    it('returns 404 for a hotel group that does not exist', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:read', 'org_chart:read'], scope: null };
      const res = await request(makeApp()).get('/employees/hotel-groups/missing/org-chart');
      expect(res.status).toBe(404);
    });

    it('audit-logs the org chart view', async () => {
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:read', 'org_chart:read'], scope: null };
      await request(makeApp()).get('/employees/hotel-groups/g1/org-chart');
      expect(auditCalls.some((c) => c.data.action === 'employee.org_chart.view')).toBe(true);
    });
  });

  // Replaces the pre-rework single /lifecycle-signal endpoint (removed) --
  // see ADR-030 §3 note ³ (2026-08-06 amendment): submit-for-review/approve/
  // reject/deactivate/reactivate/rehire now admit admin OR a scoped
  // manager/regional_manager (assertLifecycleAuthority(), scoped via
  // isWorkerInGroupScope against the record's hotel_group_id), not
  // admin-only. E-001's fixture record has hotel_group_id: 'g1' (see
  // employmentRecords above).
  describe('POST /employees/:employee_id/submit-for-review — scoped manager/RM, not admin-only (C-16)', () => {
    // Still a denial after RULE B, for a different reason: `w_1` is not
    // E-001's `user_id` ('user_1'), so this is now "a worker submitting
    // SOMEONE ELSE'S record", which is precisely what RULE B forbids.
    it('denies a worker acting on a record that is not their own', async () => {
      testAuth = { userId: 'w_1', role: 'worker', permissions: ['employees:write'], scope: null };
      const res = await request(makeApp()).post('/employees/E-001/submit-for-review');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies a manager with no scope claim (deny-by-default, isWorkerInGroupScope)', async () => {
      testAuth = { userId: 'mgr_1', role: 'manager', permissions: ['employees:write'], scope: null };
      const res = await request(makeApp()).post('/employees/E-001/submit-for-review');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies a manager scoped to a different hotel group', async () => {
      testAuth = {
        userId: 'mgr_1',
        role: 'manager',
        permissions: ['employees:write'],
        scope: { type: 'hotel_group', hotel_group_id: 'g2' },
      };
      const res = await request(makeApp()).post('/employees/E-001/submit-for-review');
      expect(res.status).toBe(403);
    });

    // RULE B (project-owner decision, 2026-08-12): "nobody may perform another
    // user's onboarding." submit-for-review became SELF-SERVICE ONLY, so the
    // two cases below — a manager scoped to the record's own group, and an
    // admin — now DENY where they previously returned 200. Inverted rather
    // than deleted: the previous 200 was the bypass the owner closed, and an
    // inverted assertion is what makes a silent regression fail loudly.
    //
    // Scope is now irrelevant to this action: `mgr_1` is denied even with the
    // matching 'g1' claim, because scope answers "may you act on this group's
    // records", which is no longer the question for submit-for-review.
    it('denies a manager scoped to the record\'s own hotel group (RULE B: not the applicant)', async () => {
      employmentRecords['E-001'].status = 'PENDING';
      testAuth = {
        userId: 'mgr_1',
        role: 'manager',
        permissions: ['employees:write'],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).post('/employees/E-001/submit-for-review');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it('denies an admin acting on another user\'s record (RULE B: no role may submit on another\'s behalf)', async () => {
      employmentRecords['E-001'].status = 'PENDING';
      testAuth = { userId: 'adm_1', role: 'admin', permissions: ['employees:write'], scope: null };
      const res = await request(makeApp()).post('/employees/E-001/submit-for-review');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    // The self-service path RULE B leaves as the ONLY way this transition can
    // occur: the actor's JWT `userId` equals the record's `user_id`. Asserted
    // here (not only as a denial suite) so the rule cannot be "satisfied" by
    // accidentally denying everyone.
    it('allows the applicant submitting their OWN record (RULE B self-service)', async () => {
      employmentRecords['E-001'].status = 'PENDING';
      testAuth = { userId: 'user_1', role: 'worker', permissions: ['employees:read'], scope: null };
      const res = await request(makeApp()).post('/employees/E-001/submit-for-review');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /employees/:employee_id/delete and /restore — admin-only, unrestricted scope does not admit a manager (account-boundary actions)', () => {
    it('denies a scoped manager on delete even within their own group', async () => {
      testAuth = {
        userId: 'mgr_1',
        role: 'manager',
        permissions: ['employees:write', 'employees:delete'],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).post('/employees/E-001/delete').send({ deleted_reason: 'Resigned' });
      expect(res.status).toBe(403);
    });

    it('denies a scoped manager on restore even within their own group', async () => {
      testAuth = {
        userId: 'mgr_1',
        role: 'manager',
        permissions: ['employees:write', 'employees:delete'],
        scope: { type: 'hotel_group', hotel_group_id: 'g1' },
      };
      const res = await request(makeApp()).post('/employees/E-001/restore');
      expect(res.status).toBe(403);
    });
  });
});
