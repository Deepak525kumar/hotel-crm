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
      _sum: { workers_needed: 0, workers_confirmed: 0 },
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

  it('getHotelSummary surfaces rooms_completed scoped to the hotel', async () => {
    const summary = await service.getHotelSummary('h1');
    expect(summary.rooms_completed).toEqual({ total: 42, entries: 7 });
    expect(mockPrisma.roomsCompletedEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hotel_id: 'h1' } })
    );
  });
});
