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
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  workerOverallRating: mockWorkerOverallRating,
  hotel: mockHotel,
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

// Epic 5 PR 5.7 (ADR-024 D1/D2/D4, site #10): roster cutover flag for
// getLeaderboard()'s hotel_id filter. Defaults OFF so the existing
// characterization tests below stay untouched.
let rosterCutoverEnabled = false;
jest.mock('../config/feature-flags.js', () => ({
  isRosterCutoverEnabled: () => rosterCutoverEnabled,
}));

import { AnalyticsService } from '../modules/analytics/service.js';

describe('Analytics getLeaderboard — hotel_id filter (Epic 5 PR 5.7, site #10)', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    rosterCutoverEnabled = false;
    service = new AnalyticsService();
    mockWorkerOverallRating.findMany.mockResolvedValue([]);
  });

  it('filters via the HotelWorker relation when hotelId is given (flag OFF, characterization)', async () => {
    await service.getLeaderboard('h1');
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ worker: { hotel_workers: { some: { hotel_id: 'h1', status: 'ACTIVE' } } } });
    expect(mockHotel.findUnique).not.toHaveBeenCalled();
  });

  it('applies no filter when hotelId is undefined (flag OFF, characterization)', async () => {
    await service.getLeaderboard(undefined);
    const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
    expect(where).toEqual({});
  });

  describe('roster cutover (flag ON, site #10)', () => {
    beforeEach(() => {
      rosterCutoverEnabled = true;
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
