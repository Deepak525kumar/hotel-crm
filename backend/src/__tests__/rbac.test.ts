import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import {
  requireRole,
  requirePermission,
  checkHotelAccess,
  resolveHotelAccess,
  checkWorkerScope,
  resolveWorkerScope,
} from '../middleware/permissions.js';

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, error: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
}));

// permissions.ts imports isGD02MatrixEnabled (ADR-030 PR-5) — mocked so this
// suite never transitively loads the real env.ts under jest.
jest.mock('../config/feature-flags.js', () => ({
  isGD02MatrixEnabled: () => false,
}));

const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
// isWorkerEligibleForHotel() (roster-scope.ts) now checks the hotel
// blocklist (REQ-EMP-005 / RULE-EMP-07 rework, 2026-08-06) -- default to
// "not blocked" so existing eligibility-path tests don't need to know
// about it unless they're specifically testing it.
const mockBlocklistEntryFindUnique = (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(
  null,
);

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    hotel: { findUnique: mockHotelFindUnique },
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
    employeeBlocklistEntry: { findUnique: mockBlocklistEntryFindUnique },
  }),
}));

function makeReq(auth?: Partial<{ userId: string; role: string; hotel_ids: string[]; permissions: string[]; email: string }>): Request {
  return {
    auth,
    params: {},
    query: {},
    body: {},
    requestId: 'req_test',
  } as unknown as Request;
}

function makeRes(): Response {
  return {} as Response;
}

describe('requireRole middleware', () => {
  it('calls next() when role matches', () => {
    const req = makeReq({ userId: 'u1', role: 'admin', hotel_ids: [], permissions: [] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requireRole('admin')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) when role does not match', () => {
    const req = makeReq({ userId: 'u1', role: 'worker', hotel_ids: [], permissions: [] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requireRole('admin')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('calls next(UnauthorizedError) when no auth', () => {
    const req = makeReq(undefined);
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requireRole('admin')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'UnauthorizedError' }));
  });

  it('accepts array of allowed roles', () => {
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: [] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requireRole(['admin', 'manager'])(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requirePermission middleware', () => {
  it('allows when user has exact permission', () => {
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: ['hotels:read'] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requirePermission('hotels:read')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows when user has wildcard permission', () => {
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: ['hotels:*'] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requirePermission('hotels:read')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows when user has admin:*', () => {
    const req = makeReq({ userId: 'u1', role: 'admin', hotel_ids: [], permissions: ['admin:*'] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requirePermission('hotels:write')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('denies when permission missing', () => {
    const req = makeReq({ userId: 'u1', role: 'worker', hotel_ids: [], permissions: ['hotels:read'] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requirePermission('hotels:write')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  // ADR-030 C-14: 'super_admin' was a phantom role bypass — no enum value, no
  // issuance path anywhere in the repository produces it. Removed as dead
  // code; this pins that it no longer grants anything.
  it('denies a super_admin role string (phantom role, no longer bypasses)', () => {
    const req = makeReq({ userId: 'u1', role: 'super_admin', hotel_ids: [], permissions: [] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requirePermission('hotels:write')(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });
});

// ADR-030 PR-1 (C-10): worker-id-keyed counterpart to
// resolveHotelAccess()/checkHotelAccess(), for routes whose payload carries a
// worker_id rather than a hotel_id (HR contracts/payroll/documents).
describe('resolveWorkerScope / checkWorkerScope (ADR-030 C-10)', () => {
  beforeEach(() => {
    mockHotelFindUnique.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
    mockBlocklistEntryFindUnique.mockReset().mockResolvedValue(null);
  });

  it('allows admin unconditionally, with no DB query', async () => {
    const decision = await resolveWorkerScope('admin', 'w1', null);
    expect(decision).toEqual({ allowed: true });
    expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
  });

  it('denies when no worker_id is provided', async () => {
    const decision = await resolveWorkerScope('manager', undefined, { type: 'hotel_group', hotel_group_id: 'g1' });
    expect(decision).toEqual({ allowed: false, reason: 'missing_worker_id' });
  });

  it('allows a manager whose hotel_group scope matches the worker record directly', async () => {
    mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    const decision = await resolveWorkerScope('manager', 'w1', { type: 'hotel_group', hotel_group_id: 'g1' });
    expect(decision).toEqual({ allowed: true });
    expect(mockHotelFindUnique).not.toHaveBeenCalled();
  });

  it('allows a manager whose hotel scope resolves to the worker record\'s group', async () => {
    mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    const decision = await resolveWorkerScope('manager', 'w1', { type: 'hotel', hotel_id: 'h1' });
    expect(decision).toEqual({ allowed: true });
  });

  it('denies a manager whose scope does not match the worker record\'s group', async () => {
    mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    const decision = await resolveWorkerScope('manager', 'w1', { type: 'hotel_group', hotel_group_id: 'g2' });
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('denies a manager with a null scope (deny-by-default)', async () => {
    const decision = await resolveWorkerScope('manager', 'w1', null);
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('denies a manager when the worker has no EmploymentRecord', async () => {
    mockEmploymentRecordFindUnique.mockResolvedValue(null);
    const decision = await resolveWorkerScope('manager', 'w1', { type: 'global' });
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
  });


  it('denies any other role', async () => {
    const decision = await resolveWorkerScope('checker', 'w1', null);
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('checkWorkerScope() middleware denies with ForbiddenError when out of scope', async () => {
    mockEmploymentRecordFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['auth'] = {
      userId: 'u1',
      role: 'manager',
      permissions: [],
      scope: { type: 'hotel_group', hotel_group_id: 'g2' },
    };
    (req as unknown as Record<string, unknown>)['params'] = { worker_id: 'w1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkWorkerScope()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('checkWorkerScope() middleware allows admin through unconditionally', async () => {
    const req = makeReq({ userId: 'a1', role: 'admin', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = {};
    (req as unknown as Record<string, unknown>)['body'] = { worker_id: 'w1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkWorkerScope()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('checkHotelAccess middleware', () => {
  beforeEach(() => {
    mockHotelFindUnique.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
    mockBlocklistEntryFindUnique.mockReset().mockResolvedValue(null);
  });

  it('allows admins to access any hotel (PATCH-04 §4c bypass)', async () => {
    const req = makeReq({ userId: 'u1', role: 'admin', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows a manager with a matching hotel scope', async () => {
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['auth'] = {
      userId: 'u1',
      role: 'manager',
      permissions: [],
      scope: { type: 'hotel', hotel_id: 'h1' },
    };
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
  });

  it('denies a manager whose hotel scope does not match (out_of_scope 403)', async () => {
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['auth'] = {
      userId: 'u1',
      role: 'manager',
      permissions: [],
      scope: { type: 'hotel', hotel_id: 'h_other' },
    };
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('denies a manager with no scope claim (deny-by-default, M-4 retired the bypass)', async () => {
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['auth'] = { userId: 'u1', role: 'manager', permissions: [], scope: null };
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('allows checkers unconditionally (PATCH-04 §4c bypass — no DB query)', async () => {
    const req = makeReq({ userId: 'c1', role: 'checker', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
  });

  it('denies when no hotel_id is provided', async () => {
    const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  // Worker roster access (Epic 5 PR 5.7/5.8, ADR-022/023/024): the worker
  // branch reads the PR 5.6 EmploymentRecord group-grain scope via
  // `lib/roster-scope.ts`.
  describe('worker roster access', () => {
    it('allows a worker whose EmploymentRecord group matches the target hotel group', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
      (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
      const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
      await checkHotelAccess()(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('denies a worker whose EmploymentRecord group does not match the target hotel group', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
      const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
      (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
      const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
      await checkHotelAccess()(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
    });

    it('denies a worker with no EmploymentRecord (deny-by-default)', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue(null);
      const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
      (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
      const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
      await checkHotelAccess()(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
    });

    it('denies a worker with a non-ACTIVE EmploymentRecord', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'UNDER_REVIEW', hotel_group_id: 'g1' });
      const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
      (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
      const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
      await checkHotelAccess()(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
    });
  });
});

// Characterization suite for the Epic 3 centralization seam (Execution Plan
// §2 "Shared authorization centralization seam"): resolveHotelAccess() is now
// the single role->scope resolution point every consumer of
// checkHotelAccess() goes through. These cases lock the exact allow/deny
// outcome per role — pinning current behavior so Epic 5's authz flip has a
// documented baseline to diverge from deliberately, not accidentally.
describe('resolveHotelAccess (Epic 3 centralization seam)', () => {
  beforeEach(() => {
    mockHotelFindUnique.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
    mockBlocklistEntryFindUnique.mockReset().mockResolvedValue(null);
  });

  // admin and checker keep the unconditional cross-hotel bypass (unchanged).
  it.each(['admin', 'checker'])('allows %s via bypass, with no DB query', async (role) => {
    const decision = await resolveHotelAccess(role, 'u1', 'h1');
    expect(decision).toEqual({ allowed: true, viaBypass: true });
    expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
  });

  // Epic 5 PR 5.5 (ADR-024, scope-authz retired unconditional M-4): the
  // manager role is always scope-bound.
  it('allows a manager whose hotel scope matches the target (viaBypass:false)', async () => {
    const decision = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel', hotel_id: 'h1' });
    expect(decision).toEqual({ allowed: true, viaBypass: false });
    expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
  });

  it('denies a manager whose hotel scope does not match (out_of_scope)', async () => {
    const decision = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel', hotel_id: 'h_other' });
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('denies a manager with a null scope claim (deny-by-default, M-4 retired the bypass)', async () => {
    const decision = await resolveHotelAccess('manager', 'u1', 'h1', null);
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
    expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
  });

  // ADR-030 D-5 / PR-7 review follow-up: regional_manager previously had no
  // branch here at all and fell through to the worker-roster check below —
  // wrong authorization model entirely (individual roster membership instead
  // of group scope). isHotelInScope() is role-agnostic, so RM now shares
  // manager's branch, exactly like the constants.ts MANAGER_PERMISSIONS
  // sharing pattern (D-5: RM holds manager's operational capability set).
  it('allows a regional_manager whose hotel_group scope matches the target (viaBypass:false)', async () => {
    mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    const decision = await resolveHotelAccess('regional_manager', 'u1', 'h1', { type: 'hotel_group', hotel_group_id: 'g1' });
    expect(decision).toEqual({ allowed: true, viaBypass: false });
    expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
  });

  it('denies a regional_manager whose hotel_group scope does not match the target (out_of_scope)', async () => {
    mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g2' });
    const decision = await resolveHotelAccess('regional_manager', 'u1', 'h1', { type: 'hotel_group', hotel_group_id: 'g1' });
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('denies a regional_manager with a null scope claim (deny-by-default)', async () => {
    const decision = await resolveHotelAccess('regional_manager', 'u1', 'h1', null);
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
    expect(mockEmploymentRecordFindUnique).not.toHaveBeenCalled();
  });

  it('allows a worker whose EmploymentRecord group matches the target hotel group', async () => {
    mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
    mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    const decision = await resolveHotelAccess('worker', 'w1', 'h1');
    expect(decision).toEqual({ allowed: true, viaBypass: false });
  });

  it('denies a worker with no EmploymentRecord (deny-by-default)', async () => {
    mockEmploymentRecordFindUnique.mockResolvedValue(null);
    const decision = await resolveHotelAccess('worker', 'w1', 'h1');
    expect(decision).toEqual({ allowed: false, reason: 'no_membership' });
  });

  it('denies a worker when no hotel_id is provided', async () => {
    const decision = await resolveHotelAccess('worker', 'w1', undefined);
    expect(decision).toEqual({ allowed: false, reason: 'missing_hotel_id' });
  });
});
