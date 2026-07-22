import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requireRole, requirePermission, checkHotelAccess, resolveHotelAccess } from '../middleware/permissions.js';

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, error: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
}));

const mockHotelWorkerFindFirst = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockHotelFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockEmploymentRecordFindUnique = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    hotelWorker: { findFirst: mockHotelWorkerFindFirst },
    hotel: { findUnique: mockHotelFindUnique },
    employmentRecord: { findUnique: mockEmploymentRecordFindUnique },
  }),
}));

// Epic 5 PR 5.5 (ADR-024 D3): the manager scope-authz cutover is gated by
// isScopeAuthzEnabled(). A mutable flag lets individual cases assert both the
// flip-ON behavior (default) and the OFF compatibility guarantee.
let scopeAuthzEnabled = true;
// Epic 5 PR 5.7 (ADR-024 D1/D2/D4): the roster cutover for the worker branch
// of resolveHotelAccess() is gated by isRosterCutoverEnabled(). Defaults OFF
// so the pre-PR-5.7 HotelWorker characterization suite above stays untouched;
// individual cases flip it ON to assert the EmploymentRecord cutover path.
let rosterCutoverEnabled = false;
jest.mock('../config/feature-flags.js', () => ({
  isScopeAuthzEnabled: () => scopeAuthzEnabled,
  isRosterCutoverEnabled: () => rosterCutoverEnabled,
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
});

describe('checkHotelAccess middleware', () => {
  beforeEach(() => {
    scopeAuthzEnabled = true;
    rosterCutoverEnabled = false;
    mockHotelWorkerFindFirst.mockReset();
    mockHotelFindUnique.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
  });

  it('allows admins to access any hotel (PATCH-04 §4c bypass)', async () => {
    const req = makeReq({ userId: 'u1', role: 'admin', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows a manager with a matching hotel scope (Epic 5 PR 5.5, flag ON)', async () => {
    scopeAuthzEnabled = true;
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
    expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
  });

  it('denies a manager whose hotel scope does not match (out_of_scope 403, flag ON)', async () => {
    scopeAuthzEnabled = true;
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

  it('allows a manager unconditionally when the flag is OFF (ADR-024 D3 compatibility)', async () => {
    scopeAuthzEnabled = false;
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['auth'] = { userId: 'u1', role: 'manager', permissions: [], scope: null };
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
    scopeAuthzEnabled = true;
  });

  it('allows checkers unconditionally (PATCH-04 §4c bypass — no DB query)', async () => {
    const req = makeReq({ userId: 'c1', role: 'checker', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
  });

  it('allows workers with an ACTIVE HotelWorker membership row', async () => {
    mockHotelWorkerFindFirst.mockResolvedValue({ id: 'hw1' });
    const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(mockHotelWorkerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ worker_id: 'w1', hotel_id: 'h1' }) })
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('denies workers with no ACTIVE membership row', async () => {
    mockHotelWorkerFindFirst.mockResolvedValue(null);
    const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('denies when no hotel_id is provided', async () => {
    const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  // Epic 5 PR 5.7 (ADR-022/023/024 D1/D2): with the roster cutover flag ON,
  // the worker branch reads the PR 5.6 EmploymentRecord group-grain scope
  // via `lib/roster-scope.ts` instead of HotelWorker, and never touches the
  // HotelWorker table.
  describe('roster cutover (flag ON, site #1)', () => {
    beforeEach(() => {
      rosterCutoverEnabled = true;
    });

    it('allows a worker whose EmploymentRecord group matches the target hotel group', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const req = makeReq({ userId: 'w1', role: 'worker', hotel_ids: [], permissions: [] });
      (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
      const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
      await checkHotelAccess()(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith();
      expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
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
      expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
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
    scopeAuthzEnabled = true;
    rosterCutoverEnabled = false;
    mockHotelWorkerFindFirst.mockReset();
    mockHotelFindUnique.mockReset();
    mockEmploymentRecordFindUnique.mockReset();
  });

  // admin and checker keep the unconditional cross-hotel bypass (unchanged).
  it.each(['admin', 'checker'])('allows %s via bypass, with no DB query', async (role) => {
    const decision = await resolveHotelAccess(role, 'u1', 'h1');
    expect(decision).toEqual({ allowed: true, viaBypass: true });
    expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
  });

  // Epic 5 PR 5.5: the manager role is now scope-bound when the flag is ON.
  it('allows a manager whose hotel scope matches the target (viaBypass:false)', async () => {
    const decision = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel', hotel_id: 'h1' });
    expect(decision).toEqual({ allowed: true, viaBypass: false });
    expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
  });

  it('denies a manager whose hotel scope does not match (out_of_scope)', async () => {
    const decision = await resolveHotelAccess('manager', 'u1', 'h1', { type: 'hotel', hotel_id: 'h_other' });
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('reverts a manager to bypass when the flag is OFF (ADR-024 D3 compatibility)', async () => {
    scopeAuthzEnabled = false;
    const decision = await resolveHotelAccess('manager', 'u1', 'h1', null);
    expect(decision).toEqual({ allowed: true, viaBypass: true });
    expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
    scopeAuthzEnabled = true;
  });

  it('allows a worker with an ACTIVE HotelWorker membership row', async () => {
    mockHotelWorkerFindFirst.mockResolvedValue({ id: 'hw1' });
    const decision = await resolveHotelAccess('worker', 'w1', 'h1');
    expect(decision).toEqual({ allowed: true, viaBypass: false });
  });

  it('denies a worker with no ACTIVE membership row', async () => {
    mockHotelWorkerFindFirst.mockResolvedValue(null);
    const decision = await resolveHotelAccess('worker', 'w1', 'h1');
    expect(decision).toEqual({ allowed: false, reason: 'no_membership' });
  });

  it('denies a worker when no hotel_id is provided', async () => {
    const decision = await resolveHotelAccess('worker', 'w1', undefined);
    expect(decision).toEqual({ allowed: false, reason: 'missing_hotel_id' });
  });

  describe('roster cutover (flag ON, site #1)', () => {
    beforeEach(() => {
      rosterCutoverEnabled = true;
    });

    it('allows a worker whose EmploymentRecord group matches the target hotel group', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue({ status: 'ACTIVE', hotel_group_id: 'g1' });
      mockHotelFindUnique.mockResolvedValue({ hotel_group_id: 'g1' });
      const decision = await resolveHotelAccess('worker', 'w1', 'h1');
      expect(decision).toEqual({ allowed: true, viaBypass: false });
      expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
    });

    it('denies a worker with no EmploymentRecord (deny-by-default)', async () => {
      mockEmploymentRecordFindUnique.mockResolvedValue(null);
      const decision = await resolveHotelAccess('worker', 'w1', 'h1');
      expect(decision).toEqual({ allowed: false, reason: 'no_membership' });
      expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
    });
  });
});
