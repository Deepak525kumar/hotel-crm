import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Free-text search on GET /assignments (owner decision, 2026-08-30).
 *
 * Server-side, not client-side, because the endpoint is paginated: filtering
 * the page the client happens to hold reports "none found" while the match
 * sits on page 3.
 *
 * The property that matters most here is not that search works -- it is that
 * search cannot WIDEN what the caller is allowed to see. This list already
 * carries a manager-scope restriction that was added to fix an IDOR, and the
 * obvious implementation (`where.OR = [...]` with a `hotel` clause) silently
 * overwrites the scope's own `hotel` key.
 */

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockWorkerAssignment = {
  findMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
};
const mockAttendance = { findMany: jest.fn() as jest.MockedFunction<(...a: any[]) => any> };
const mockPrisma = { workerAssignment: mockWorkerAssignment, attendance: mockAttendance };

jest.mock('../lib/db.js', () => ({ getPrisma: () => mockPrisma }));

import { AssignmentService } from '../modules/assignments/service.js';
import { ListAssignmentsQuerySchema } from '../modules/assignments/types.js';
import { escapeLikeTerm } from '../lib/like-escape.js';

const ADMIN = { userId: 'admin-1', role: 'admin' };

function whereOf() {
  return mockWorkerAssignment.findMany.mock.calls[0][0].where;
}

let service: AssignmentService;
beforeEach(() => {
  jest.clearAllMocks();
  service = new AssignmentService();
  mockWorkerAssignment.findMany.mockResolvedValue([]);
  mockWorkerAssignment.count.mockResolvedValue(0);
  mockAttendance.findMany.mockResolvedValue([]);
});

const listWith = (q: Record<string, unknown>, actor: any = ADMIN) =>
  service.list(ListAssignmentsQuerySchema.parse(q), actor);

describe('assignments search', () => {
  it('searches worker name, hotel name and city', async () => {
    await listWith({ q: 'berlin' });
    const or = whereOf().AND[0].OR;
    const fields = or.map((c: Record<string, unknown>) => Object.keys(c)[0]);
    expect(fields).toEqual(['worker', 'worker', 'hotel', 'hotel']);
  });

  it('searches case-insensitively', async () => {
    // A case-sensitive search returns nothing rather than reporting that it
    // could not help, which reads as "no such hotel".
    await listWith({ q: 'Grand' });
    for (const clause of whereOf().AND[0].OR) {
      expect(JSON.stringify(clause)).toContain('"mode":"insensitive"');
    }
  });

  it('escapes LIKE wildcards so % does not return everything', async () => {
    // Asserted on the object, not on JSON.stringify of it: the term contains a
    // backslash, and JSON doubles it, so a string comparison silently tests
    // the wrong thing.
    await listWith({ q: '100%' });
    const clauses = whereOf().AND[0].OR;
    for (const clause of clauses) {
      const inner = Object.values(clause)[0] as Record<string, { contains: string }>;
      const { contains } = Object.values(inner)[0];
      expect(contains).toBe(escapeLikeTerm('100%'));
      expect(contains).not.toBe('100%');
    }
  });

  it('escapes an underscore, which a real hotel name can contain', async () => {
    await listWith({ q: 'A_1' });
    const inner = Object.values(whereOf().AND[0].OR[0])[0] as Record<string, { contains: string }>;
    expect(Object.values(inner)[0].contains).toBe('A\\_1');
  });

  it('adds NO predicate when the box is empty', async () => {
    await listWith({ q: '   ' });
    expect(whereOf().AND).toBeUndefined();
  });

  it('cannot widen a hotel-scoped manager past their own hotel', async () => {
    // The search must AND with the scope, never replace it.
    await listWith(
      { q: 'other hotel' },
      { userId: 'm1', role: 'manager', scope: { type: 'hotel', hotel_id: 'h1' } }
    );
    const where = whereOf();
    expect(where.hotel_id).toBe('h1');
    expect(where.AND).toHaveLength(1);
  });

  it('does not clobber a hotel_group scope’s own `hotel` clause', async () => {
    // The defect this test exists for: a top-level `where.OR` containing a
    // `hotel` key overwrites `where.hotel = { hotel_group_id }`, turning a
    // regional manager's scoped list into a platform-wide one the moment they
    // type in the search box. Nesting under AND is what prevents it.
    await listWith(
      { q: 'grand' },
      { userId: 'rm1', role: 'regional_manager', scope: { type: 'hotel_group', hotel_group_id: 'g1' } }
    );
    const where = whereOf();
    expect(where.hotel).toEqual({ hotel_group_id: 'g1' });
    expect(where.AND[0].OR.some((c: any) => c.hotel)).toBe(true);
  });

  it('keeps a worker scoped to their own assignments while searching', async () => {
    await listWith({ q: 'grand' }, { userId: 'w1', role: 'worker' });
    expect(whereOf().worker_id).toBe('w1');
  });

  it('combines with the status filter rather than replacing it', async () => {
    await listWith({ q: 'grand', status: 'COMPLETED' });
    expect(whereOf().status).toBe('COMPLETED');
    expect(whereOf().AND).toHaveLength(1);
  });

  it('counts the SAME predicate it lists', async () => {
    // Otherwise total_pages describes a different result set than the page.
    await listWith({ q: 'grand' });
    expect(mockWorkerAssignment.count.mock.calls[0][0].where).toEqual(whereOf());
  });

  it('rejects an over-long term instead of running it', () => {
    // Four LIKE clauses across joined tables; an unbounded term is a cheap way
    // to make an expensive query.
    expect(() => ListAssignmentsQuerySchema.parse({ q: 'x'.repeat(500) })).toThrow();
  });
});
