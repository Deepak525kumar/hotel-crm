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

const mockAttendance = {
  groupBy: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  workerOverallRating: mockWorkerOverallRating,
  hotel: mockHotel,
  workerAssignment: mockWorkerAssignment,
  roomsCompletedEntry: mockRoomsCompletedEntry,
  attendance: mockAttendance,
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

  it('applies no filter when hotelId is undefined', async () => {
    await service.getLeaderboard(undefined);
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });

  it('filters via the employment_record relation at the resolved hotel group', async () => {
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: 'g1' });
    await service.getLeaderboard('h1');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      worker: { employment_record: { hotel_group_id: 'g1', status: 'ACTIVE' } },
    });
  });

  it('filters out every worker when the hotel has no hotel_group_id (deny-by-default)', async () => {
    mockHotel.findUnique.mockResolvedValue({ hotel_group_id: null });
    await service.getLeaderboard('h1');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      worker: { employment_record: { hotel_group_id: '__none__', status: 'ACTIVE' } },
    });
  });
});

describe('Analytics getWorkerStats (GD-06)', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService();
    mockWorkerAssignment.count.mockResolvedValue(7);
    mockRoomsCompletedEntry.aggregate.mockResolvedValue({ _sum: { rooms_completed: 42 } });
    mockWorkerOverallRating.findUnique.mockResolvedValue({ average_score: 88.5 });
    mockAttendance.groupBy.mockResolvedValue([
      { status: 'PRESENT', _count: { id: 5 } },
      { status: 'LATE', _count: { id: 1 } },
      { status: 'ABSENT', _count: { id: 2 } },
    ]);
    mockAttendance.count.mockResolvedValue(8);
  });

  it('scopes every query to the given worker_id — never a different worker', async () => {
    await service.getWorkerStats('w1');

    expect(mockWorkerAssignment.count.mock.calls[0][0].where).toEqual({
      worker_id: 'w1',
      status: 'COMPLETED',
    });
    expect(mockRoomsCompletedEntry.aggregate.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    expect(mockWorkerOverallRating.findUnique.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    expect(mockAttendance.groupBy.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
    expect(mockAttendance.count.mock.calls[0][0].where).toEqual({ worker_id: 'w1' });
  });

  it('never reads or returns another worker\'s data — result shape matches WorkerStats exactly', async () => {
    const result = await service.getWorkerStats('w1');
    expect(result).toEqual({
      completed_assignments: 7,
      rooms_completed: 42,
      average_rating: 88.5,
      attendance: { total: 8, present: 5, late: 1, absent: 2 },
    });
  });

  it('returns null average_rating and zeroed fields when the worker has no data yet', async () => {
    mockWorkerAssignment.count.mockResolvedValue(0);
    mockRoomsCompletedEntry.aggregate.mockResolvedValue({ _sum: { rooms_completed: null } });
    mockWorkerOverallRating.findUnique.mockResolvedValue(null);
    mockAttendance.groupBy.mockResolvedValue([]);
    mockAttendance.count.mockResolvedValue(0);

    const result = await service.getWorkerStats('w-new');
    expect(result).toEqual({
      completed_assignments: 0,
      rooms_completed: 0,
      average_rating: null,
      attendance: { total: 0, present: 0, late: 0, absent: 0 },
    });
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
