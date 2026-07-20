import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requireRole, requirePermission, checkHotelAccess, resolveHotelAccess } from '../middleware/permissions.js';

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>, error: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
}));

const mockHotelWorkerFindFirst = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    hotelWorker: { findFirst: mockHotelWorkerFindFirst },
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
});

describe('checkHotelAccess middleware', () => {
  it('allows admins to access any hotel (PATCH-04 §4c bypass)', async () => {
    const req = makeReq({ userId: 'u1', role: 'admin', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows managers unconditionally (PATCH-04 §4c bypass — no DB query)', async () => {
    const req = makeReq({ userId: 'u1', role: 'manager', hotel_ids: [], permissions: [] });
    (req as unknown as Record<string, unknown>)['params'] = { hotel_id: 'h1' };
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    await checkHotelAccess()(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
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
});

// Characterization suite for the Epic 3 centralization seam (Execution Plan
// §2 "Shared authorization centralization seam"): resolveHotelAccess() is now
// the single role->scope resolution point every consumer of
// checkHotelAccess() goes through. These cases lock the exact allow/deny
// outcome per role — pinning current behavior so Epic 5's authz flip has a
// documented baseline to diverge from deliberately, not accidentally.
describe('resolveHotelAccess (Epic 3 centralization seam)', () => {
  beforeEach(() => {
    mockHotelWorkerFindFirst.mockReset();
  });

  it.each(['admin', 'manager', 'checker'])('allows %s via bypass, with no DB query', async (role) => {
    const decision = await resolveHotelAccess(role, 'u1', 'h1');
    expect(decision).toEqual({ allowed: true, viaBypass: true });
    expect(mockHotelWorkerFindFirst).not.toHaveBeenCalled();
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
});
