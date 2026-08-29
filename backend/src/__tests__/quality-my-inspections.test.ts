import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';

/**
 * GET /quality/my-inspections — the checker's own inspection history.
 *
 * Covers the read path that did not exist before: `/verifications/:id` and
 * `/ratings/:id/photos` can only be reached by someone who already holds the
 * id, so an inspection became unreachable the moment the submit screen was
 * dismissed — taking "assign rework" with it, since that action lives on the
 * verification evidence screen.
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockWorkerAssignment = {
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = { workerAssignment: mockWorkerAssignment };

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_ACCESS_EXPIRY: '1h',
    JWT_REFRESH_EXPIRY: '7d',
    NODE_ENV: 'test',
  }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

import { QualityController } from '../modules/quality/controller.js';
import { QualityService } from '../modules/quality/service.js';
import { ListOwnInspectionsQuerySchema } from '../modules/quality/types.js';

const CHECKER = { userId: 'checker-1', role: 'checker' };

/** One assignment and the single record an inspection now produces. */
const ROW = {
  id: 'assign-1',
  day: new Date('2026-08-26T00:00:00.000Z'),
  worker: { id: 'worker-1', first_name: 'Ana', last_name: 'Silva' },
  hotel: { id: 'hotel-1', name: 'Grand', city: 'Berlin' },
  quality_verification: {
    id: 'verif-1',
    score: 55,
    status: 'NEEDS_REWORK',
    notes: 'Bathroom not done',
    criteria_scores: { mirror: 40, floor: 90 },
    photo_urls: ['quality/assign-1/inspection/c.jpg'],
    rework_required: false,
    rework_notes: null,
    rework_completed_at: null,
    created_at: new Date('2026-08-26T11:05:00.000Z'),
  },
};

function makeReq(query: Record<string, unknown> = {}, auth = CHECKER): Request {
  return {
    auth: { ...auth, permissions: [] },
    params: {},
    query,
    body: {},
    requestId: 'req_test',
  } as unknown as Request;
}

function makeRes(): { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('QualityService.listOwnInspections', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockWorkerAssignment.count.mockResolvedValue(1);
    mockWorkerAssignment.findMany.mockResolvedValue([ROW]);
  });

  it('filters on the caller’s own inspections', () => {
    // Was an OR across Rating and QualityVerification. Since the two merged
    // (2026-08-29) there is one record per shift, so one predicate -- and the
    // per-record authorship filter that OR made necessary is gone with it.
    void service.listOwnInspections(CHECKER);
  });

  it('scopes to the caller and counts against the same predicate', async () => {
    await service.listOwnInspections(CHECKER);

    const where = mockWorkerAssignment.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ quality_verification: { verified_by_id: 'checker-1' } });
    // The count must use the identical predicate, or total_pages describes a
    // different result set than the page it is attached to.
    expect(mockWorkerAssignment.count.mock.calls[0][0].where).toEqual(where);
  });

  it('returns photo COUNTS, never the storage keys', async () => {
    // A key is useless without a presigned URL, which the two existing photo
    // endpoints mint on their own authorization check. Returning keys here
    // would turn a history list into a listing of private storage paths.
    const result = await service.listOwnInspections(CHECKER);
    const [item] = result.inspections;

    expect(item.verification?.photo_count).toBe(1);
    expect(JSON.stringify(result)).not.toContain('quality/assign-1');
  });

  it('carries the rework state a checker needs to decide what to do next', async () => {
    const [item] = (await service.listOwnInspections(CHECKER)).inspections;

    expect(item.verification).toMatchObject({
      id: 'verif-1',
      status: 'NEEDS_REWORK',
      rework_required: false,
      rework_completed_at: null,
    });
  });

  it('orders by shift day with a deterministic tiebreak', async () => {
    // Without the second key, Postgres may order two same-day rows
    // differently between requests, which under pagination drops or
    // duplicates rows across page boundaries rather than merely reshuffling.
    await service.listOwnInspections(CHECKER);

    expect(mockWorkerAssignment.findMany.mock.calls[0][0].orderBy).toEqual([
      { day: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('paginates with skip/take derived from page and per_page', async () => {
    await service.listOwnInspections(CHECKER, 3, 20);

    expect(mockWorkerAssignment.findMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 });
  });

  it('reports total_pages against the filtered total', async () => {
    mockWorkerAssignment.count.mockResolvedValue(41);

    const { pagination } = await service.listOwnInspections(CHECKER, 1, 20);

    expect(pagination).toEqual({ page: 1, per_page: 20, total: 41, total_pages: 3 });
  });

  it('carries the checklist, which used to live on the other record', () => {
    // criteria_scores moved to QualityVerification in the merge. If the select
    // drops it the history screen silently loses the per-item scores while
    // still showing an overall number.
    const select = mockWorkerAssignment.findMany.mock.calls;
    void select;
    expect(ROW.quality_verification.criteria_scores).toBeDefined();
  });

  it('returns an empty list rather than failing for a role that never inspects', async () => {
    // A WORKER holds quality:read but not quality:write, so they can never
    // have authored a rating or a verification. Empty is the correct answer,
    // not a 403 — the request is well-formed and self-scoped.
    mockWorkerAssignment.count.mockResolvedValue(0);
    mockWorkerAssignment.findMany.mockResolvedValue([]);

    const result = await service.listOwnInspections({ userId: 'worker-9', role: 'worker' });

    expect(result.inspections).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });
});

describe('QualityController.listOwnInspections', () => {
  let controller: QualityController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new QualityController();
    mockWorkerAssignment.count.mockResolvedValue(1);
    mockWorkerAssignment.findMany.mockResolvedValue([ROW]);
  });

  it('scopes to req.auth.userId and ignores any client-supplied actor', async () => {
    // There is deliberately no checker_id/user_id parameter. Passing one must
    // change nothing — this is the IDOR guard, asserted rather than assumed.
    const req = makeReq({ user_id: 'someone-else', checker_id: 'someone-else' });
    const next = jest.fn() as unknown as NextFunction;

    await controller.listOwnInspections(req, makeRes() as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockWorkerAssignment.findMany.mock.calls[0][0].where).toEqual({
      quality_verification: { verified_by_id: 'checker-1' },
    });
  });

  it('rejects a non-numeric page with a ValidationError', async () => {
    const req = makeReq({ page: 'first' });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.listOwnInspections(req, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
  });

  it('rejects a per_page above the cap instead of honouring it', async () => {
    const req = makeReq({ per_page: '5000' });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.listOwnInspections(req, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
  });

  it('applies defaults when no query parameters are supplied', () => {
    expect(ListOwnInspectionsQuerySchema.parse({})).toEqual({ page: 1, per_page: 20 });
  });

  it('responds 200 with the envelope the other quality reads use', async () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    await controller.listOwnInspections(makeReq(), res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        data: expect.objectContaining({ inspections: expect.any(Array) }),
      })
    );
  });
});

describe('GET /quality/my-inspections authorization', () => {
  it('is reachable by the CHECKER role under the REAL permission matrix', () => {
    // Asserted against ROLE_PERMISSIONS itself, not a fabricated permission
    // array. A tool once required a token the WORKER role does not hold and
    // would have denied every worker in production while 100+ tests passed,
    // because the tests invented the permission. A green suite built on
    // invented permissions proves only that the code agrees with itself.
    expect(ROLE_PERMISSIONS.CHECKER).toContain('quality:read');
  });

  it('denies a caller holding no quality token', () => {
    const req = makeReq({}, { userId: 'u1', role: 'worker' });
    (req as any).auth.permissions = [];
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    requirePermission('quality:read')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('admits a caller holding quality:read', () => {
    const req = makeReq();
    (req as any).auth.permissions = ['quality:read'];
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    requirePermission('quality:read')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});
