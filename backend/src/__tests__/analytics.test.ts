import { describe, it, expect, jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requireRole } from '../middleware/permissions.js';

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const mockWorkerOverallRating = {
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerAssignment = {
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockRoomsCompletedEntry = {
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// Worker-logged rooms (2026-09-01), counted alongside the legacy
// manager-entered sums above. Defaults to 0 so every existing expectation in
// this file still reads the legacy figure unchanged; the additive behaviour is
// pinned in analytics-rooms-completed.test.ts.
const mockRoomLog = {
  count: (jest.fn() as jest.MockedFunction<(...args: any[]) => any>).mockResolvedValue(0),
};

const mockAttendance = {
  groupBy: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

// Renamed from mockRating 2026-08-29: the per-worker rating reads moved to
// QualityVerification when the two models merged. Same methods, same
// worker_id filter, so every assertion below still describes the same
// behaviour -- only the table changed.
const mockQualityVerification = {
  aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  workerOverallRating: mockWorkerOverallRating,
  hotel: mockHotel,
  workerAssignment: mockWorkerAssignment,
  roomsCompletedEntry: mockRoomsCompletedEntry,
  roomLog: mockRoomLog,
  attendance: mockAttendance,
  qualityVerification: mockQualityVerification,
};

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

import { AnalyticsService } from '../modules/analytics/service.js';

describe('Analytics getLeaderboard — hotel_id filter', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService();
    mockWorkerOverallRating.findMany.mockResolvedValue([]);
  });

  /**
   * CORRECTED 2026-09-23. This case previously asserted `where` was `{}` and
   * was named "applies no filter when hotelId is undefined" — it pinned the
   * defect as intended behaviour.
   *
   * No filter means every WorkerOverallRating row ever written, deleted users
   * included, and this endpoint returns first and last name. So a removed
   * person's NAME kept appearing to everyone who could see the board, and
   * this is every admin's call, since an admin has global scope and sends no
   * hotel filter. Reported by the project owner as "a user gets removed, but
   * his data in the leaderboard is staying".
   *
   * A test that encodes a bug is worse than a missing test: it makes the next
   * person fixing it believe they are breaking something.
   */
  it('always excludes deleted users, even with no hotel filter', async () => {
    await service.getLeaderboard(undefined);
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ worker: { deleted_at: null } });
  });

  it('filters via the employment_record relation at the resolved hotel group', async () => {
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    await service.getLeaderboard('h1');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      worker: {
        deleted_at: null,
        employment_record: { hotel_group_id: 'g1', status: 'ACTIVE' },
      },
    });
  });

  it('filters out every worker when the hotel has no hotel_group_id (deny-by-default)', async () => {
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: null });
    await service.getLeaderboard('h1');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      worker: {
        deleted_at: null,
        employment_record: { hotel_group_id: '__none__', status: 'ACTIVE' },
      },
    });
  });

  it('excludes deleted users at group scope too', async () => {
    await service.getLeaderboard(undefined, 'g1');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      worker: {
        deleted_at: null,
        employment_record: { hotel_group_id: 'g1', status: 'ACTIVE' },
      },
    });
  });

  /**
   * Deactivation is NOT deletion, and the distinction is deliberate: a
   * deactivation is reversible and a temporarily inactive worker's history is
   * still theirs. Only `deleted_at` removes someone from the board.
   */
  it('does not filter on is_active', async () => {
    await service.getLeaderboard(undefined);
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('is_active');
  });
});

describe('Analytics getWorkerStats (GD-06)', () => {
  let service: AnalyticsService;

  // workerAssignment.count() is called 4x in Promise.all order:
  // completed_assignments, total_assignments, current_month.assignments,
  // current_month.completed. mockResolvedValueOnce chains match that order.
  function mockAssignmentCounts(completed: number, total: number, monthAssignments: number, monthCompleted: number) {
    mockWorkerAssignment.count
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(total)
      .mockResolvedValueOnce(monthAssignments)
      .mockResolvedValueOnce(monthCompleted);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService();
    mockAssignmentCounts(7, 10, 2, 1);
    mockRoomsCompletedEntry.aggregate.mockResolvedValue({ _sum: { rooms_completed: 42 } });
    mockWorkerOverallRating.findUnique.mockResolvedValue({ average_score: 88.5, total_ratings: 12 });
    mockAttendance.groupBy.mockResolvedValue([
      { status: 'PRESENT', _count: { id: 5 } },
      { status: 'LATE', _count: { id: 1 } },
      { status: 'ABSENT', _count: { id: 2 } },
    ]);
    mockAttendance.count.mockResolvedValue(8);
    mockQualityVerification.aggregate.mockResolvedValue({ _avg: { score: 91 } });
    mockQualityVerification.findMany.mockResolvedValue([
      { assignment_id: 'a1', score: 95, created_at: new Date('2026-08-05T00:00:00Z') },
      { assignment_id: 'a2', score: 80, created_at: new Date('2026-08-01T00:00:00Z') },
    ]);
  });

  it('scopes every query to the given worker_id — never a different worker', async () => {
    await service.getWorkerStats('w1');

    for (const call of mockWorkerAssignment.count.mock.calls) {
      expect(call[0].where).toMatchObject({ worker_id: 'w1' });
    }
    expect(mockRoomsCompletedEntry.aggregate.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    expect(mockWorkerOverallRating.findUnique.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    expect(mockAttendance.groupBy.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    expect(mockAttendance.count.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    for (const call of mockQualityVerification.aggregate.mock.calls) {
      expect(call[0].where).toMatchObject({ worker_id: 'w1' });
    }
    expect(mockQualityVerification.findMany.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
  });

  it('never reads or returns another worker\'s data — result shape matches WorkerStats exactly', async () => {
    const result = await service.getWorkerStats('w1');
    expect(result).toEqual({
      completed_assignments: 7,
      rooms_completed: 42,
      average_rating: 88.5,
      // TREQ-003: derived from average_rating, not stored. 88.5 sits in the
      // 70-89 band.
      rating_tier: 'HIGH',
      attendance: { total: 8, present: 5, late: 1, absent: 2 },
      total_assignments: 10,
      attendance_rate: 75, // (5 present + 1 late) / 8 total = 75%
      current_month: { assignments: 2, completed: 1, average_rating: 91 },
      recent_ratings: [
        { assignment_id: 'a1', rating: 95, created_at: '2026-08-05T00:00:00.000Z' },
        { assignment_id: 'a2', rating: 80, created_at: '2026-08-01T00:00:00.000Z' },
      ],
    });
  });

  it('returns null average_rating/attendance_rate and empty arrays when the worker has no data yet', async () => {
    mockWorkerAssignment.count.mockReset();
    mockAssignmentCounts(0, 0, 0, 0);
    mockRoomsCompletedEntry.aggregate.mockResolvedValue({ _sum: { rooms_completed: null } });
    mockWorkerOverallRating.findUnique.mockResolvedValue(null);
    mockAttendance.groupBy.mockResolvedValue([]);
    mockAttendance.count.mockResolvedValue(0);
    mockQualityVerification.aggregate.mockResolvedValue({ _avg: { score: null } });
    mockQualityVerification.findMany.mockResolvedValue([]);

    const result = await service.getWorkerStats('w-new');
    expect(result).toEqual({
      completed_assignments: 0,
      rooms_completed: 0,
      average_rating: null,
      // No WorkerOverallRating row at all -- unrated is not a tier.
      rating_tier: null,
      attendance: { total: 0, present: 0, late: 0, absent: 0 },
      total_assignments: 0,
      attendance_rate: null,
      current_month: { assignments: 0, completed: 0, average_rating: null },
      recent_ratings: [],
    });
  });

  it('caps recent_ratings at RECENT_RATINGS_LIMIT (5) via take, newest first via orderBy', async () => {
    await service.getWorkerStats('w1');
    const call = mockQualityVerification.findMany.mock.calls[0][0];
    expect(call.take).toBe(5);
    expect(call.orderBy).toEqual({ created_at: 'desc' });
  });

  it('response contains no peer-identifying fields — only this worker\'s own data', async () => {
    const result = await service.getWorkerStats('w1');
    const keys = Object.keys(result);
    // No rank/position, no other-worker names, no leaderboard-shaped fields —
    // this asserts the GD-06 boundary at the type level, not just by review.
    expect(keys).not.toContain('position');
    expect(keys).not.toContain('rank');
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('worker_id');
    expect(result.recent_ratings.every((r) => !('rated_by' in r) && !('worker_id' in r))).toBe(true);
  });
});

function makeReq(role: string): Request {
  return {
    auth: { userId: 'u1', role, hotel_ids: [], permissions: [] },
    params: { hotel_id: 'h1' },
    query: {},
    body: {},
    requestId: 'req_test',
  } as unknown as Request;
}

describe('Analytics RBAC — requireRole middleware', () => {
  it('denies GET /stats when role is worker', () => {
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requireRole(['admin', 'manager'])(makeReq('worker'), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('denies GET /hotel-summary/:hotel_id when role is worker', () => {
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requireRole(['admin', 'manager'])(makeReq('worker'), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ForbiddenError' }));
  });

  it('allows GET /stats when role is admin', () => {
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requireRole(['admin', 'manager'])(makeReq('admin'), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows GET /stats when role is manager', () => {
    const next = jest.fn() as jest.MockedFunction<(...args: any[]) => any> as unknown as NextFunction;
    requireRole(['admin', 'manager'])(makeReq('manager'), {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });
});
