import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';

/**
 * GET /quality/my-inspections — the checker's own checks, with search.
 *
 * Lists CHECKS, not shifts (2026-08-29). A shift carries one check per room
 * now, so keying this by assignment would collapse a hundred room inspections
 * into a single row and hide the thing the checker came to find.
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockQualityVerification = {
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = { qualityVerification: mockQualityVerification };

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
import { QualityService, escapeLikeTerm } from '../modules/quality/service.js';
import { ListOwnInspectionsQuerySchema } from '../modules/quality/types.js';

const CHECKER = { userId: 'checker-1', role: 'checker' };

const ROW = {
  id: 'check-1',
  assignment_id: 'assign-1',
  room_number: '412',
  score: 55,
  status: 'NEEDS_REWORK',
  notes: 'Balcony door left open',
  criteria_scores: { mirror: 40 },
  photo_urls: ['quality/assign-1/inspection/c.jpg'],
  rework_required: true,
  rework_notes: 'redo the balcony',
  rework_completed_at: null,
  created_at: new Date('2026-08-26T11:05:00.000Z'),
  worker: { id: 'worker-1', first_name: 'Ana', last_name: 'Silva' },
  hotel: { id: 'hotel-1', name: 'Grand', city: 'Berlin' },
  verified_by: { id: 'checker-1', first_name: 'Cal', last_name: 'Checker' },
  assignment: { id: 'assign-1', day: new Date('2026-08-26T00:00:00.000Z'), status: 'COMPLETED' },
  rework_assignments: [
    { id: 'rework-1', status: 'CONFIRMED', day: new Date('2026-08-26T00:00:00.000Z') },
  ],
  // A room can be sent back more than once (2026-08-30). The open round is
  // what the worker's button must point at -- round 1 here, still incomplete.
  rework_rounds: [
    {
      id: 'round-1',
      round_number: 1,
      notes: 'redo the balcony',
      assigned_at: new Date('2026-08-26T11:06:00.000Z'),
      completed_at: null,
      photo_urls: [],
      assignment_id: 'rework-1',
      assigned_by: { id: 'checker-1', first_name: 'Cal', last_name: 'Checker' },
    },
  ],
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

describe('QualityService.listOwnChecks', () => {
  let service: QualityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QualityService();
    mockQualityVerification.count.mockResolvedValue(1);
    mockQualityVerification.findMany.mockResolvedValue([ROW]);
  });

  it('scopes to the caller’s own checks, and counts the same set', async () => {
    await service.listOwnChecks(CHECKER);

    const where = mockQualityVerification.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ verified_by_id: 'checker-1' });
    // The count must use the identical predicate, or total_pages describes a
    // different result set than the page attached to it.
    expect(mockQualityVerification.count.mock.calls[0][0].where).toEqual(where);
  });

  it('returns one row PER ROOM, not per shift', async () => {
    // The reason this endpoint changed shape: three rooms on one shift are
    // three findings a checker needs to see separately.
    mockQualityVerification.findMany.mockResolvedValue([
      { ...ROW, id: 'c1', room_number: '412' },
      { ...ROW, id: 'c2', room_number: '413' },
      { ...ROW, id: 'c3', room_number: '414' },
    ]);

    const { checks } = await service.listOwnChecks(CHECKER);

    expect(checks.map((c) => c.room_number)).toEqual(['412', '413', '414']);
    expect(new Set(checks.map((c) => c.assignment_id)).size).toBe(1);
  });

  it('searches room, notes, worker name and hotel name from ONE box', async () => {
    // Owner decision: one field. Someone typing "412" may mean a room, a note
    // that mentions it, or a name -- asking which before they can search is a
    // form nobody fills in twice.
    await service.listOwnChecks(CHECKER, { q: '412' });

    const where = mockQualityVerification.findMany.mock.calls[0][0].where;
    expect(where.verified_by_id).toBe('checker-1');
    const fields = where.OR.map((c: Record<string, unknown>) => Object.keys(c)[0]);
    expect(fields).toEqual(['room_number', 'notes', 'worker', 'worker', 'hotel']);
  });

  it('searches case-insensitively', async () => {
    // A case-sensitive search returns nothing rather than reporting that it
    // could not help, which reads as "no such room".
    await service.listOwnChecks(CHECKER, { q: 'grand' });

    const where = mockQualityVerification.findMany.mock.calls[0][0].where;
    for (const clause of where.OR) {
      expect(JSON.stringify(clause)).toContain('"mode":"insensitive"');
    }
  });

  it('does not add a search predicate when the box is empty', async () => {
    await service.listOwnChecks(CHECKER, { q: '   ' });

    expect(mockQualityVerification.findMany.mock.calls[0][0].where).toEqual({
      verified_by_id: 'checker-1',
    });
  });

  it('exposes the rework assignment the worker’s button needs', async () => {
    const [check] = (await service.listOwnChecks(CHECKER)).checks;
    expect(check!.rework_assignment).toMatchObject({ id: 'rework-1' });
  });

  it('points the worker’s button at the OPEN round, not the first one', async () => {
    // With one round this was `rework_assignments[0]`, which was adequate
    // while a check could only be sent back once. With two it returns
    // whichever shift the database listed first -- round 1's, long completed --
    // so the worker would tap "go to your rework" and land on finished work
    // while the open round sat untouched.
    mockQualityVerification.findMany.mockResolvedValue([
      {
        ...ROW,
        rework_assignments: [
          { id: 'rework-1', status: 'COMPLETED', day: new Date('2026-08-26T00:00:00.000Z') },
          { id: 'rework-2', status: 'CONFIRMED', day: new Date('2026-08-27T00:00:00.000Z') },
        ],
        rework_rounds: [
          { ...ROW.rework_rounds[0], completed_at: new Date('2026-08-26T12:00:00.000Z') },
          {
            id: 'round-2',
            round_number: 2,
            notes: 'still not clean',
            assigned_at: new Date('2026-08-27T09:00:00.000Z'),
            completed_at: null,
            photo_urls: [],
            assignment_id: 'rework-2',
            assigned_by: { id: 'checker-1', first_name: 'Cal', last_name: 'Checker' },
          },
        ],
      },
    ]);

    const [check] = (await service.listOwnChecks(CHECKER)).checks;
    expect(check!.rework_assignment).toMatchObject({ id: 'rework-2' });
  });

  it('exposes every round, in order, with per-round photo counts', async () => {
    const [check] = (await service.listOwnChecks(CHECKER)).checks;
    expect(check!.rework_rounds).toHaveLength(1);
    expect(check!.rework_rounds[0]).toMatchObject({ round_number: 1, photo_count: 0 });
  });

  it('never leaks a round’s storage keys', async () => {
    // Same rule as the check's own photos: a key without a presigned URL is
    // useless, and listing them turns this into a directory of private paths.
    mockQualityVerification.findMany.mockResolvedValue([
      { ...ROW, rework_rounds: [{ ...ROW.rework_rounds[0], photo_urls: ['quality/secret/rework/a.jpg'] }] },
    ]);
    const result = await service.listOwnChecks(CHECKER);
    expect(result.checks[0]!.rework_rounds[0]!.photo_count).toBe(1);
    expect(JSON.stringify(result)).not.toContain('quality/secret');
  });

  it('returns photo COUNTS, never storage keys', async () => {
    const result = await service.listOwnChecks(CHECKER);
    expect(result.checks[0]!.photo_count).toBe(1);
    expect(JSON.stringify(result)).not.toContain('quality/assign-1');
  });

  it('orders newest first with a deterministic tiebreak', async () => {
    // Several rooms are written seconds apart on one shift; without the second
    // key two can swap between requests and, under pagination, silently drop
    // or duplicate one across a page boundary.
    await service.listOwnChecks(CHECKER);
    expect(mockQualityVerification.findMany.mock.calls[0][0].orderBy).toEqual([
      { created_at: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('paginates with skip/take', async () => {
    await service.listOwnChecks(CHECKER, { page: 3, perPage: 20 });
    expect(mockQualityVerification.findMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 });
  });
});

describe('search terms are escaped before they reach LIKE', () => {
  /**
   * Prisma's `contains` compiles to LIKE '%term%' and does NOT escape the
   * term. Probing the real database, a search for "%" returned all 8 of the
   * caller's checks instead of 0 -- the filter silently did nothing. Not SQL
   * injection (the value is still parameterised) but wildcard injection, which
   * is a live correctness bug the moment a room is named "A_1".
   */
  it('neutralises % so it matches a literal percent, not everything', () => {
    expect(escapeLikeTerm('%')).toBe('\\%');
    expect(escapeLikeTerm('50%')).toBe('50\\%');
  });

  it('neutralises _ so it does not match any single character', () => {
    // Real rooms are named this way -- "A_1" must find A_1, not A11 and AX1.
    expect(escapeLikeTerm('A_1')).toBe('A\\_1');
  });

  it('escapes the backslash FIRST, so escapes are not double-escaped', () => {
    // If % were escaped before \\, the added backslash would itself be escaped
    // and the term would match a literal backslash followed by a wildcard.
    expect(escapeLikeTerm('\\')).toBe('\\\\');
    expect(escapeLikeTerm('a\\%b')).toBe('a\\\\\\%b');
  });

  it('leaves an ordinary term untouched', () => {
    // The escape must not change the common case: room numbers and names.
    expect(escapeLikeTerm('412')).toBe('412');
    expect(escapeLikeTerm('Zimmer-Ü-12')).toBe('Zimmer-Ü-12');
  });

  it('applies the escape to every clause of the search, not just the room', async () => {
    jest.clearAllMocks();
    const service = new QualityService();
    mockQualityVerification.count.mockResolvedValue(0);
    mockQualityVerification.findMany.mockResolvedValue([]);

    await service.listOwnChecks(CHECKER, { q: '100%' });

    const where = mockQualityVerification.findMany.mock.calls[0][0].where;
    const json = JSON.stringify(where.OR);
    // All five OR clauses carry the escaped term. Escaping only room_number
    // would leave notes, worker name and hotel name wildcard-injectable.
    expect(where.OR).toHaveLength(5);
    expect(json.match(/100\\\\%/g)).toHaveLength(5);
    // ...and the raw term reaches LIKE nowhere.
    expect(json).not.toMatch(/[^\\\\]100%/);
  });
});

describe('QualityController.listOwnChecks', () => {
  let controller: QualityController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new QualityController();
    mockQualityVerification.count.mockResolvedValue(1);
    mockQualityVerification.findMany.mockResolvedValue([ROW]);
  });

  it('scopes to req.auth.userId and ignores a client-supplied actor', async () => {
    // There is deliberately no checker_id parameter. Passing one must change
    // nothing -- this is the IDOR guard, asserted rather than assumed.
    const req = makeReq({ user_id: 'someone-else', checker_id: 'someone-else' });
    const next = jest.fn() as unknown as NextFunction;

    await controller.listOwnChecks(req, makeRes() as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockQualityVerification.findMany.mock.calls[0][0].where).toEqual({
      verified_by_id: 'checker-1',
    });
  });

  it('passes the search term through', async () => {
    await controller.listOwnChecks(
      makeReq({ q: 'balcony' }),
      makeRes() as unknown as Response,
      jest.fn() as unknown as NextFunction
    );
    expect(JSON.stringify(mockQualityVerification.findMany.mock.calls[0][0].where)).toContain(
      'balcony'
    );
  });

  it('rejects an over-long search term instead of running it', async () => {
    // Five LIKE clauses across joined tables; an unbounded term is a cheap way
    // to make an expensive query.
    const req = makeReq({ q: 'x'.repeat(500) });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.listOwnChecks(req, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
  });

  it('rejects a per_page above the cap', async () => {
    const req = makeReq({ per_page: '5000' });
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    await controller.listOwnChecks(req, makeRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ValidationError' }));
  });

  it('defaults page and per_page', () => {
    expect(ListOwnInspectionsQuerySchema.parse({})).toEqual({ page: 1, per_page: 20 });
  });
});

describe('GET /quality/my-inspections authorization', () => {
  it('is reachable by the CHECKER role under the REAL permission matrix', () => {
    // Asserted against ROLE_PERMISSIONS itself, not a fabricated array. A tool
    // once required a token WORKER does not hold and would have denied every
    // worker in production while 100+ tests passed, because the tests invented
    // the permission.
    expect(ROLE_PERMISSIONS.CHECKER).toContain('quality:read');
  });

  it('denies a caller holding no quality token', () => {
    const req = makeReq({}, { userId: 'u1', role: 'worker' });
    (req as any).auth.permissions = [];
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;

    requirePermission('quality:read')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });
});
