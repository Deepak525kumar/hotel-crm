import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ADR-028 (2026-07-22, OQ-ANALYTICS-03): the basic-analytics "rooms completed per
// worker" metric is wired into the existing read surface (getDashboardStats /
// getHotelSummary) as a derived rooms_completed.{total,entries} field, sourced
// from the new RoomsCompletedEntry model — not a write-only field.

function makeGroupByResult<T extends string>(statuses: Array<[T, number]>) {
  return statuses.map(([status, count]) => ({ status, _count: { id: count } }));
}

const mockPrisma = {
  jobRequest: {
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    groupBy: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  workerAssignment: {
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    groupBy: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  attendance: {
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    groupBy: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  qualityVerification: {
    aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  rating: {
    aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  roomsCompletedEntry: {
    aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  // Worker-logged rooms (2026-09-01). Counted ALONGSIDE the legacy
  // manager-entered sums above rather than replacing them: the manual entry is
  // retired from the UI, but every shift before that change has its count only
  // in RoomsCompletedEntry, and reading room logs alone would collapse all
  // historical figures to zero.
  roomLog: {
    count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  // getHotelSummary's confirmed-headcount source (2026-08-07): the real
  // figure lives on JobRequestSkillSlot.confirmed_count, not on the
  // never-written JobRequest.workers_confirmed column.
  jobRequestSkillSlot: {
    aggregate: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  workerOverallRating: {
    findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
  hotel: {
    findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
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

describe('Analytics rooms_completed wiring (ADR-028, OQ-ANALYTICS-03)', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService();

    mockPrisma.jobRequest.count.mockResolvedValue(0);
    mockPrisma.jobRequest.groupBy.mockResolvedValue(makeGroupByResult([]));
    mockPrisma.jobRequest.aggregate.mockResolvedValue({
      _count: { id: 0 },
      _sum: { workers_needed: 0 },
    });
    mockPrisma.jobRequestSkillSlot.aggregate.mockResolvedValue({
      _sum: { confirmed_count: 0 },
    });
    mockPrisma.workerAssignment.count.mockResolvedValue(0);
    mockPrisma.workerAssignment.groupBy.mockResolvedValue(makeGroupByResult([]));
    mockPrisma.attendance.count.mockResolvedValue(0);
    mockPrisma.attendance.groupBy.mockResolvedValue(makeGroupByResult([]));
    mockPrisma.qualityVerification.aggregate.mockResolvedValue({ _avg: { score: null } });
    mockPrisma.qualityVerification.count.mockResolvedValue(0);
    mockPrisma.rating.aggregate.mockResolvedValue({ _avg: { score: null } });
    mockPrisma.rating.count.mockResolvedValue(0);
    mockPrisma.workerOverallRating.findMany.mockResolvedValue([]);
    mockPrisma.roomsCompletedEntry.aggregate.mockResolvedValue({
      _sum: { rooms_completed: 42 },
      _count: 7,
    });
    // Default: no worker-logged rooms, so the existing expectations below read
    // the legacy figure unchanged. The additive behaviour is pinned in its own
    // test at the bottom of this file.
    mockPrisma.roomLog.count.mockResolvedValue(0);
  });

  it('getDashboardStats surfaces rooms_completed.{total,entries} from RoomsCompletedEntry', async () => {
    const stats = await service.getDashboardStats(undefined);
    expect(stats.rooms_completed).toEqual({ total: 42, entries: 7 });
    expect(mockPrisma.roomsCompletedEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, _sum: { rooms_completed: true }, _count: true })
    );
  });

  it('getDashboardStats scopes rooms_completed by hotel_id when provided', async () => {
    await service.getDashboardStats('h1');
    expect(mockPrisma.roomsCompletedEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hotel_id: 'h1' } })
    );
  });

  it('defaults rooms_completed to {total:0, entries:0} when there are no entries (null sum)', async () => {
    mockPrisma.roomsCompletedEntry.aggregate.mockResolvedValue({
      _sum: { rooms_completed: null },
      _count: 0,
    });
    const stats = await service.getDashboardStats(undefined);
    expect(stats.rooms_completed).toEqual({ total: 0, entries: 0 });
  });

  // Confirmed-headcount source (2026-08-07). JobRequest.workers_confirmed is
  // declared and read but written by NOTHING anywhere in the codebase, so
  // this figure was previously always 0 -- the hotel dashboard reported
  // "N needed, 0 confirmed" regardless of actual staffing.
  // JobRequestSkillSlot.confirmed_count is the column that IS maintained
  // (incremented by acceptBroadcast, decremented when a broadcast-derived
  // assignment is cancelled), so the real figure was already one table over.
  it('getHotelSummary reads confirmed headcount from skill slots, not the never-written workers_confirmed column', async () => {
    mockPrisma.jobRequest.aggregate.mockResolvedValue({
      _count: { id: 3 },
      // Deliberately non-zero: if the implementation regressed to reading
      // this column, the assertion below would see 99 instead of 7.
      _sum: { workers_needed: 10, workers_confirmed: 99 },
    });
    mockPrisma.jobRequestSkillSlot.aggregate.mockResolvedValue({
      _sum: { confirmed_count: 7 },
    });

    const summary = await service.getHotelSummary('h1');

    expect(summary.open_requests.workers_needed).toBe(10);
    expect(summary.open_requests.workers_confirmed).toBe(7);

    // Scoped to this hotel's open/partially-filled requests, not platform-wide.
    expect(mockPrisma.jobRequestSkillSlot.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          job_request: expect.objectContaining({ hotel_id: 'h1' }),
        }),
        _sum: { confirmed_count: true },
      })
    );
  });

  it('getHotelSummary reports zero confirmed when no slots are filled', async () => {
    mockPrisma.jobRequest.aggregate.mockResolvedValue({
      _count: { id: 2 },
      _sum: { workers_needed: 5 },
    });
    mockPrisma.jobRequestSkillSlot.aggregate.mockResolvedValue({
      _sum: { confirmed_count: null },
    });

    const summary = await service.getHotelSummary('h1');

    expect(summary.open_requests.workers_confirmed).toBe(0);
  });

  it('getHotelSummary surfaces rooms_completed scoped to the hotel', async () => {
    const summary = await service.getHotelSummary('h1');
    expect(summary.rooms_completed).toEqual({ total: 42, entries: 7 });
    expect(mockPrisma.roomsCompletedEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hotel_id: 'h1' } })
    );
  });

  // Worker-logged rooms (2026-09-01). The two sources are mutually exclusive
  // per assignment -- a shift's rooms are either a manager-entered count
  // (historical) or the worker's own per-room logs (now) -- so summing them
  // cannot double-count, and it is what keeps historical trends from
  // collapsing to zero the day the manual entry was retired.
  describe('worker-logged rooms are added to the legacy manager-entered counts', () => {
    it('adds RoomLog rows to the platform total', async () => {
      mockPrisma.roomLog.count.mockResolvedValue(5);

      const stats = await service.getDashboardStats(undefined);

      expect(stats.rooms_completed).toEqual({ total: 47, entries: 12 });
    });

    it('scopes the RoomLog count by hotel exactly as the legacy aggregate is scoped', async () => {
      mockPrisma.roomLog.count.mockResolvedValue(3);

      await service.getDashboardStats('h1');

      expect(mockPrisma.roomLog.count).toHaveBeenCalledWith({ where: { hotel_id: 'h1' } });
    });

    it('adds RoomLog rows to a hotel summary', async () => {
      mockPrisma.roomLog.count.mockResolvedValue(4);

      const summary = await service.getHotelSummary('h1');

      expect(summary.rooms_completed).toEqual({ total: 46, entries: 11 });
      expect(mockPrisma.roomLog.count).toHaveBeenCalledWith({ where: { hotel_id: 'h1' } });
    });

    it('reports only worker-logged rooms once the legacy table is empty', async () => {
      mockPrisma.roomsCompletedEntry.aggregate.mockResolvedValue({
        _sum: { rooms_completed: null },
        _count: 0,
      });
      mockPrisma.roomLog.count.mockResolvedValue(9);

      const stats = await service.getDashboardStats(undefined);

      expect(stats.rooms_completed).toEqual({ total: 9, entries: 9 });
    });
  });
});
