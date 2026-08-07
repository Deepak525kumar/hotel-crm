import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

/**
 * Security-regression test for FIND-SEC-001 / OQ-01 (SPEC-JOB-DISPATCH-001),
 * updated for the 2026-08-05 product decision narrowing manager/
 * regional_manager to their own hotel/group scope (previously unrestricted
 * platform-wide -- this file's own history is the record of that original,
 * now-superseded, fix), and again for the 2026-08-08 IDOR fix below.
 *
 * Guards `AssignmentService.update()` (PATCH /assignments/:id): a worker (or
 * any other self-scoped role, e.g. checker) may act ONLY on their own
 * assignment (worker_id match) -- hotel/group eligibility or membership is
 * NEVER sufficient for one self-scoped actor to read or drive another's
 * assignment (IDOR fix, 2026-08-08: hotel eligibility answers "could be
 * assigned here", never "is this actor's assignment"). A manager/
 * regional_manager may act only on an assignment at a hotel within their own
 * scope claim (isHotelInScope -- same primitive placeOnCalendar()/
 * moveCalendarEntry() use); admin remains unrestricted.
 *
 * These tests exercise the real assignments router stack end-to-end via
 * supertest, asserting the guard is enforced. Removing it re-opens the
 * defect and fails this suite.
 */

// Test-controlled auth context injected by the mocked authMiddleware.
let testAuth: { userId: string; role: string; scope?: unknown } | null = null;
// Hotels the actor is eligible at, via the mocked EmploymentRecord/hotel
// group-scope lookup (lib/roster-scope.ts).
let membershipHotelIds: string[] = [];

const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  work_request_id: 'wr1',
  worker_id: 'w1',
  hotel_id: 'h1',
  assigned_by_id: 'mgr1',
  status: 'CONFIRMED' as const,
  confirmed_at: new Date('2026-06-01T00:00:00Z'),
  started_at: null,
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  previous_assignment_id: null,
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

let currentAssignment: ReturnType<typeof makeAssignment>;

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
    // Early-start guard shares the attendance check-in window.
    ATTENDANCE_EARLY_CHECK_IN_GRACE_MINUTES: 120,
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

// getPrisma() backs both the assignment lookup/update and the membership check.
jest.mock('../lib/db.js', () => {
  const prisma: any = {
    workerAssignment: {
      findUnique: async () => currentAssignment,
      update: async ({ data }: any) => ({ ...currentAssignment, ...data }),
      count: async () => 0,
      findFirst: async () => null,
    },
    employmentRecord: {
      findUnique: async ({ where }: any) =>
        membershipHotelIds.length > 0 && where.user_id === testAuth?.userId
          ? { status: 'ACTIVE', hotel_group_id: 'g1' }
          : null,
    },
    hotel: {
      findUnique: async ({ where }: any) =>
        membershipHotelIds.includes(where.id) ? { hotel_group_id: 'g1' } : { hotel_group_id: 'g2' },
    },
    // isWorkerEligibleForHotel() (roster-scope.ts) now also checks the hotel
    // blocklist (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06) -- default to
    // "not blocked" for every fixture worker in this suite.
    employeeBlocklistEntry: { findUnique: async () => null },
    // Early-start guard (2026-08-07): null = no linked JobRequest, so
    // resolveScheduledStart() finds no shift time and the guard correctly
    // does not apply. This suite is about authorization, not scheduling.
    jobRequest: { findUnique: async () => null },
    rating: { aggregate: async () => ({ _avg: { score: 0 }, _count: 0 }) },
    attendance: { count: async () => 0 },
    workerOverallRating: { upsert: async () => ({}) },
    // Assignment lifecycle notifications (2026-08-05): cancel enqueues one,
    // which calls prisma.notification.create()/outboxEvent.create()
    // internally -- unmocked, these throw and 500 every cancel case here.
    notification: { create: async () => ({ id: 'notif-1' }) },
    outboxEvent: { create: async () => ({ id: 'outbox-1' }) },
    auditLog: { create: async () => ({}) },
    $transaction: async (cb: (tx: any) => Promise<unknown>) => cb(prisma),
  };
  return { getPrisma: () => prisma };
});

// Replace real JWT auth with an injector of the test-controlled context.
jest.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = testAuth;
    (req as any).requestId = 'req_test';
    next();
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
  // Minimal error handler mapping AppError → its statusCode (mirrors prod).
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : 500;
    res.status(status).json({ error: err.name, message: err.message });
  });
  return app;
}

describe('PATCH /assignments/:id authorization (FIND-SEC-001 / OQ-01 regression)', () => {
  beforeEach(() => {
    testAuth = null;
    membershipHotelIds = [];
    currentAssignment = makeAssignment();
  });

  it('allows a worker to transition their OWN assignment (200)', async () => {
    testAuth = { userId: 'w1', role: 'worker' };
    currentAssignment = makeAssignment({ worker_id: 'w1', hotel_id: 'h1' });
    // Self-action eligibility (2026-08-07): starting/completing your own
    // shift is now re-checked against isWorkerEligibleForHotel(), so this
    // fixture must describe an eligible worker -- previously the self branch
    // skipped the check entirely and membership was irrelevant here.
    membershipHotelIds = ['h1'];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
  });

  it('denies a worker transitioning ANOTHER worker\'s assignment with no hotel membership (403)', async () => {
    testAuth = { userId: 'w1', role: 'worker' };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h1' });
    membershipHotelIds = [];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });

  // IDOR regression (2026-08-08): hotel eligibility/membership previously
  // substituted for ownership once the assignment belonged to someone else,
  // letting any worker eligible at a hotel read AND drive the lifecycle of a
  // stranger's assignment there. Eligibility is irrelevant to "whose
  // assignment is this" -- ownership is the only thing that may grant access.
  it('denies a worker transitioning another worker\'s assignment even WITH an ACTIVE hotel membership (403)', async () => {
    testAuth = { userId: 'w1', role: 'worker' };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h1' });
    membershipHotelIds = ['h1'];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });

  it('allows a manager whose hotel scope claim matches the assignment\'s hotel (200)', async () => {
    testAuth = { userId: 'mgr_other', role: 'manager', scope: { type: 'hotel', hotel_id: 'h9' } };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9' });
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
  });

  it('denies a manager whose hotel scope claim does NOT match the assignment\'s hotel (403)', async () => {
    testAuth = { userId: 'mgr_other', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9' });
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ForbiddenError');
  });

  it('denies a manager with no scope claim at all (deny-by-default, 403)', async () => {
    testAuth = { userId: 'mgr_other', role: 'manager', scope: null };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9' });
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(403);
  });

  it('allows an admin regardless of ownership/scope (200)', async () => {
    testAuth = { userId: 'admin_other', role: 'admin', scope: { type: 'global' } };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9' });
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
  });

  // ADR-030 §3 C-24 grants regional_manager `✓ᶜ` on assignments, at hotel_group
  // scope (isHotelInScope's hotel_group branch resolves the target hotel's own
  // group via one findUnique, mocked below to return 'g1' for hotel 'h9').
  it('allows a regional_manager whose hotel_group scope claim matches the assignment\'s hotel group (200)', async () => {
    testAuth = { userId: 'rm_other', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9' });
    // Drives the mocked hotel.findUnique (line 82-85 above) to resolve h9 -> g1.
    membershipHotelIds = ['h9'];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
  });

  it('denies a regional_manager whose hotel_group scope claim does NOT match (403)', async () => {
    testAuth = { userId: 'rm_other', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
    currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9' });
    // h9 is NOT in membershipHotelIds -> mocked hotel.findUnique resolves it to
    // g2, mismatching the RM's g1 claim.
    membershipHotelIds = [];
    const res = await request(makeApp())
      .patch('/assignments/a1')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(403);
  });

  // The scope check above (line 158-170 of service.ts) runs unconditionally,
  // before input.status is ever read -- so in principle it applies
  // identically to every transition. The IN_PROGRESS (start) cases above
  // prove the check fires at all; this block proves it for COMPLETE and
  // CANCEL too, rather than relying on that "runs before status is read"
  // claim without a test to back it for the other two transitions a
  // manager/RM can actually drive day to day.
  describe('the same scope guard applies to complete and cancel, not just start', () => {
    it.each([
      { label: 'complete', body: { status: 'COMPLETED' }, fromStatus: 'IN_PROGRESS' as const },
      { label: 'cancel', body: { status: 'CANCELLED', cancellation_reason: 'no longer needed' }, fromStatus: 'CONFIRMED' as const },
    ])('manager in scope: $label (200)', async ({ body, fromStatus }) => {
      testAuth = { userId: 'mgr_other', role: 'manager', scope: { type: 'hotel', hotel_id: 'h9' } };
      currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9', status: fromStatus });
      const res = await request(makeApp()).patch('/assignments/a1').send(body);
      expect(res.status).toBe(200);
    });

    it.each([
      { label: 'complete', body: { status: 'COMPLETED' }, fromStatus: 'IN_PROGRESS' as const },
      { label: 'cancel', body: { status: 'CANCELLED', cancellation_reason: 'no longer needed' }, fromStatus: 'CONFIRMED' as const },
    ])('manager out of scope: $label (403, never reaches the transition logic)', async ({ body, fromStatus }) => {
      testAuth = { userId: 'mgr_other', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } };
      currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9', status: fromStatus });
      const res = await request(makeApp()).patch('/assignments/a1').send(body);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });

    it.each([
      { label: 'complete', body: { status: 'COMPLETED' }, fromStatus: 'IN_PROGRESS' as const },
      { label: 'cancel', body: { status: 'CANCELLED', cancellation_reason: 'no longer needed' }, fromStatus: 'CONFIRMED' as const },
    ])('regional_manager in scope: $label (200)', async ({ body, fromStatus }) => {
      testAuth = { userId: 'rm_other', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9', status: fromStatus });
      membershipHotelIds = ['h9'];
      const res = await request(makeApp()).patch('/assignments/a1').send(body);
      expect(res.status).toBe(200);
    });

    it.each([
      { label: 'complete', body: { status: 'COMPLETED' }, fromStatus: 'IN_PROGRESS' as const },
      { label: 'cancel', body: { status: 'CANCELLED', cancellation_reason: 'no longer needed' }, fromStatus: 'CONFIRMED' as const },
    ])('regional_manager out of scope: $label (403, never reaches the transition logic)', async ({ body, fromStatus }) => {
      testAuth = { userId: 'rm_other', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } };
      currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h9', status: fromStatus });
      membershipHotelIds = [];
      const res = await request(makeApp()).patch('/assignments/a1').send(body);
      expect(res.status).toBe(403);
    });

    it.each([
      { label: 'complete', body: { status: 'COMPLETED' }, fromStatus: 'IN_PROGRESS' as const },
      { label: 'cancel', body: { status: 'CANCELLED', cancellation_reason: 'no longer needed' }, fromStatus: 'CONFIRMED' as const },
    ])('worker: $label their own assignment (200)', async ({ body, fromStatus }) => {
      testAuth = { userId: 'w1', role: 'worker' };
      // h1 + membership: an ELIGIBLE worker, so this stays a test of the
      // status-transition guard rather than accidentally becoming an
      // eligibility test (2026-08-07).
      currentAssignment = makeAssignment({ worker_id: 'w1', hotel_id: 'h1', status: fromStatus });
      membershipHotelIds = ['h1'];
      const res = await request(makeApp()).patch('/assignments/a1').send(body);
      expect(res.status).toBe(200);
    });

    it.each([
      { label: 'complete', body: { status: 'COMPLETED' }, fromStatus: 'IN_PROGRESS' as const },
      { label: 'cancel', body: { status: 'CANCELLED', cancellation_reason: 'no longer needed' }, fromStatus: 'CONFIRMED' as const },
    ])('worker: $label ANOTHER worker\'s assignment with no hotel membership (403)', async ({ body, fromStatus }) => {
      testAuth = { userId: 'w1', role: 'worker' };
      currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h1', status: fromStatus });
      membershipHotelIds = [];
      const res = await request(makeApp()).patch('/assignments/a1').send(body);
      expect(res.status).toBe(403);
    });

    // IDOR regression (2026-08-08): same as above, but WITH hotel
    // membership -- proves ownership is the gate, not eligibility.
    it.each([
      { label: 'complete', body: { status: 'COMPLETED' }, fromStatus: 'IN_PROGRESS' as const },
      { label: 'cancel', body: { status: 'CANCELLED', cancellation_reason: 'no longer needed' }, fromStatus: 'CONFIRMED' as const },
    ])('worker: $label ANOTHER worker\'s assignment even WITH an ACTIVE hotel membership (403)', async ({ body, fromStatus }) => {
      testAuth = { userId: 'w1', role: 'worker' };
      currentAssignment = makeAssignment({ worker_id: 'w2', hotel_id: 'h1', status: fromStatus });
      membershipHotelIds = ['h1'];
      const res = await request(makeApp()).patch('/assignments/a1').send(body);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ForbiddenError');
    });
  });
});
