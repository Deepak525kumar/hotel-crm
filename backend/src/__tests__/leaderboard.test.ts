import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockWorkerOverallRating = {
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockRating = {
  groupBy: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockHotel = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  workerOverallRating: mockWorkerOverallRating,
  rating: mockRating,
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

import { LeaderboardService } from '../modules/leaderboard/service.js';

describe('LeaderboardService', () => {
  let service: LeaderboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeaderboardService();
  });

  describe('global', () => {
    it('reads WorkerOverallRating ranked by average_score and assigns ranks', async () => {
      mockWorkerOverallRating.findMany.mockResolvedValue([
        { worker_id: 'w1', average_score: 4.9, total_ratings: 10, last_worked_at: new Date('2026-06-01T00:00:00Z') },
        { worker_id: 'w2', average_score: 4.5, total_ratings: 8, last_worked_at: null },
      ]);
      mockWorkerOverallRating.count.mockResolvedValue(2);
      const res = await service.global({ page: 1, per_page: 20 } as any);
      expect(res.total).toBe(2);
      expect(res.data[0]).toMatchObject({ rank: 1, worker_id: 'w1', average_score: 4.9 });
      expect(res.data[1].rank).toBe(2);
      const where = mockWorkerOverallRating.findMany.mock.calls[0][0].where;
      expect(where.total_ratings).toEqual({ gt: 0 });
    });

    it('computes ranks with page offset', async () => {
      mockWorkerOverallRating.findMany.mockResolvedValue([
        { worker_id: 'w3', average_score: 4.0, total_ratings: 5, last_worked_at: null },
      ]);
      mockWorkerOverallRating.count.mockResolvedValue(21);
      const res = await service.global({ page: 2, per_page: 20 } as any);
      expect(res.data[0].rank).toBe(21);
    });
  });

  describe('byHotel', () => {
    it('returns empty when hotel not found', async () => {
      mockHotel.findUnique.mockResolvedValue(null);
      const res = await service.byHotel('h404', { page: 1, per_page: 20 } as any);
      expect(res).toEqual({ data: [], total: 0 });
      expect(mockRating.groupBy).not.toHaveBeenCalled();
    });

    it('aggregates Rating rows per worker for the hotel', async () => {
      mockHotel.findUnique.mockResolvedValue({ id: 'h1' });
      mockRating.groupBy.mockResolvedValue([
        { worker_id: 'w1', _avg: { score: 4.7 }, _count: { _all: 6 }, _max: { created_at: new Date('2026-06-01T00:00:00Z') } },
        { worker_id: 'w2', _avg: { score: 4.2 }, _count: { _all: 3 }, _max: { created_at: null } },
      ]);
      const res = await service.byHotel('h1', { page: 1, per_page: 20 } as any);
      expect(res.total).toBe(2);
      expect(res.data[0]).toMatchObject({ rank: 1, worker_id: 'w1', average_score: 4.7, total_ratings: 6 });
      const args = mockRating.groupBy.mock.calls[0][0];
      expect(args.where).toEqual({ hotel_id: 'h1' });
    });

    it('paginates the grouped results', async () => {
      mockHotel.findUnique.mockResolvedValue({ id: 'h1' });
      mockRating.groupBy.mockResolvedValue([
        { worker_id: 'w1', _avg: { score: 5 }, _count: { _all: 1 }, _max: { created_at: null } },
        { worker_id: 'w2', _avg: { score: 4 }, _count: { _all: 1 }, _max: { created_at: null } },
        { worker_id: 'w3', _avg: { score: 3 }, _count: { _all: 1 }, _max: { created_at: null } },
      ]);
      const res = await service.byHotel('h1', { page: 2, per_page: 2 } as any);
      expect(res.total).toBe(3);
      expect(res.data).toHaveLength(1);
      expect(res.data[0]).toMatchObject({ rank: 3, worker_id: 'w3' });
    });
  });
});
