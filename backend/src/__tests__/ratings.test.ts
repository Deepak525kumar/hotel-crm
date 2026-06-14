import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockRating = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  findMany: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  count: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  create: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockWorkerAssignment = {
  findUnique: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
};

const mockPrisma = {
  rating: mockRating,
  workerAssignment: mockWorkerAssignment,
  auditLog: { create: jest.fn() as jest.MockedFunction<(...args: any[]) => any> },
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

import { RatingService } from '../modules/ratings/service.js';

const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  hotel_id: 'h1',
  worker_id: 'w1',
  status: 'COMPLETED' as const,
  ...overrides,
});

const makeRating = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  assignment_id: 'a1',
  hotel_id: 'h1',
  worker_id: 'w1',
  rated_by_id: 'mgr1',
  score: 5,
  comment: null,
  criteria_scores: null,
  created_at: new Date('2026-06-01T00:00:00Z'),
  updated_at: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

describe('RatingService', () => {
  let service: RatingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RatingService();
  });

  describe('create', () => {
    it('throws NotFoundError when assignment does not exist', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(null);
      await expect(service.create({ assignment_id: 'a1', score: 5 }, 'mgr1', 'manager')).rejects.toMatchObject({
        name: 'NotFoundError',
      });
    });

    it('throws ConflictError when assignment is not COMPLETED', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment({ status: 'CONFIRMED' }));
      await expect(service.create({ assignment_id: 'a1', score: 5 }, 'mgr1', 'manager')).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('throws ConflictError when a rating already exists', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockRating.findUnique.mockResolvedValue(makeRating());
      await expect(service.create({ assignment_id: 'a1', score: 5 }, 'mgr1', 'manager')).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });

    it('creates a rating, deriving hotel_id and worker_id from the assignment', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockRating.findUnique.mockResolvedValue(null);
      mockRating.create.mockResolvedValue(makeRating());
      const dto = await service.create(
        { assignment_id: 'a1', score: 5, comment: 'great' },
        'mgr1',
        'manager'
      );
      expect(dto.worker_id).toBe('w1');
      const data = mockRating.create.mock.calls[0][0].data;
      expect(data.hotel_id).toBe('h1');
      expect(data.worker_id).toBe('w1');
      expect(data.rated_by_id).toBe('mgr1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('passes criteria_scores when provided', async () => {
      mockWorkerAssignment.findUnique.mockResolvedValue(makeAssignment());
      mockRating.findUnique.mockResolvedValue(null);
      mockRating.create.mockResolvedValue(makeRating({ criteria_scores: { punctuality: 5 } }));
      await service.create(
        { assignment_id: 'a1', score: 5, criteria_scores: { punctuality: 5 } },
        'mgr1',
        'manager'
      );
      const data = mockRating.create.mock.calls[0][0].data;
      expect(data.criteria_scores).toEqual({ punctuality: 5 });
    });
  });

  describe('list', () => {
    it('scopes workers to their own ratings', async () => {
      mockRating.findMany.mockResolvedValue([]);
      mockRating.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20 } as any, { userId: 'w1', role: 'worker' });
      const where = mockRating.findMany.mock.calls[0][0].where;
      expect(where.worker_id).toBe('w1');
    });

    it('lets a manager filter by worker_id', async () => {
      mockRating.findMany.mockResolvedValue([]);
      mockRating.count.mockResolvedValue(0);
      await service.list({ page: 1, per_page: 20, worker_id: 'w9' } as any, { userId: 'mgr1', role: 'manager' });
      const where = mockRating.findMany.mock.calls[0][0].where;
      expect(where.worker_id).toBe('w9');
    });
  });

  describe('getById', () => {
    it('throws ForbiddenError when worker views another worker\'s rating', async () => {
      mockRating.findUnique.mockResolvedValue(makeRating({ worker_id: 'w2' }));
      await expect(service.getById('r1', { userId: 'w1', role: 'worker' })).rejects.toMatchObject({
        name: 'ForbiddenError',
      });
    });
  });
});
