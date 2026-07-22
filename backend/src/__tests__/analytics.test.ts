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
